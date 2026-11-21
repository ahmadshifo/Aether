package expo.modules.aetherdepth;

import android.graphics.Bitmap;
import android.graphics.Matrix;
import android.media.Image;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

// Only invoked for an explicit named distance question. Sample directly at the output
// resolution, keeping image data in memory and leaving the full-resolution preview alone.
final class CameraJpeg {
    static String encode(Image image, int clockwiseDegrees) {
        int w = image.getWidth(), h = image.getHeight();
        float scale = Math.min(1f, 480f / Math.max(w, h));
        int width = Math.max(1, Math.round(w * scale)), height = Math.max(1, Math.round(h * scale));
        int[] rgb = new int[width * height];
        Plane yPlane = new Plane(image.getPlanes()[0]);
        Plane uPlane = new Plane(image.getPlanes()[1]);
        Plane vPlane = new Plane(image.getPlanes()[2]);
        for (int j = 0; j < height; j++) {
            int sy = (int) ((j + .5f) * h / height);
            for (int i = 0; i < width; i++) {
                int sx = (int) ((i + .5f) * w / width);
                int y = 298 * Math.max(0, yPlane.get(sx, sy) - 16);
                int u = uPlane.get(sx / 2, sy / 2) - 128, v = vPlane.get(sx / 2, sy / 2) - 128;
                int r = clamp((y + 409 * v + 128) >> 8);
                int g = clamp((y - 100 * u - 208 * v + 128) >> 8);
                int b = clamp((y + 516 * u + 128) >> 8);
                rgb[j * width + i] = 0xff000000 | (r << 16) | (g << 8) | b;
            }
        }
        Bitmap source = Bitmap.createBitmap(rgb, width, height, Bitmap.Config.ARGB_8888);
        Bitmap upright = source;
        try {
            if (clockwiseDegrees != 0) {
                Matrix orientation = new Matrix();
                orientation.postRotate(clockwiseDegrees);
                upright = Bitmap.createBitmap(source, 0, 0, width, height, orientation, true);
            }
            ByteArrayOutputStream jpeg = new ByteArrayOutputStream(48 * 1024);
            if (!upright.compress(Bitmap.CompressFormat.JPEG, 75, jpeg))
                throw new IllegalStateException("JPEG encoding failed");
            return Base64.encodeToString(jpeg.toByteArray(), Base64.NO_WRAP);
        } finally {
            if (upright != source) upright.recycle();
            source.recycle();
        }
    }

    private static int clamp(int n) { return Math.max(0, Math.min(255, n)); }

    private static final class Plane {
        final ByteBuffer data;
        final int row, pixel;
        Plane(Image.Plane p) {
            data = p.getBuffer().slice();
            row = p.getRowStride();
            pixel = p.getPixelStride();
        }
        int get(int x, int y) { return data.get(y * row + x * pixel) & 0xff; }
    }
}
