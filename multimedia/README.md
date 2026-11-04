<!-- Member 3's guide: owns the frame analysis pipeline, multimedia storage, semantic search and retrieval APIs. -->
# Member 3 - Multimedia Database and Image Processing

Own `processing/`, `database/` and `api/`. Begin with sample videos, not the live phone stream. Only send selected informative frames to cloud vision/OCR APIs.

Expose the exact endpoints in `shared/contracts/api-v1.yaml`. The Web AI service must never access your tables directly.

## Task 2: local video reader

`processing/video_reader.py` opens a local video with OpenCV, reports metadata,
and reads one BGR NumPy array at a time. It does not display a window or save
frames. Use the existing dependencies in `api/requirements.txt`; no additional
packages are required.

Open this repository in VS Code. In its PowerShell terminal, activate the
existing environment and enter the multimedia directory:

```powershell
cd "C:\Users\Technoline\Desktop\multimedia-project"
.\multimedia\.venv\Scripts\Activate.ps1
cd multimedia
python --version
```

Python should report 3.13.7. Replace the example MP4 path below with a local
prerecorded video. Absolute paths work, including paths with spaces. Relative
paths are resolved from the current terminal directory.

```powershell
# Read at most 30 frames.
python processing/video_reader.py --video "C:\Videos\sample.mp4" --max-frames 30

# Read the entire video until OpenCV reports no more frames.
python processing/video_reader.py --video "C:\Videos\sample.mp4"

# Test the 10-frame limit.
python processing/video_reader.py --video "C:\Videos\sample.mp4" --max-frames 10

# Test a missing file (expected failure).
python processing/video_reader.py --video "tests/test_videos/does-not-exist.mp4"
$LASTEXITCODE
```

A successful run prints `Video opened successfully`, the actual width, height,
FPS, total frames, estimated duration, `Frames successfully read: ...`, and
`Video released successfully`. The count is 10 for the 10-frame command when
the video contains at least 10 readable frames. A shorter video stops at its
end. Without a limit, the count includes all frames successfully decoded.

Metadata comes from the video backend. Unavailable or invalid metadata prints
`Unavailable`; duration is estimated as frame count divided by FPS only when
both are finite and positive. It may be approximate for variable-frame-rate
videos. OpenCV's failed-read result marks the end of reading; it does not
reliably distinguish normal EOF from a decoding failure within a video.

A missing file prints `Error: Video file not found: ...`; an empty file prints
`Error: Video file is empty: ...`; an unsupported or corrupted file prints
`Error: Cannot open video: ...`. These failures return exit code 1. Invalid
CLI arguments return exit code 2. OpenCV can also print decoder diagnostics.
Successful commands return exit code 0. An unexpectedly low frame count can
indicate an incomplete or damaged video.

For use in later processing code, keep frame processing inside the context
manager so resources are released even on an exception or an early break:

```python
from processing.video_reader import VideoReader

with VideoReader("C:/Videos/sample.mp4") as reader:
    metadata = reader.get_metadata()
    for frame in reader.read_frames(max_frames=30):
        print(frame.shape)  # (height, width, 3), uint8 BGR array
    print(reader.frames_read)
```

Run the automated tests from `multimedia/` with the environment activated:

```powershell
python -m pytest tests/test_video_reader.py -v
python -m pytest tests/test_setup.py -v
python -m pytest tests/ -v
```

If Windows denies access to pytest's default temporary or cache directory,
use the Task 3 test commands below with a fresh temporary directory.

Tests generate and verify a temporary 20-frame MJPG AVI using OpenCV; no video
download, network, database, or live stream is needed. Temporary test videos
are cleaned up by pytest. The local MP4 commands above separately verify MP4
support in your OpenCV installation. `pytest.ini` makes the processing package
importable when running tests from this directory or the repository root.

## Task 3: frame extraction

`processing/frame_extractor.py` reuses Task 2's `VideoReader`. It yields an
`ExtractedFrame` dataclass with `source_video`, zero-based `frame_index`,
video-relative `timestamp_ms`, a BGR NumPy `frame`, and optional `captured_at`.
No image is saved unless the caller explicitly uses `save_frame` or `--output`.

Sampling starts at frame 0. For each requested time, the extractor selects the
first available frame at or after that time. Targets are calculated from the
sample number and the actual FPS, rather than repeatedly adding a rounded
frame step. For example, 7.5 FPS at a 1-second interval selects indices
0, 8, 15, 23, and so on. Timing error is less than one source-frame period.
Intervals shorter than a frame period return each frame once, without
duplicates. Frames are decoded sequentially, with constant memory use.

The timestamp is `frame_index / FPS * 1000`, never wall-clock time. This assumes
constant frame rate; timings for variable-frame-rate videos are approximate.
Missing or invalid FPS is rejected rather than guessed. As with Task 2,
OpenCV cannot always distinguish an internal decoding failure from EOF.

Keep extraction and any subsequent image processing inside a context manager:

```python
from processing.frame_extractor import FrameExtractor, save_frame

with FrameExtractor("C:/Videos/sample.mp4", interval=1, max_frames=5) as extractor:
    for extracted in extractor.extract_frames():
        print(extracted.frame_index, extracted.timestamp_ms, extracted.frame.shape)
        # Optional, separate from extraction:
        # save_frame(extracted, "output/frames")
```

The reader is released at EOF, at the extraction limit, on failure, or when
leaving the with block after an early break. Saving uses original indices in
filenames such as `frame_000030.jpg`. Use separate output directories for
different videos; matching filenames in an existing directory are overwritten.
An error while saving is reported and earlier saved images remain available.

For manual testing, activate the environment as shown above and run these
commands from `multimedia/`. Replace the MP4 path with an existing local file:

```powershell
# One image per second, maximum five images, with optional JPEG output.
python -m processing.frame_extractor --video "C:\Videos\sample.mp4" --interval 1 --max-frames 5 --output "output/frames_1s"
Get-ChildItem "output/frames_1s" -Filter *.jpg

# Two images per second, without saving.
python -m processing.frame_extractor --video "C:\Videos\sample.mp4" --interval 0.5 --max-frames 5

# One image every two seconds, until EOF.
python -m processing.frame_extractor --video "C:\Videos\sample.mp4" --interval 2

# Expected errors (exit code 1).
python -m processing.frame_extractor --video "missing.mp4"
python -m processing.frame_extractor --video "C:\Videos\sample.mp4" --interval 0
$LASTEXITCODE
```

