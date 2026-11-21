#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace aether {

// ARKit depth is axial Z (metres). The RGB intrinsics below have already been scaled
// into depth-map pixel coordinates. CVPixelBuffer rows may have padding.
struct DepthMap {
    const float *depth;
    const uint8_t *confidence;
    size_t width, height, depthStride, confidenceStride;
    float fx, fy, cx, cy;
    float worldUpX, worldUpY, worldUpZ;
};

struct Reading { float center = NAN; float near = NAN; };

enum class Patch { Center, Forward, NamedTarget };

inline float patchRange(const DepthMap &m, float nx, float ny, Patch kind) {
    const int x = static_cast<int>(nx * m.width), y = static_cast<int>(ny * m.height);
    if (x < 2 || y < 2 || x + 2 >= static_cast<int>(m.width) || y + 2 >= static_cast<int>(m.height))
        return NAN;
    std::array<float, 25> values{};
    size_t count = 0;
    for (int j = y - 2; j <= y + 2; ++j) {
        for (int i = x - 2; i <= x + 2; ++i) {
            float z = m.depth[j * m.depthStride + i];
            // Medium/high confidence only. Ignore missing and out-of-range LiDAR pixels.
            const uint8_t confidence = m.confidence[j * m.confidenceStride + i];
            const bool confident = confidence == 2 || (confidence == 1 && kind != Patch::NamedTarget);
            if (!confident || !std::isfinite(z) || z < .20f || z > 5.f) {
                if (kind == Patch::NamedTarget && i == x && j == y) return NAN;
                continue;
            }
            const float cameraX = (i - m.cx) * z / m.fx;
            const float cameraY = (m.cy - j) * z / m.fy;
            values[count++] = std::sqrt(z * z + cameraX * cameraX + cameraY * cameraY);
        }
    }
    if (count < (kind == Patch::NamedTarget ? 21u : 15u)) return NAN;
    std::sort(values.begin(), values.begin() + count);
    const float median = values[count / 2];
    // A named object is matched visually at the image center. Every confident
    // sample in this patch must agree, including the exact center pixel.
    if (kind == Patch::NamedTarget && values[count - 1] - values[0] > std::max(.08f, median * .05f)) return NAN;
    // Require coherent neighboring measurements to reject edges of holes and depth jumps.
    if (values[3 * count / 4] - values[count / 4] > std::max(.12f, median * .10f)) return NAN;
    // Test height only AFTER checking coherence: filtering out far wall pixels first
    // could turn a noisy foreground/background edge into a seemingly reliable patch.
    const float rayX = (x - m.cx) / m.fx, rayY = (m.cy - y) / m.fy;
    const float axial = median / std::sqrt(1.f + rayX * rayX + rayY * rayY);
    const float heightFromPhone = axial * (rayX * m.worldUpX + rayY * m.worldUpY - m.worldUpZ);
    if (kind == Patch::Forward && (heightFromPhone < -.50f || heightFromPhone > .55f)) return NAN;
    return median;
}

inline Reading measure(const DepthMap &m) {
    Reading out;
    if (!m.depth || !m.confidence || m.width < 16 || m.height < 16 || m.depthStride < m.width ||
        m.confidenceStride < m.width || !(m.fx > 0 && m.fy > 0)) return out;
    out.center = patchRange(m, .5f, .5f, Patch::Center);
    // Only real surfaces in the central forward field are considered. This cannot cover
    // the whole path, floor-level obstacles, or surfaces without a confident return.
    for (int j = 0; j < 7; ++j) {
        for (int i = 0; i < 7; ++i) {
            float d = patchRange(m, .26f + i * .08f, .26f + j * .08f, Patch::Forward);
            if (std::isfinite(d) && (!std::isfinite(out.near) || d < out.near)) out.near = d;
        }
    }
    return out;
}
} // namespace aether
