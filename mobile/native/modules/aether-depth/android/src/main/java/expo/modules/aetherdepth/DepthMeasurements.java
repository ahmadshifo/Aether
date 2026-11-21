package expo.modules.aetherdepth;

import android.media.Image;
import com.google.ar.core.Camera;
import com.google.ar.core.CameraIntrinsics;
import com.google.ar.core.Coordinates2d;
import com.google.ar.core.Frame;
import java.nio.ByteOrder;
import java.util.HashMap;
import java.util.Map;

final class DepthMeasurements {
    static Map<String, Object> measure(Frame frame, Image depth, Image confidence, long timestampMs) {
        Camera camera = frame.getCamera();
        int width = depth.getWidth(), height = depth.getHeight();
        if (width != confidence.getWidth() || height != confidence.getHeight()) return null;
        // ARCore raw depth is aligned with the GPU texture. CPU camera image intrinsics
        // can have a different aspect ratio.
        CameraIntrinsics lens = camera.getTextureIntrinsics();
        int[] size = lens.getImageDimensions();
        float[] focal = lens.getFocalLength(), principal = lens.getPrincipalPoint();
        float sx = width / (float) size[0], sy = height / (float) size[1];
        float[] up = camera.getPose().inverse().getYAxis();
        Image.Plane d = depth.getPlanes()[0], c = confidence.getPlanes()[0];
        DepthSampling pixels = new DepthSampling(width, height,
            d.getBuffer().slice().order(ByteOrder.LITTLE_ENDIAN), d.getRowStride(), d.getPixelStride(),
            c.getBuffer().slice(), c.getRowStride(), c.getPixelStride(),
            focal[0] * sx, focal[1] * sy, principal[0] * sx, principal[1] * sy, up);
        float[] alignedCenter = new float[2];
        frame.transformCoordinates2d(Coordinates2d.IMAGE_NORMALIZED, new float[]{.5f, .5f},
            Coordinates2d.TEXTURE_NORMALIZED, alignedCenter);
        float center = pixels.center(alignedCenter[0], alignedCenter[1]), near = pixels.near();
        if (!Float.isFinite(center) && !Float.isFinite(near)) return null;
        Map<String, Object> sample = new HashMap<>();
        sample.put("timestampMs", (double) timestampMs);
        if (Float.isFinite(center)) sample.put("centerM", (double) center);
        if (Float.isFinite(near)) sample.put("nearM", (double) near);
        return sample;
    }
}