If you do not have a local video, generate a six-second MJPG AVI locally using
the existing OpenCV and NumPy dependencies. No teammate or download is needed:

```powershell
$sampleVideoDir = Join-Path $env:TEMP ("aether-video-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $sampleVideoDir | Out-Null
$sampleVideo = Join-Path $sampleVideoDir "sample.avi"
@'
import sys
import cv2
import numpy as np
writer = cv2.VideoWriter(sys.argv[1], cv2.VideoWriter_fourcc(*"MJPG"), 10, (320, 240))
assert writer.isOpened(), "Could not create MJPG video"
try:
    for index in range(60):
        image = np.full((240, 320, 3), index * 4, dtype=np.uint8)
        cv2.putText(image, str(index), (30, 120), cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 0, 255), 3)
        writer.write(image)
finally:
    writer.release()
capture = cv2.VideoCapture(sys.argv[1])
try:
    assert capture.isOpened() and capture.read()[0], "Generated video is unreadable"
finally:
    capture.release()
'@ | python - "$sampleVideo"

python -m processing.frame_extractor --video "$sampleVideo" --interval 1 --max-frames 5 --output "$sampleVideoDir/frames"
Get-ChildItem "$sampleVideoDir/frames" -Filter *.jpg
Invoke-Item "$sampleVideoDir/frames"
```

For this generated video, expect resolution 320x240, FPS 10, and frames 0, 10,
20, 30, 40 at 0, 1000, 2000, 3000, 4000 ms. Expect five JPEGs,
`Total extracted frames: 5`, `Images saved successfully to: ...`, and
`Extraction completed; video released successfully`. Exit code 0 indicates
success. Other videos report their actual dimensions, FPS, and sample positions.
An `Error: ...` message and exit code 1 indicate an input, decoding, or saving
problem. Invalid argument syntax returns exit code 2.

Without a supplied start time, `captured_at` is None. Only when you know the
actual recording start time, pass a timezone-aware Python `datetime` as
`recording_start` or use `--recording-start "YYYY-MM-DDTHH:MM:SS+00:00"` on the
CLI (replace the placeholder with that actual time). The result is UTC ISO
8601 with `Z`. Naive dates are rejected; no recording time is invented.

Run Task 3 independently, then all multimedia regression tests using the
Windows-compatible configuration. Generate a fresh path for each invocation:

```powershell
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/test_frame_extractor.py -v --basetemp "$pytestTemp" -p no:cacheprovider

$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/ -v --basetemp "$pytestTemp" -p no:cacheprovider
```

Task 3 tests generate deterministic, independently verified MJPG AVI files in
pytest temporary directories. They require no APIs, database, GUI, or stream.
No filtering, OCR, AI processing, or database integration is implemented here.

## Task 4: image sharpness evaluation

`processing/quality_filter.py` provides `calculate_sharpness(image)`,
`is_blurry(image, threshold=100.0)`, and `evaluate_quality(image, threshold=100.0)`.
It accepts nonempty uint8 grayscale `(H, W)`, BGR `(H, W, 3)`, and BGRA
`(H, W, 4)` NumPy arrays, matching the images produced by Task 3. BGRA alpha
is ignored. Other pixel types, including floating-point NaN/Inf data and
16-bit images, are rejected explicitly instead of being silently rescaled.
The input pixels are preserved; grayscale inputs need no color conversion.

Sharpness is `cv2.Laplacian(gray, cv2.CV_64F).var()`, returned as a finite,
nonnegative Python float. `evaluate_quality` returns a `QualityResult` with
`sharpness_score`, `threshold`, `is_blurry`, and `accepted`. A score strictly
below the threshold is blurry. Equality passes; accepted only means that
the selected sharpness condition is met. It does not mean informative.
Thresholds must be finite, nonnegative real numbers; booleans are rejected.

The score is a heuristic, not an AI confidence probability. A simple scene
can score low while noise can score high. Resolution, compression, contrast,
and image content affect scores. Start with labeled representative sharp and
blurred images at the resolution used by your extractor, inspect their score
distributions, then choose a threshold that separates them as well as possible
and check it on additional images. The default 100 is only an initial baseline.
The synthetic-pair midpoint below demonstrates calibration for that pair;
it is not a production threshold. This module never deletes or enhances images.

For manual testing, activate the existing environment and run from multimedia:

```powershell
cd "C:\Users\Technoline\Desktop\multimedia-project"
.\multimedia\.venv\Scripts\Activate.ps1
cd multimedia

# Generate a sharp image and its Gaussian-blurred copy, without a GUI.
python -m scripts.generate_quality_samples --output "output/quality_samples"

# Analyze both actual PNG files using the default baseline.
python -m processing.quality_filter --image "output/quality_samples/sharp.png"
python -m processing.quality_filter --image "output/quality_samples/blurred.png"

# Calibrate a threshold directly from the scores of this generated pair.
$qualityThreshold = python -c "import cv2; from processing.quality_filter import calculate_sharpness; print(sum(calculate_sharpness(cv2.imread(p)) for p in ['output/quality_samples/sharp.png', 'output/quality_samples/blurred.png']) / 2)"
python -m processing.quality_filter --image "output/quality_samples/sharp.png" --threshold "$qualityThreshold"
python -m processing.quality_filter --image "output/quality_samples/blurred.png" --threshold "$qualityThreshold"

# With threshold zero, any valid image meets the sharpness condition.
python -m processing.quality_filter --image "output/quality_samples/blurred.png" --threshold 0

# Controlled errors (exit code 1).
python -m processing.quality_filter --image "missing.png"
python -m processing.quality_filter --image "output/quality_samples/sharp.png" --threshold -1
$LASTEXITCODE
```

The generator creates `sharp.png` and `blurred.png` and prints their scores and
a suggested midpoint threshold. The sharp image should have a higher score.
Using the calibrated midpoint, the sharp image prints `Blurry: No` and
`Accepted: Yes`; the blurred image prints `Blurry: Yes` and `Accepted: No`.
Each successful analysis also prints resolution, measured score, threshold,
and `Analysis completed successfully` with exit code 0. A blurry classification
is still a successful analysis. Missing/unreadable images and invalid
thresholds print `Error: ...` with exit code 1; argument syntax errors return 2.

