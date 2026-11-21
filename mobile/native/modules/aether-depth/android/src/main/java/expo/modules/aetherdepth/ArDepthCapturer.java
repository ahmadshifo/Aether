package expo.modules.aetherdepth;

import android.content.Context;
import android.graphics.Point;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.Image;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.os.Handler;
import android.os.SystemClock;
import android.util.Log;
import android.view.Display;
import android.view.WindowManager;
import com.google.ar.core.Config;
import com.google.ar.core.Frame;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;
import com.google.ar.core.exceptions.NotYetAvailableException;
import java.nio.ByteBuffer;
import java.util.HashMap;
import java.util.Map;
import org.webrtc.CapturerObserver;
import org.webrtc.GlUtil;
import org.webrtc.JavaI420Buffer;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.ThreadUtils;
import org.webrtc.VideoCapturer;
import org.webrtc.VideoFrame;
import org.webrtc.YuvHelper;

public final class ArDepthCapturer implements VideoCapturer {
    public interface Ready { void accept(boolean hasColor); }
    public interface Snapshot { void accept(Map<String, Object> value); }
    private static final String TAG = "AetherDepth";
    private static final long COLOR_TIMEOUT_MS = 5000;
    private final Runnable ended;
    private final Runnable update = this::update;
    private Context context;
    private CapturerObserver observer;
    private volatile Handler handler;
    private Session session;
    private int texture, sensorRotation;
    private int displayRotation = -1;
    private volatile int width = 640, height = 480;
    private volatile String cameraId;
    private volatile boolean running, retired;
    private boolean hasColor;
    private final Runnable noColor = () -> { if (!hasColor) fail(); };
    private Ready ready;
    private Snapshot waitingSnapshot;
    private final Runnable snapshotTimeout = () -> finishSnapshot(null);
    private long lastFrame, lastDepth, lastDepthCheck, lastColorUptime;
    private volatile Map<String, Object> sample;

    public ArDepthCapturer(Runnable ended) { this.ended = ended; }
    @Override public boolean isCapturing() { return running; }
    public String deviceId() { return cameraId; }
    public int width() { return width; }
    public int height() { return height; }
    public Map<String, Object> read() {
        Map<String, Object> value = sample;
        if (!running || value == null) return null;
        long age = System.currentTimeMillis() - ((Number) value.get("timestampMs")).longValue();
        return age >= 0 && age <= 1000 ? value : null;
    }

    @Override public void initialize(SurfaceTextureHelper helper, Context context, CapturerObserver observer) {
        this.context = context.getApplicationContext();
        this.observer = observer;
        this.handler = helper.getHandler();
    }

