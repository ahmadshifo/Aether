package expo.modules.aetherdepth;

import java.nio.ByteBuffer;
import java.util.Arrays;

// Convert axial millimetres into radial metres using actual camera intrinsics. Raw
// ARCore depth may be sparse; require several agreeing, confident pixels in each patch.
final class DepthSampling {
    private final int w, h, depthRow, depthPixel, confidenceRow, confidencePixel;
    private final ByteBuffer depth, confidence;
    private final float fx, fy, cx, cy;
    private final float[] up;
    private final float[] patch = new float[49];
    private final float[] centerPixels = new float[9];

    DepthSampling(int w, int h, ByteBuffer depth, int depthRow, int depthPixel,
                  ByteBuffer confidence, int confidenceRow, int confidencePixel,
                  float fx, float fy, float cx, float cy, float[] up) {
        this.w = w; this.h = h;
        this.depth = depth; this.depthRow = depthRow; this.depthPixel = depthPixel;
        this.confidence = confidence; this.confidenceRow = confidenceRow;
        this.confidencePixel = confidencePixel;
        this.fx = fx; this.fy = fy; this.cx = cx; this.cy = cy; this.up = up;
    }

    float center(float normalizedX, float normalizedY) { return patchRange(normalizedX, normalizedY, false); }

    float near() {
        float nearest = Float.NaN;
        for (int j = 0; j < 7; j++) {
            for (int i = 0; i < 7; i++) {
                float value = patchRange(.26f + .08f * i, .26f + .08f * j, true);
                if (Float.isFinite(value) && (!Float.isFinite(nearest) || value < nearest)) nearest = value;
            }
        }
        return nearest;
    }

    private float patchRange(float nx, float ny, boolean forwardOnly) {
        int centerX = (int) (nx * w), centerY = (int) (ny * h);
        if (centerX < 3 || centerY < 3 || centerX + 3 >= w || centerY + 3 >= h || !(fx > 0 && fy > 0))
            return Float.NaN;
        int count = 0, coreCount = 0;
        boolean measuredAimPixel = false;
        for (int j = centerY - 3; j <= centerY + 3; j++) {
            for (int i = centerX - 3; i <= centerX + 3; i++) {
                if ((confidence.get(j * confidenceRow + i * confidencePixel) & 0xff) < 160) continue;
                float z = (depth.getShort(j * depthRow + i * depthPixel) & 0xffff) * .001f;
                if (z < .20f || z > 5f) continue;
                float x = (i - cx) * z / fx, y = (cy - j) * z / fy;
                float height = x * up[0] + y * up[1] - z * up[2];
                if (forwardOnly && (height < -.50f || height > .55f)) continue;
                float distance = (float) Math.sqrt(x * x + y * y + z * z);
                patch[count++] = distance;
                if (i == centerX && j == centerY) measuredAimPixel = true;
                if (Math.abs(i - centerX) <= 1 && Math.abs(j - centerY) <= 1)
                    centerPixels[coreCount++] = distance;
            }
        }
        // Raw depth holes often sit on boundaries. A ring of wall pixels around
        // a missing aim pixel cannot establish the distance to a centered object.
        if (count < 9 || (!forwardOnly && (!measuredAimPixel || coreCount < 2))) return Float.NaN;
        Arrays.sort(patch, 0, count);
        float median = patch[count / 2];
        float tolerance = Math.max(.12f, median * .10f);
        if (patch[3 * count / 4] - patch[count / 4] > tolerance) return Float.NaN;
        if (!forwardOnly) {
            float min = Float.POSITIVE_INFINITY, max = Float.NEGATIVE_INFINITY;
            for (int i = 0; i < coreCount; i++) {
                min = Math.min(min, centerPixels[i]);
                max = Math.max(max, centerPixels[i]);
            }
            float centerTolerance = Math.max(.08f, median * .05f);
            if (max - min > centerTolerance || Math.abs(min - median) > centerTolerance
                    || Math.abs(max - median) > centerTolerance) return Float.NaN;
        }
        return median;
    }
}
