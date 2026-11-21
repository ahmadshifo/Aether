package expo.modules.aetherdepth;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.junit.Test;
import static org.junit.Assert.*;

public class DepthSamplingTest {
    private static final int SIZE = 80, DROW = SIZE * 4 + 8, CROW = SIZE * 2 + 8;
    private final ByteBuffer depth = ByteBuffer.allocate(SIZE * DROW).order(ByteOrder.LITTLE_ENDIAN);
    private final ByteBuffer confidence = ByteBuffer.allocate(SIZE * CROW);
    private final float[] up = {0, 1, 0};
    private final DepthSampling pixels = new DepthSampling(SIZE, SIZE, depth, DROW, 4,
        confidence, CROW, 2, 80, 80, 40, 40, up);

    private void set(int x, int y, int mm, int quality) {
        depth.putShort(y * DROW + 4 * x, (short) mm);
        confidence.put(y * CROW + 2 * x, (byte) quality);
    }
    private void fill(int x, int y, int mm, int quality) {
        for (int j = y - 3; j <= y + 3; j++)
            for (int i = x - 3; i <= x + 3; i++) set(i, j, mm, quality);
    }

    @Test public void reportsNearestConfidentPatchAndCenterIndependently() {
        fill(40, 40, 3100, 255);
        fill(20, 40, 1500, 255);
        assertEquals(3.1f, pixels.center(.5f, .5f), .01f);
        assertEquals(1.55f, pixels.near(), .02f);
    }
    @Test public void isolatedNoiseMissingLowConfidenceAndImplausibleRangesAreUnknown() {
        fill(40, 40, 900, 140);
        set(40, 40, 900, 255);
        assertTrue(Float.isNaN(pixels.center(.5f, .5f)));
        assertTrue(Float.isNaN(pixels.near()));
        fill(40, 40, 5001, 255);
        assertTrue(Float.isNaN(pixels.near()));
        fill(40, 40, 0, 255);
        assertTrue(Float.isNaN(pixels.center(.5f, .5f)));
    }
    @Test public void sensorPointedAtFloorDoesNotTriggerObstacleWarning() {
        up[1] = 0;
        up[2] = 1;
        fill(40, 40, 1300, 200);
        assertEquals(1.3f, pixels.center(.5f, .5f), .01f);
        assertTrue(Float.isNaN(pixels.near()));
    }
    @Test public void depthBoundaryDoesNotBecomeAMeasuredSurface() {
        for (int j = 37; j <= 43; j++)
            for (int i = 37; i <= 43; i++) set(i, j, (i + j) % 2 == 0 ? 750 : 3100, 255);
        assertTrue(Float.isNaN(pixels.center(.5f, .5f)));
    }
    @Test public void samplesTheRgbCenterMappedToTheDepthTexture() {
        fill(20, 40, 1300, 240);
        assertTrue(Float.isNaN(pixels.center(.5f, .5f)));
        assertEquals(1.34f, pixels.center(.25f, .5f), .02f);
        assertTrue(Float.isNaN(pixels.center(-.1f, .5f)));
    }
    @Test public void refusesBackgroundRangeWhenTheAimPointHasAnEdgeOrHole() {
        fill(40, 40, 3500, 255);
        set(40, 40, 800, 255);
        assertTrue(Float.isNaN(pixels.center(.5f, .5f)));
        for (int j = 39; j <= 41; j++)
            for (int i = 39; i <= 41; i++) set(i, j, 0, 0);
        assertTrue(Float.isNaN(pixels.center(.5f, .5f)));
    }
    @Test public void requiresTheExactAimPixelAndCoherentNeighborsForDistanceQuestions() {
        fill(40, 40, 1400, 255);
        set(40, 40, 0, 0);
        assertTrue(Float.isNaN(pixels.center(.5f, .5f)));
        assertEquals(1.4f, pixels.near(), .02f);
        set(40, 40, 1400, 255);
        set(41, 40, 1510, 255);
        assertTrue(Float.isNaN(pixels.center(.5f, .5f)));
    }
}
