package com.oney.WebRTCModule;

import android.util.Log;
import androidx.annotation.Nullable;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.WritableMap;
import expo.modules.aetherdepth.ArDepthCapturer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import org.webrtc.MediaStreamTrack;
import org.webrtc.VideoCapturer;
import org.webrtc.VideoTrack;

// WebRTC registers custom capture tracks on its package-private, single-thread executor.
// Registration here lets RTCView and WHIP use the exact same track as ordinary getUserMedia.
public final class AetherDepthStream {
    public interface Result { void accept(@Nullable Map<String, Object> value); }
    private volatile Controller current;

    public void open(ReactApplicationContext context, Result result) {
        ThreadUtils.runOnExecutor(() -> {
            Controller controller = new Controller();
            if (current != null && current.capture.isCapturing()) {
                result.accept(null);
                return;
            }
            try {
                WebRTCModule rtc = context.getNativeModule(WebRTCModule.class);
                if (rtc == null) { result.accept(null); return; }
                current = controller;
                VideoTrack track = rtc.createVideoTrack(controller);
                if (track == null || !controller.capture.isCapturing()) {
                    if (track != null) rtc.mediaStreamTrackRelease(track.id());
                    result.accept(null);
                    return;
                }
                controller.capture.awaitColor(ready -> ThreadUtils.runOnExecutor(() -> {
                    if (!ready || current != controller || !controller.capture.isCapturing()) {
                        rtc.mediaStreamTrackRelease(track.id());
                        result.accept(null);
                        return;
                    }
                    try {
                        rtc.createStream(new MediaStreamTrack[] {track}, (id, tracks) -> {
                            controller.streamId = id;
                            ArrayList<Map<String, Object>> info = new ArrayList<>();
                            for (WritableMap details : tracks) info.add(details.toHashMap());
                            Map<String, Object> stream = new HashMap<>();
                            stream.put("streamId", id);
                            stream.put("streamReactTag", id);
                            stream.put("tracks", info);
                            result.accept(stream);
                        });
                    } catch (RuntimeException error) {
                        Log.w("AetherDepth", "Could not register the depth video stream", error);
                        if (controller.streamId != null) rtc.mediaStreamRemoveTrack(controller.streamId, -1, track.id());
                        rtc.mediaStreamTrackRelease(track.id());
                        if (controller.streamId != null) rtc.mediaStreamRelease(controller.streamId);
                        result.accept(null);
                    }
                }));
            } catch (RuntimeException error) {
                Log.w("AetherDepth", "Depth camera could not open", error);
                controller.dispose();
                result.accept(null);
            }
        });
    }

    @Nullable public Map<String, Object> read(String id) {
        Controller owner = current;
        return owner != null && id.equals(owner.streamId) ? owner.capture.read() : null;
    }

    public void snapshot(String id, Result result) {
        Controller owner = current;
        if (owner == null || !id.equals(owner.streamId)) result.accept(null);
        else owner.capture.snapshot(result::accept);
    }

    public void release() {
        ThreadUtils.runOnExecutor(() -> {
            Controller owner = current;
            current = null;
            if (owner != null) owner.capture.retire();
        });
    }

    public void cancelOpening() {
        ThreadUtils.runOnExecutor(() -> {
            Controller owner = current;
            if (owner != null && owner.streamId == null) owner.capture.retire();
        });
    }

    private static final class Controller extends AbstractVideoCaptureController {
        final ArDepthCapturer capture = new ArDepthCapturer(() -> {
            if (capturerEventsListener != null) capturerEventsListener.onCapturerEnded();
        });
        volatile String streamId;

        Controller() { super(640, 480, 15); }
        @Override protected VideoCapturer createVideoCapturer() { return capture; }
        @Override public String getDeviceId() { return capture.deviceId(); }
        @Override public int getWidth() { return capture.width(); }
        @Override public int getHeight() { return capture.height(); }
    }
}
