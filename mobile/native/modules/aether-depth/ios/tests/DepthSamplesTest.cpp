#include "../DepthSamples.hpp"
#include <cassert>
#include <vector>

int main() {
    constexpr size_t width = 96, height = 72, stride = width + 4;
    std::vector<float> pixels(stride * height, NAN);
    std::vector<uint8_t> confidence((stride + 2) * height, 1);
    for (size_t y = 0; y < height; ++y)
        std::fill_n(&pixels[y * stride], width, 2.5f);
    aether::DepthMap m{pixels.data(), confidence.data(), width, height, stride, stride + 2,
                       90.f, 90.f, 48.f, 36.f, 0.f, 1.f, 0.f};
    auto reading = aether::measure(m);
    assert(std::abs(reading.center - 2.5f) < .005f && reading.near > 2.f);
    const auto target = [&] { return aether::patchRange(m, .5f, .5f, aether::Patch::NamedTarget); };
    assert(!std::isfinite(target())); // medium confidence only
    std::fill(confidence.begin(), confidence.end(), 2);
    assert(std::abs(target() - 2.5f) < .005f);
    confidence[36 * (stride + 2) + 48] = 0;
    assert(!std::isfinite(target())); // no reading at the sight line itself
    confidence[36 * (stride + 2) + 48] = 2;
    pixels[35 * stride + 47] = 1.0f;
    assert(!std::isfinite(target())); // a second surface touches the named target
    pixels[35 * stride + 47] = 2.5f;
    for (int x = 46; x <= 50; ++x) confidence[34 * (stride + 2) + x] = 0;
    assert(!std::isfinite(target())); // only 20 of 25 reliable samples
    std::fill(confidence.begin(), confidence.end(), 2);

    // An off-axis obstruction in front of the phone must be measured even when the
    // center of the camera still sees the far wall. Distances reflect slant range.
    for (int y = 30; y < 42; ++y) std::fill_n(&pixels[y * stride + 24], 10, 1.25f);
    reading = aether::measure(m);
    assert(std::abs(reading.center - 2.5f) < .005f);
    assert(reading.near > 1.25f && reading.near < 1.31f);

    // Isolated outliers and holes can't produce a short-distance warning.
    for (size_t y = 0; y < height; ++y) std::fill_n(&pixels[y * stride], width, 3.f);
    pixels[36 * stride + 48] = .3f;
    assert(aether::measure(m).near >= 3.f);
    for (size_t y = 0; y < height; ++y)
        for (size_t x = 0; x < width; ++x) pixels[y * stride + x] = x % 2 ? 1.f : 4.f;
    assert(!std::isfinite(aether::measure(m).center));
    assert(!std::isfinite(aether::measure(m).near));

    // Pointed down at a level floor: deliberate center ranging still works, but
    // the floor below phone height isn't a forward obstacle.
    std::fill(pixels.begin(), pixels.end(), 1.3f);
    m.worldUpY = 0; m.worldUpZ = 1;
    reading = aether::measure(m);
    assert(reading.center >= 1.3f && reading.center < 1.31f && !std::isfinite(reading.near));
    m.worldUpY = 1; m.worldUpZ = 0;
    std::fill(confidence.begin(), confidence.end(), 0);
    reading = aether::measure(m);
    assert(!std::isfinite(reading.center) && !std::isfinite(reading.near));
    std::fill(confidence.begin(), confidence.end(), 2);
    std::fill(pixels.begin(), pixels.end(), INFINITY);
    reading = aether::measure(m);
    assert(!std::isfinite(reading.center) && !std::isfinite(reading.near));
}