    @Override public void startCapture(int ignoredWidth, int ignoredHeight, int ignoredRate) {
        Handler thread = handler;
        if (thread == null) return;
        ThreadUtils.invokeAtFrontUninterruptibly(thread, () -> {
            if (retired || running) return;
            try {
                session = new Session(context);
                Config.DepthMode depthMode = Config.DepthMode.RAW_DEPTH_ONLY;
                if (!session.isDepthModeSupported(depthMode)) depthMode = Config.DepthMode.AUTOMATIC;
                if (!session.isDepthModeSupported(depthMode)) {
                    closeSession();
                    return;
                }
                Config config = session.getConfig();
                config.setDepthMode(depthMode);
                config.setUpdateMode(Config.UpdateMode.LATEST_CAMERA_IMAGE);
                config.setFocusMode(Config.FocusMode.AUTO);
                config.setLightEstimationMode(Config.LightEstimationMode.DISABLED);
                config.setPlaneFindingMode(Config.PlaneFindingMode.DISABLED);
                session.configure(config);
                cameraId = session.getCameraConfig().getCameraId();
                CameraManager cameras = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
                Integer angle = cameras.getCameraCharacteristics(cameraId).get(CameraCharacteristics.SENSOR_ORIENTATION);
                sensorRotation = angle == null ? 90 : angle;
                texture = GlUtil.generateTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES);
                session.setCameraTextureName(texture);
                displayRotation = -1;
                updateDisplayGeometry();
                session.resume();
                running = true;
                hasColor = false;
                lastDepth = lastDepthCheck = lastFrame = 0;
                observer.onCapturerStarted(true);
                thread.post(update);
                thread.postDelayed(noColor, COLOR_TIMEOUT_MS);
            } catch (Exception error) {
                // Missing Play Services for AR, unsupported camera, and denied camera access
                // return control to the normal WebRTC camera without creating a second owner.
                Log.i(TAG, "AR camera unavailable: " + error.getClass().getSimpleName());
                closeSession();
            }
        });
    }

    public void awaitColor(Ready callback) {
        Handler thread = handler;
        if (thread == null || !thread.post(() -> {
            if (hasColor || !running) callback.accept(hasColor && running);
            else ready = callback;
        })) callback.accept(false);
    }

    private void notifyReady(boolean value) {
        Ready listener = ready;
        ready = null;
        if (listener != null) listener.accept(value);
    }

    public void snapshot(Snapshot callback) {
        Handler thread = handler;
        if (thread == null || !thread.post(() -> {
            if (!running || waitingSnapshot != null) callback.accept(null);
            else {
                waitingSnapshot = callback;
                thread.postDelayed(snapshotTimeout, 1500);
            }
        })) callback.accept(null);
    }

    private void finishSnapshot(Map<String, Object> value) {
        Snapshot listener = waitingSnapshot;
        if (listener == null) return;
        handler.removeCallbacks(snapshotTimeout);
        waitingSnapshot = null;
        listener.accept(value);
    }

    private void update() {
        if (!running) return;
        long start = SystemClock.uptimeMillis();
        if (hasColor && start - lastColorUptime >= COLOR_TIMEOUT_MS) {
            // Some camera drivers repeat the last timestamp instead of reporting failure.
            // End the frozen track so preview and publisher can react to camera loss.
            fail();
            return;
        }
        try {
            updateDisplayGeometry();
            Frame frame = session.update();
            long now = frame.getTimestamp();
            if (now != 0 && now != lastFrame) {
                lastFrame = now;
                try (Image color = frame.acquireCameraImage()) {
                    sendColor(color, now);
                    lastColorUptime = SystemClock.uptimeMillis();
                    if (!hasColor) {
                        hasColor = true;
                        handler.removeCallbacks(noColor);
                        notifyReady(true);
                    }
                    if (frame.getCamera().getTrackingState() != TrackingState.TRACKING) sample = null;
                    else if (waitingSnapshot != null || now - lastDepthCheck >= 100_000_000L) {
                        lastDepthCheck = now;
                        sampleDepth(frame, color, now);
                    }
                } catch (NotYetAvailableException ignored) {
                    // The first RGB frame may arrive after tracking starts.
                }
            }
            handler.postAtTime(update, start + 66);
        } catch (Exception error) {
            Log.w(TAG, "AR camera capture interrupted", error);
            fail();
        }
    }

    private void sampleDepth(Frame frame, Image color, long now) {
        try (Image depth = frame.acquireRawDepthImage16Bits();
             Image confidence = frame.acquireRawDepthConfidenceImage()) {
            long time = depth.getTimestamp();
            // ARCore can reproject an earlier raw estimate into several new color frames.
            if (time <= 0 || time == lastDepth || time != confidence.getTimestamp()) return;
            long ageNs = now - time;
            if (ageNs < 0 || ageNs > 600_000_000L) { sample = null; return; }
            lastDepth = time;
            sample = DepthMeasurements.measure(frame, depth, confidence,
                System.currentTimeMillis() - ageNs / 1_000_000L);
            if (waitingSnapshot != null && ageNs <= 120_000_000L && sample != null && sample.containsKey("centerM")
                && color.getTimestamp() == frame.getAndroidCameraTimestamp()) {
                Map<String, Object> aligned = new HashMap<>();
                aligned.put("timestampMs", sample.get("timestampMs"));
                aligned.put("centerM", sample.get("centerM"));
                try {
                    aligned.put("jpeg", CameraJpeg.encode(color, rotation()));
                    finishSnapshot(aligned);
                } catch (RuntimeException error) {
                    Log.w(TAG, "Could not encode the distance frame", error);
                    finishSnapshot(null);
                }
            }
        } catch (NotYetAvailableException ignored) {
            // An older result retains its original timestamp and expires on the consumer.
        } catch (RuntimeException error) {
            // A tracking/depth interruption must not end the independent RGB stream.
            sample = null;
        }
    }

    private int rotation() {
        return (sensorRotation - displayRotation * 90 + 360) % 360;
    }

    private void updateDisplayGeometry() {
        WindowManager windows = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        Display display = windows.getDefaultDisplay();
        int orientation = display.getRotation();
        if (orientation == displayRotation) return;
        Point size = new Point();
        display.getSize(size);
        session.setDisplayGeometry(orientation, size.x, size.y);
        displayRotation = orientation;
    }

    private void sendColor(Image image, long timestamp) {
        width = image.getWidth();
        height = image.getHeight();
        JavaI420Buffer buffer = JavaI420Buffer.allocate(width, height);
        try {
            Image.Plane[] planes = image.getPlanes();
            copyPlane(planes[0], buffer.getDataY(), buffer.getStrideY(), width, height);
            int cw = (width + 1) / 2, ch = (height + 1) / 2;
            copyPlane(planes[1], buffer.getDataU(), buffer.getStrideU(), cw, ch);
            copyPlane(planes[2], buffer.getDataV(), buffer.getStrideV(), cw, ch);
            observer.onFrameCaptured(new VideoFrame(buffer, rotation(), timestamp));
        } finally {
            buffer.release();
        }
    }

    private static void copyPlane(Image.Plane plane, ByteBuffer dest, int destStride, int w, int h) {
        ByteBuffer source = plane.getBuffer().slice();
        int stride = plane.getRowStride(), pixel = plane.getPixelStride();
        if (pixel == 1) {
            YuvHelper.copyPlane(source, stride, dest, destStride, w, h);
        } else {
            for (int y = 0; y < h; y++) {
                int start = y * stride, out = y * destStride;
                for (int x = 0; x < w; x++) dest.put(out + x, source.get(start + x * pixel));
            }
        }
    }

    private void fail() {
        boolean notifyEnd = running && hasColor;
        closeSession();
        if (notifyEnd) ended.run();
    }

    private void closeSession() {
        handler.removeCallbacks(update);
        handler.removeCallbacks(noColor);
        boolean wasRunning = running;
        running = false;
        hasColor = false;
        sample = null;
        finishSnapshot(null);
        Session previous = session;
        session = null;
        if (previous != null) {
            try { if (wasRunning) previous.pause(); }
            catch (RuntimeException error) { Log.w(TAG, "AR camera could not pause", error); }
            try { previous.close(); }
            catch (RuntimeException error) { Log.w(TAG, "AR camera could not close", error); }
        }
        if (texture != 0) {
            GLES20.glDeleteTextures(1, new int[]{texture}, 0);
            texture = 0;
        }
        if (wasRunning) observer.onCapturerStopped();
        notifyReady(false);
    }

    @Override public void stopCapture() {
        Handler thread = handler;
        if (thread != null) ThreadUtils.invokeAtFrontUninterruptibly(thread, this::closeSession);
    }
    public void retire() {
        retired = true;
        Handler thread = handler;
        if (thread != null) ThreadUtils.invokeAtFrontUninterruptibly(thread, this::fail);
    }
    @Override public void dispose() { retired = true; stopCapture(); handler = null; }
    @Override public boolean isScreencast() { return false; }
    @Override public void changeCaptureFormat(int width, int height, int fps) { }
}