To analyze a JPEG saved by Task 3, replace the path below with an existing
extracted image:

```powershell
python -m processing.quality_filter --image "output/frames_1s/frame_000000.jpg" --threshold 100
```

For direct use with Task 3, evaluate each image inside the extractor context:

```python
from processing.frame_extractor import FrameExtractor
from processing.quality_filter import evaluate_quality

with FrameExtractor("C:/Videos/sample.mp4", max_frames=5) as extractor:
    for extracted in extractor.extract_frames():
        quality = evaluate_quality(extracted.frame, threshold=100)
        print(extracted.frame_index, extracted.timestamp_ms, quality)
```

The quality module receives only the NumPy image. It does not modify the frame
index, source path, relative timestamp, absolute timestamp, or image pixels.
No independent video reader, frame extractor, or full pipeline is introduced.

Run Task 4 independently and then all regressions with fresh Windows temp paths:

```powershell
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/test_quality_filter.py -v --basetemp "$pytestTemp" -p no:cacheprovider

$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/ -v --basetemp "$pytestTemp" -p no:cacheprovider
```

## Task 5: duplicate frame comparison

`processing/duplicate_filter.py` accepts the same uint8 grayscale, BGR, and
BGRA images as Task 4. Shared validation/conversion lives in
`processing/image_utils.py`; Task 4's scoring behavior is preserved. Invalid
types, empty images, unsupported shapes and pixel types are rejected with
clear exceptions. Alpha is ignored. Images and Task 3 metadata are preserved.

`calculate_dhash(image)` resizes grayscale to 9x8 with `cv2.INTER_AREA` and
compares each pixel with its neighbor to the right (`left > right`). The 64
comparisons are encoded in a Python integer, row by row, most significant bit
first. `hamming_distance(hash1, hash2)` uses XOR and `bit_count()` to return
0..64; both inputs must be unsigned 64-bit integer values.

`calculate_pixel_difference(image1, image2)` resizes each grayscale image to
128x128, consistently using `INTER_AREA` for both downscaling and upscaling,
then returns the mean of `cv2.absdiff` on a 0..255 scale. This normalizes image
dimensions, including aspect ratio, to a common square for comparison.

`compare_frames(a, b, hash_threshold=6, pixel_threshold=12.0)` returns a frozen
`DuplicateResult` with `hash_distance`, `pixel_difference`, both thresholds,
`is_duplicate`, and an `accepted` property. `are_duplicates(...)` returns just
the Boolean classification. Both inclusive conditions must pass:

```text
hash_distance <= hash_threshold AND pixel_difference <= pixel_threshold
```

Hash thresholds must be integers in 0..64; pixel thresholds must be finite,
nonnegative real numbers. Booleans are rejected for both. Threshold defaults
are preliminary. The result is a similarity heuristic, not proof of identical
content or semantic equivalence. Detection never saves or deletes images.

`DuplicateFilter.check(image)` accepts the first valid frame, then compares
against the last accepted frame. Only an accepted frame updates the reference.
It retains one independent 128x128 grayscale image and its 64-bit hash, so
memory does not grow with the sequence. Caller changes to an earlier image
cannot mutate that reference. Invalid input leaves the reference intact.
`reset()` clears it for a new video/session. First-frame distances are None
because there is no reference to compare; `is_duplicate=False`, `accepted=True`.

```python
from processing.frame_extractor import FrameExtractor
from processing.duplicate_filter import DuplicateFilter

detector = DuplicateFilter(hash_threshold=6, pixel_threshold=12)
with FrameExtractor("C:/Videos/sample.mp4") as extractor:
    for extracted in extractor.extract_frames():
        result = detector.check(extracted.frame)
        print(extracted.frame_index, result.is_duplicate)
detector.reset()
```

This only demonstrates Task 3 compatibility. It does not implement Task 6
quality/duplicate selection or a complete processing pipeline.

For headless manual testing from multimedia/ with the existing environment
activated, generate the example files and sequence demo locally:

```powershell
cd "C:\Users\Technoline\Desktop\multimedia-project"
.\multimedia\.venv\Scripts\Activate.ps1
cd multimedia
python -m scripts.generate_duplicate_samples

# A: identical images -> Duplicate: Yes, both distances zero.
python -m processing.duplicate_filter --image-a "output/duplicate_samples/frame_a.png" --image-b "output/duplicate_samples/frame_a.png"

# B: slight brightness change -> Duplicate: Yes with these thresholds.
python -m processing.duplicate_filter --image-a "output/duplicate_samples/frame_a.png" --image-b "output/duplicate_samples/frame_a_slight.png" --hash-threshold 0 --pixel-threshold 3

# C: different scenes -> Duplicate: No with the defaults.
python -m processing.duplicate_filter --image-a "output/duplicate_samples/frame_a.png" --image-b "output/duplicate_samples/frame_b.png"

# D: investigate changed text with default thresholds, then conservative ones.
python -m processing.duplicate_filter --image-a "output/duplicate_samples/room_205.png" --image-b "output/duplicate_samples/room_206.png"
python -m processing.duplicate_filter --image-a "output/duplicate_samples/room_205.png" --image-b "output/duplicate_samples/room_206.png" --hash-threshold 0 --pixel-threshold 0

# Invalid path -> meaningful error, exit code 1.
python -m processing.duplicate_filter --image-a "missing.png" --image-b "output/duplicate_samples/frame_a.png"
$LASTEXITCODE
```

The generator also runs scenario E: A, A, A, B, B, C prints Accepted, Duplicate,
Duplicate, Accepted, Duplicate, Accepted. It writes only the six demo PNGs;
the filter itself does no file storage. All valid CLI comparisons return exit
code 0 and end with `Analysis completed successfully`, regardless of whether
they report `Duplicate: Yes` or `Duplicate: No`. Input errors return 1; argument
syntax errors return 2.

