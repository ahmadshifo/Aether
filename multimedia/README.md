<!-- Member 3's guide: owns the frame analysis pipeline, multimedia storage, semantic search and retrieval APIs. -->
# Member 3 - Multimedia Database and Image Processing

Own `processing/`, `database/` and `api/`. Begin with sample videos, not the live phone stream. Only send selected informative frames to cloud vision/OCR APIs.

Expose the exact endpoints in `shared/contracts/api-v1.yaml`. The Web AI service must never access your tables directly.