In the verified generated examples, the identical pair scores 0/0; the slight
change scores hash 0, pixels 3; different scenes score hash 25, pixels about
183.02. The ROOM 205/206 pair scores hash 0 and pixels about 0.491: the defaults
classify it as duplicate despite the changed label. Setting both thresholds
to zero distinguishes this example. Even zero thresholds cannot guarantee
detection of tiny details removed by resizing or of color-only changes lost
in grayscale. No automatic frame deletion or semantic judgment is performed.

Calibrate thresholds on representative pairs at the expected image resolution,
including repeated scenes, changed text and useful small changes. Lowering
thresholds reduces the chance of classifying useful changes as duplicates but
can also preserve more repeated frames. Camera motion, crop/zoom, illumination,
noise and compression can change either score. Uniform images may have the
same hash even at very different brightness levels; the pixel comparison
guards against that case. This method does not compensate for motion or light.

Run only Task 5, then all regressions, with fresh Windows temporary paths:

```powershell
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/test_duplicate_filter.py -v --basetemp "$pytestTemp" -p no:cacheprovider

$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/ -v --basetemp "$pytestTemp" -p no:cacheprovider
```

## Task 6: useful frame selection

`processing/frame_selector.py` coordinates `FrameExtractor`, `evaluate_quality`,
and `DuplicateFilter`; it does not reimplement their algorithms. Use
`FrameSelector.evaluate(extracted_frame)` with Task 3's existing `ExtractedFrame`.
The returned `SelectionResult` includes source, index, video-relative timestamp,
optional supplied absolute timestamp, sharpness, duplicate measurements, the
acceptance flag, and a reason. No original image or metadata is changed.

The decision order is:

1. Invalid frame/image or timestamp: raise a meaningful exception, without
   changing state or statistics. Timestamps must be finite, nonnegative and
   monotonically nondecreasing, including timestamps of rejected frames.
2. Below the sharpness threshold: reject as `blurry`. Do not run duplicate
   comparison or update its reference.
3. First sufficiently sharp frame: accept as `first_frame`.
4. Different from the last accepted reference: accept as `new_scene`.
5. Clear duplicate at or beyond the maximum gap: accept as `periodic_frame`.
6. Other clear duplicates: reject as `duplicate`.

`new_scene` here means sufficiently different under Task 5's comparisons, not
semantic scene recognition. A sharpness score equal to the threshold passes.
For the first frame and blurry rejections, unavailable duplicate measurements
and the `is_duplicate` flag are None. A periodic acceptance retains
`is_duplicate=True`, so its reason remains distinguishable from visual change.

Default thresholds are sharpness=100, hash=6, pixels=12, maximum gap=10 seconds.
The gap calculation uses `(timestamp_ms - last_accepted_timestamp_ms) / 1000`,
never wall-clock time. Equality at the gap boundary permits periodic acceptance.
It never bypasses quality or creates missing frames; if no clear samples arrive,
the actual gap can exceed the configured value. New-scene acceptance takes
priority when it also occurs after the gap.

`max_gap_seconds=None` disables periodic coverage; use `--max-gap none` on the
CLI. Otherwise the gap must be finite and positive. Normal sharpness/duplicate
threshold validation is preserved. Task 5 now has `set_reference(image)` so
periodic acceptances can explicitly update its compact reference. Rejected
duplicates and blurry frames do not update it. Its existing `check()` behavior
is unchanged.

```python
from processing.frame_extractor import FrameExtractor
from processing.frame_selector import FrameSelector

selector = FrameSelector(sharpness_threshold=100, hash_threshold=6,
                         pixel_threshold=12, max_gap_seconds=10)
with FrameExtractor("C:/Videos/sample.mp4", interval=1) as extractor:
    for extracted in extractor.extract_frames():
        decision = selector.evaluate(extracted)
        print(extracted.frame_index, decision.accepted, decision.reason)
print(selector.stats)
selector.reset()  # Clear reference, timestamps, and counters for a new video.
```

Processing remains incremental. The selector keeps counters, two timestamps,
and Task 5's single compact reference, without accumulating full-sized frames
or decision history. Keep processing inside the extractor context for cleanup
on errors or early breaks. Results and stats contain no image arrays.

`selector.stats` returns a snapshot with these invariants:

```text
total_evaluated = accepted + rejected
accepted = first_frames + new_scenes + periodic_frames
rejected = blurry + duplicates
```

`duplicates` counts rejected duplicates only; periodically accepted duplicates
are counted under `periodic_frames`, not twice. Invalid calls raise rather than
returning a decision and are not counted as evaluated frames.

For reproducible manual testing, open a VS Code PowerShell terminal:

```powershell
cd "C:\Users\Technoline\Desktop\multimedia-project"
.\multimedia\.venv\Scripts\Activate.ps1
cd multimedia

# Generate a local eight-second video; no downloads or GUI are required.
python -m scripts.generate_selection_video

# Run with defaults. This short demo ends before the default 10-second gap.
python -m processing.frame_selector --video "output/selection_demo.avi" --interval 1

# Exercise periodic coverage and save accepted images only.
python -m processing.frame_selector --video "output/selection_demo.avi" --interval 1 --sharpness-threshold 100 --hash-threshold 6 --pixel-threshold 12 --max-gap 3 --output "output/selection_accepted"

# Count and list the JPEGs, then optionally open their folder.
(Get-ChildItem "output/selection_accepted" -Filter *.jpg).Count
Get-ChildItem "output/selection_accepted" -Filter *.jpg
Invoke-Item "output/selection_accepted"

# Change quality and duplicate thresholds for calibration.
python -m processing.frame_selector --video "output/selection_demo.avi" --sharpness-threshold 200 --hash-threshold 2 --pixel-threshold 3 --max-gap 3

# Disable periodic coverage, or use a real local prerecorded MP4.
python -m processing.frame_selector --video "output/selection_demo.avi" --max-gap none
python -m processing.frame_selector --video "C:\Videos\sample.mp4" --interval 1 --max-gap 10

# Invalid inputs return a controlled error and exit code 1.
python -m processing.frame_selector --video "missing.mp4"
python -m processing.frame_selector --video "output/selection_demo.avi" --interval 0
python -m processing.frame_selector --video "output/selection_demo.avi" --max-gap 0
$LASTEXITCODE
```

Use a fresh output directory for each run when comparing JPEG counts. Existing
images are not deleted; matching source-index filenames are overwritten, just
as in Task 3. The generator creates an 80-frame, 10 FPS, 160x128 MJPG AVI.
At interval=1 and max-gap=3, the expected decisions are:

| Video time | Source index | Decision |
|---|---:|---|
| 0 seconds | 0 | accepted: first_frame |
| 1 second | 10 | rejected: duplicate |
| 2 seconds | 20 | rejected: blurry |
| 3 seconds | 30 | accepted: new_scene |
| 4 seconds | 40 | rejected: duplicate |
| 5 seconds | 50 | rejected: blurry |
| 6 seconds | 60 | accepted: periodic_frame |
| 7 seconds | 70 | rejected: duplicate |

Expect 8 sampled frames evaluated, 3 accepted, 5 rejected, 2 blurry, 3 rejected
duplicates, 1 periodic frame, 1 new scene, and 1 first frame. A fresh output
folder contains exactly `frame_000000.jpg`, `frame_000030.jpg`, and
`frame_000060.jpg`. With defaults or coverage disabled, expect only 2 accepted
frames, 6 rejected, 2 blurry, and 4 rejected duplicates. Successful CLI runs
end with `Selection completed; video released successfully` and exit code 0.
Input/processing/saving errors print `Error: ...` and return 1; invalid CLI
syntax returns 2. Prior files can remain after a saving failure.

The earlier heuristic limitations still apply: small text changes may be
missed, grayscale ignores color-only differences, low-detail scenes can fail
sharpness, and motion or lighting can affect similarity. Calibrate on
representative videos before using these thresholds in later AI tasks.
This module makes local selection decisions only; no OCR, AI, database,
automatic deletion, or streaming integration is implemented.

Run Task 6 independently, followed by all existing regressions:

```powershell
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/test_frame_selector.py -v --basetemp "$pytestTemp" -p no:cacheprovider

$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/ -v --basetemp "$pytestTemp" -p no:cacheprovider
```

## Task 7: explicit single-image Mistral OCR

`processing/ocr_service.py` exposes `OCRService.extract_text(image)`. It accepts
the same uint8 grayscale, BGR and BGRA arrays as the other filters and validates
them through `image_utils.validate_image`. BGRA is converted to BGR, dropping
alpha; color BGR images remain in color. OpenCV encodes JPEG bytes in memory,
which become `data:image/jpeg;base64,...`. No temporary upload file or public
image URL is used. Source pixels and extracted-frame metadata remain unchanged.

The implementation was verified against installed official `mistralai` 2.10.1,
including its `mistralai.client.Mistral`, `client.ocr.process`, `OCRResponse`,
and page `markdown` fields. `api/requirements.txt` now requires that verified
SDK version or a later compatible 2.x release. See the official
[OCR guide](https://docs.mistral.ai/studio/document-processing/basic_ocr) and
[API reference](https://docs.mistral.ai/api/endpoint/ocr).

Each explicit `extract_text` call makes one request using the configured model,
an `image_url` document containing the data URL, `include_image_base64=False`,
a default SDK timeout of 30 seconds, and `retries=None`. Automatic retries are
disabled, including for 429 responses. Python callers may configure
`timeout_seconds` from 0.001 to 300. No requests happen on import or service
construction. SDK clients created by the service are closed after each call;
injected clients remain owned by their caller.

`OCRResult` has `text`, `model`, `has_text`, and `raw_markdown`. `model` is the
model identifier reported by the provider, which can be a resolved version
rather than the requested alias. Page markdown is combined in provider order
with a blank line between pages. `text` trims outer whitespace only; Markdown,
Arabic, accents, numbers, and internal line breaks are otherwise retained.
`raw_markdown` keeps the joined content without trimming. No translation,
guessed corrections, Markdown-to-text library, or confidence score is added.

A valid response with no text returns `text=""`, `has_text=False`. This is
different from an API failure: missing configuration, authentication/access,
network, timeout, rate-limit and malformed-response failures raise named
`OCRServiceError` subclasses. Billing and other HTTP failures raise
`OCRServiceError`. Invalid images raise TypeError/ValueError; JPEG failures
raise `ImageEncodingError`. Provider exception bodies and exception chains
are suppressed in public errors, so they cannot print keys or authenticated
requests. No Base64 data, keys, or OCR content is logged by the service.
The explicit CLI displays the requested OCR text as its intended output.

Configuration uses only `multimedia/api/.env` for an optional local file.
Existing process environment variables take precedence. The service reads
this file without modifying the global environment or interpolating values.
Model precedence is explicit `model=`/`--model`, then `MISTRAL_OCR_MODEL` from
the environment or local file, then `mistral-ocr-latest` when absent. Empty
model values are configuration errors. The key is `MISTRAL_API_KEY` and is
required before any non-injected request. No `.env` is created automatically.

Offline verification uses fake SDK clients and `httpx.MockTransport` with real
SDK response types; real HTTP transport is forbidden within the OCR tests.
No real key, network, or API credits are needed. Run all tests from
`multimedia/`: earlier CLI subprocess tests depend on that working directory.

```powershell
cd "C:\Users\Technoline\Desktop\multimedia-project"
.\multimedia\.venv\Scripts\Activate.ps1
cd multimedia

$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/test_ocr_service.py -v --basetemp "$pytestTemp" -p no:cacheprovider

$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/ -v --basetemp "$pytestTemp" -p no:cacheprovider

# Generate known sign and blank images locally. This sends no OCR request.
python -m scripts.generate_ocr_samples

# Test invalid paths without a cloud request.
python -m processing.ocr_service --image "missing.png"
```

For the separate optional REAL API test, configure your key locally. Never
paste it into chat or put it in `.env.example`. From `multimedia/`, preserve
an existing private configuration and create it only if absent:

```powershell
if (-not (Test-Path "api/.env")) { Copy-Item "api/.env.example" "api/.env" }
code "api/.env"

# Verify the private file is ignored and is not already tracked.
git check-ignore "api/.env"
git ls-files -- "api/.env"
```

In the local editor, fill in `MISTRAL_API_KEY` and keep
`MISTRAL_OCR_MODEL=mistral-ocr-latest`; preserve other configuration values.
`git check-ignore` should print `api/.env`, and `git ls-files` should print
nothing. Both conditions were verified for the repository's established path.
Do not proceed with a real key if the file is tracked. An environment variable
already set in PowerShell overrides values in this file, including a blank key.

Only run the following cloud commands when you want to send these synthetic
images to Mistral. Each command makes one request and may incur a charge:

```powershell
# Explicit real request 1: compare returned text with the known ROOM 205 sign.
python -m processing.ocr_service --image "output/ocr_samples/sign.png"

# Optional real request 2: blank-image behavior.
python -m processing.ocr_service --image "output/ocr_samples/blank.png"

# Optional model override (another real request if run).
python -m processing.ocr_service --image "output/ocr_samples/sign.png" --model "mistral-ocr-latest"

# Optional Arabic test: use an existing suitable image and inspect exact text.
python -m processing.ocr_service --image "C:\Images\arabic-sign.jpg"
```

The sample generator uses OpenCV's Latin font for `ROOM 205`; it does not
pretend to render Arabic with an unsupported font. Use a suitable local Arabic
image only if available. The offline suite separately verifies Arabic Unicode
preservation. Real recognition accuracy can vary and requires manual review.

A successful sign analysis prints `Recognized text:`, its actual returned
content, and `OCR completed successfully.` The expected sign content is
`ROOM 205`. A successful blank analysis should normally print `No text detected.`
Provider mistakes remain possible; the service does not fabricate an empty
success when a request fails. Success, including no text, returns exit code 0.
Failures print a sanitized `Error: ...` and return 1; invalid CLI syntax returns 2.
Missing-key errors identify the required configuration variable; authentication
or access errors suggest checking credentials/permissions; billing errors
suggest checking credits; rate-limit/quota errors suggest waiting or checking
account limits; network and timeout errors identify connectivity or timing.
The service never retries these automatically.

For later explicit use with Task 6, pass the original frame's image:

```python
from processing.ocr_service import OCRService

service = OCRService()  # No request here.
# Given one extracted frame and its existing selection decision:
if selection.accepted:
    ocr_result = service.extract_text(frame.frame)  # Explicit cloud request.
    ocr_text = ocr_result.text
```

This is a usage example only. OCR is not wired into video selection, directory
scanning, API routes, or the full pipeline. No database, captions, embeddings,
OCR caching, model training, or later task is implemented. Real Mistral access
must be validated separately with your configured credentials; offline tests
cannot verify account access, credits, network access, or recognition accuracy.

## Task 8: one-call object labels and scene captions

`processing/object_detector.py` provides `VisionService.analyze_image(image)`.
The returned `VisionResult` has `objects`, `caption`, `model`, and `uncertain`.
`processing/caption_service.py` provides `get_caption(analysis)` to read the
caption of that same result, with no additional request. Do not call
`analyze_image` twice to obtain the two fields. Each explicit call is a new
analysis; automatic caching and full pipeline orchestration are not implemented.

```python
from processing.object_detector import VisionService
from processing.caption_service import get_caption

service = VisionService()  # No network request.
# Given one existing extracted frame and its selection decision:
if selection.accepted:
    analysis = service.analyze_image(frame.frame)  # One explicit cloud request.
    objects = analysis.objects
    caption = get_caption(analysis)  # Local access only.
```

Object labels are strings normalized by trimming edges, lowercasing, removing
empty values and removing duplicates in first-seen order. Labels are not
mapped through a fixed vocabulary or aggressively merged. Caption formatting
trims only leading and trailing whitespace; meaningful internal content and
Unicode are retained. Empty objects are valid. An uninterpretable image may
return objects=[], caption="", uncertain=True; this remains a successful
analysis. `model` records the configured/requested model separately from
generated content. No bounding boxes, confidence probabilities, fabricated
timestamps, OCR text, or person identities are added.

The implementation uses the installed official OpenAI Python SDK 2.54.0;
`api/requirements.txt` requires that version or later compatible 2.x. The model
default remains exactly `gpt-5.4-mini`. Official sources verified for this task:
[model documentation](https://developers.openai.com/api/docs/models/gpt-5.4-mini),
[image inputs](https://developers.openai.com/api/docs/guides/images-vision), and
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
These document image input, Responses, and strict structured output support;
they do not establish access for your particular API account.

Shared `image_utils.py` now also contains the existing in-memory JPEG/Base64
helpers used by both providers. Task 7 continues to expose its helper imports
for compatibility. The same validation supports uint8 grayscale, BGR, and
BGRA arrays. BGRA loses alpha when encoded as JPEG; color BGR stays in color.
No source pixels or frame/session metadata are modified, and there is no
temporary JPEG file or public image URL.

The single Responses request contains reusable system instructions, one user
text input, one `input_image` with a JPEG data URL and `detail="high"`, plus
`text.format` configured with `type="json_schema"`, `strict=True`, and a schema
requiring `objects`, `caption`, and `uncertain` with no extra properties. The
1024-output-token cap keeps the output bounded. Requests use `store=False`,
the default 30-second SDK timeout, and `max_retries=0`, including when an
existing OpenAI client is injected through `with_options`. Python callers
may configure `timeout_seconds` from 0.001 to 300. Owned clients close after
the call; injected clients remain caller-owned.

The prompt requests important visible objects and a factual English caption
of one or two sentences, without speculation, identity recognition, judgments
that people are dangerous, or assertions that a path/environment is safe.
Text inside the image is treated as data rather than instructions. These are
descriptive model outputs, not verified physical-safety guidance or calibrated
detections. Inspect real outputs for hallucinations and omissions; strict JSON
validation ensures structure, not factual visual accuracy.

Parsing iterates output items so a reasoning item before the text does not
break it. Refusals, incomplete statuses, provider errors, missing output,
malformed JSON, missing fields, extra fields, and incorrect data types raise
controlled errors. It never turns a refusal/API failure into a successful
empty scene. Named exceptions distinguish configuration, authentication,
network, timeout, rate limit/quota, unavailable model, refusal, incomplete
output, and invalid response. Other HTTP errors include only their status;
raw provider bodies, credentials, and image payloads are suppressed.

Configuration follows Task 7: `multimedia/api/.env` is the only optional local
file, process environment variables take precedence, and no global dotenv
mutation occurs. Vision uses `OPENAI_API_KEY` and
`OPENAI_VISION_MODEL=gpt-5.4-mini`. Explicit `model=` or CLI `--model` overrides
the configured model. Mistral's key/model remain independent. No real `.env`
is created or altered by the implementation, and no API request happens on
module import or service construction.

Run all verification from `multimedia/` with the existing environment activated:

```powershell
cd "C:\Users\Technoline\Desktop\multimedia-project"
.\multimedia\.venv\Scripts\Activate.ps1
cd multimedia

# Object identification, offline.
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/test_object_detector.py -v --basetemp "$pytestTemp" -p no:cacheprovider

# Caption access, offline.
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/test_caption_service.py -v --basetemp "$pytestTemp" -p no:cacheprovider

# Task 8 together, offline.
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/test_object_detector.py tests/test_caption_service.py -v --basetemp "$pytestTemp" -p no:cacheprovider

# All regressions, offline.
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/ -v --basetemp "$pytestTemp" -p no:cacheprovider
```

Task 8's fixtures are opt-in, so earlier suites keep their existing setup. The
vision suites use realistic SDK responses and an in-memory HTTP transport;
real transport is blocked. No API key or cloud credits are required. The test
`test_objects_and_caption_use_exactly_one_api_request` verifies that reading
both outputs and repeatedly accessing the caption still makes just one call.

For OPTIONAL real verification, first configure your key in the same local
file as Task 7; never paste it into chat. Preserve an existing private file:

```powershell
if (-not (Test-Path "api/.env")) { Copy-Item "api/.env.example" "api/.env" }
code "api/.env"
git check-ignore "api/.env"
git ls-files -- "api/.env"
```

Set `OPENAI_API_KEY` locally and add/retain
`OPENAI_VISION_MODEL=gpt-5.4-mini`, preserving Mistral and other variables.
`git check-ignore` must print the path and `git ls-files` must print nothing;
these conditions are verified for the established repository path. Existing
PowerShell environment variables override `.env`, including blank values.

The following commands each make ONE paid-capable vision request when you
explicitly run them. Replace paths with non-sensitive local photographs;
there is no required download or exact expected caption wording:

```powershell
# A: inspect objects and caption against a clear room photograph.
python -m processing.object_detector --image "C:\Images\room.jpg"

# B: compare a different scene such as a door/corridor/stairs.
python -m processing.object_detector --image "C:\Images\corridor.jpg" --model "gpt-5.4-mini"

# C: create a blank locally, then optionally analyze it (one real request).
python -m scripts.generate_ocr_samples
python -m processing.object_detector --image "output/ocr_samples/blank.png"

# D: invalid path; no cloud request.
python -m processing.object_detector --image "missing.jpg"
$LASTEXITCODE

# E: prove one-call behavior offline without paying for two analyses.
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/test_caption_service.py -k objects_and_caption_use_exactly_one_api_request -v --basetemp "$pytestTemp" -p no:cacheprovider
```

Successful CLI output shows the configured model, actual normalized objects,
actual caption, `Uncertain: Yes/No`, and `Analysis completed successfully.`
Exit code 0 includes valid uncertain/empty scenes. A blank should not produce
invented detailed content; inspect this behavior rather than assuming perfect
model recognition. Missing/unreadable files, credentials, unavailable models,
timeouts, refusals and other failures print sanitized `Error: ...` with exit
code 1; invalid argument syntax returns 2. A model-unavailable error means
the model name or account permissions need checking; rate/quota errors may
require checking usage limits or credits. No automatic retries occur.

Only a successful explicit real request can verify this account's model
access and recognition behavior. No live OpenAI call was performed during
implementation. There is no face-recognition system, model training,
image-generation API, automatic video/folder analysis, database integration,
embeddings, or Task 9 implementation here.

## Task 9: semantic text embeddings

`processing/embedding_service.py` combines existing OCR text, object labels,
and captions into searchable text and embeds it with the official OpenAI SDK.
It also embeds English/Arabic search queries using the same model and fixed
1536 dimensions. No image is submitted to this API, and no OCR/vision call,
database, search endpoint, or full pipeline is triggered.

`build_frame_description(ocr_text=None, objects=None, caption=None)` uses
Scene, Objects, Visible text order, omitting empty/missing sections. It trims
outer whitespace, preserves internal OCR/caption content and Unicode, and
reuses Task 8 object normalization without mutating the original labels.
It adds no punctuation to the supplied caption/OCR or object list. For example:

```text
Scene: A wooden door in a university corridor.
Objects: door, sign, wall
Visible text: ROOM 205
```

No frame ID, file path, timestamp, guessed text, or placeholder is inserted.
The function returns "" if all metadata is empty. `embed_frame` then returns
None, explicitly meaning skipped/no usable semantic text, with no API call.
An empty query is an error instead. A failure is never disguised as a skipped
frame or a fabricated zero vector.

```python
from processing.embedding_service import EmbeddingService

service = EmbeddingService()  # No request on construction.
# Given existing Task 7 OCRResult and Task 8 VisionResult objects:
result = service.embed_frame(ocr_text=ocr_result.text,
                             objects=vision_result.objects,
                             caption=vision_result.caption)
if result is not None:
    print(result.model, result.dimensions)  # Do not log the full vector.
query = service.embed_query("What was written on the classroom door?")
```

Every explicit nonempty embedding operation makes one
`client.embeddings.create(model=..., input=text, dimensions=1536,
encoding_format="float", timeout=30)` request. Automatic retries are disabled
with `with_options(max_retries=0)`, even on injected SDK clients. Owned clients
are closed after each call, and injected clients stay caller-owned. Python
callers may configure a finite timeout from 0.001 to 300 seconds.

The installed SDK 2.54.0 supports this exact interface. Official references:
[Embeddings guide](https://developers.openai.com/api/docs/guides/embeddings)
and [create API](https://developers.openai.com/api/reference/resources/embeddings/methods/create).
The chosen model is `text-embedding-3-small`; its default vector dimension is
1536 and the provider's per-input limit is 8192 tokens.

This implementation uses a deliberately conservative local **8192 UTF-8 byte**
cap, not a character count or a tokenizer. This avoids adding tokenizer/data
download dependencies and rejects oversized inputs before any request, without
silently truncating OCR. Arabic and other Unicode can consume multiple bytes
per character. Some text that would fit the provider's token budget is rejected
by this stricter local cap. No claim is made that bytes or characters equal
tokens; provider validation remains authoritative for API token-limit errors.

`EmbeddingResult` has `model`, `dimensions`, `source_text`, and a list of 1536
Python floats under `embedding`. Response validation requires exactly one
vector at input index zero, the configured model identifier, the correct
length, finite real values, and a nonzero magnitude. Booleans, missing vectors,
wrong dimensions, malformed responses and model mismatches are rejected.
Source text and the vector are omitted from the default dataclass repr.
The service never normalizes, pads, truncates, or invents a returned vector.

`cosine_similarity(a, b)` accepts one-dimensional numeric lists, tuples or
NumPy arrays with equal nonzero length. It rejects empty/zero-magnitude,
non-finite, complex and nonnumeric inputs. Scaling before taking norms avoids
overflow/underflow on large or tiny finite numbers. It preserves its inputs
and returns a finite float in [-1, 1]. Similarity is not a probability or model
confidence. Identical vectors score about 1, orthogonal about 0, opposite about -1.

Configuration follows Tasks 7/8: process variables override the single local
`multimedia/api/.env`, with no global environment mutation. The template adds:

```dotenv
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536
```

The existing `OPENAI_API_KEY` is reused. Empty model identifiers and dimension
settings other than integer 1536 are rejected. Model overrides are supported
for future deliberate migrations, but the response must identify the same
configured model. Frame and query results from different models must never
be mixed, even if their vector lengths match. Regenerate stored frame vectors
and query vectors together if the model changes. The pure cosine utility sees
numeric vectors only; callers must check result.model/dimensions before mixing
results. Existing `VECTOR(1536)` SQL and API contract fields were inspected;
neither the schema nor shared interfaces were changed.

All tests are offline, using deterministic SDK responses and an in-memory HTTP
transport. The private `.env` is never printed, changed, or required for tests.
Task 9 also verifies that this private path is ignored/untracked and that
credential fields in `.env.example` remain empty. Real credential values found
in the template were cleared; revoke and replace those exposed keys, storing
replacements only in the private `.env`.

Run from `multimedia/` in VS Code PowerShell:

```powershell
cd "C:\Users\Technoline\Desktop\multimedia-project"
.\multimedia\.venv\Scripts\Activate.ps1
cd multimedia

$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/test_embedding_service.py -v --basetemp "$pytestTemp" -p no:cacheprovider

$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/ -v --basetemp "$pytestTemp" -p no:cacheprovider

# Empty metadata: explicit skip, no request, exit code 0.
python -m processing.embedding_service

# Empty query: error before any request, exit code 1.
python -m processing.embedding_service --query ""
```

Named exceptions distinguish missing configuration, authentication/access,
rate-limit/quota, timeout/network and invalid embedding responses. Other HTTP
errors retain only their status; provider bodies and exception chains are
suppressed. Recognized exhausted-credit or spend/usage quota codes produce a
billing/limits message distinct from generic throttling. No automatic retries
occur. A failed call raises an exception, not an embedding or None.

For OPTIONAL real API verification, open the existing private file locally:

```powershell
if (-not (Test-Path "api/.env")) { Copy-Item "api/.env.example" "api/.env" }
code "api/.env"
git check-ignore "api/.env"
git ls-files -- "api/.env"
```

Configure a valid replacement `OPENAI_API_KEY` locally and the embedding model
and dimensions above, preserving other fields. Do not paste keys into chat or
the template. `check-ignore` should print the private path; `ls-files` should
print nothing. Existing PowerShell variables override the file. Your earlier
429 response may require fixing credits/limits before any live test succeeds;
offline passing tests do not establish account access or billing availability.

Choose either the three-request demo below or individual CLI requests; there
is no need to repeat all of them. The demo makes exactly three embedding calls
(door, laptop, query), prints vector summaries and both actual cosine scores,
and writes no vector files. It never calls OCR or Vision:

```powershell
# LIVE: three deliberate requests covering manual scenarios A-D together.
python -m scripts.demo_embedding_similarity

# Alternatively, individual LIVE commands, one request each:
python -m processing.embedding_service --caption "A wooden door in a university corridor." --objects "door,sign,wall" --ocr-text "ROOM 205"
python -m processing.embedding_service --caption "A laptop is placed on a desk." --objects "laptop,keyboard,desk"
python -m processing.embedding_service --query "What was written on the classroom door?"
```

Successful CLI output prints actual source text, model, `Vector dimensions:
1536`, five actual vector values as a preview, and a completion message. It
does not print all 1536 values. Query/frame CLI options cannot be combined.
Input, configuration and provider failures print sanitized `Error: ...` and
return exit code 1; argument syntax errors return 2. Success and empty-frame
skips return 0. The demo reports whether its two frame vectors differ and
whether the door score exceeds the laptop score, without enforcing or hiding
the measured ranking. Semantically related door text is expected to rank
higher for this question, but no ranking is guaranteed.

No live embedding request was made during implementation. A real request is
still required before final integration to verify account access, numerical
output and semantic behavior. Task 9 added no database tables, indexes, permanent vector storage, or search
endpoint. Storage is implemented separately in Task 10 below.

## Task 10: MySQL Community 8.4 LTS and private frame storage

The corrected database layer uses SQLAlchemy/PyMySQL, native MySQL JSON for
objects and 1536-dimensional embeddings, UTC DATETIME(6), transactional private
JPEG storage, session-scoped pagination, deletion and a synthetic smoke test.

See [database/README.md](database/README.md) for native Windows setup (primary),
optional MySQL-only Docker setup, schema, repository interfaces, recovery
behavior, and offline/real-server test commands. PostgreSQL/pgvector is no
longer the active storage backend. Existing Tasks 1-9 and external API fields
remain unchanged. Task 11 semantic search has not begun.

MySQL 8.4 verification is required for final acceptance. The local server
identified during this correction is MySQL 8.0.43; it is not the specified
8.4 LTS target. See database/VERIFICATION.md for actual test outcomes.
