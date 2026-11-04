-- Member 3: PostgreSQL schema for time-indexed frames, OCR text, object labels and semantic embeddings.
-- The embedding dimension below matches the default for text-embedding-3-small; keep model and schema aligned.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS frames (
    frame_id UUID PRIMARY KEY,
    session_id UUID NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    image_path TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    ocr_text TEXT NOT NULL DEFAULT '',
    objects JSONB NOT NULL DEFAULT '[]'::jsonb,
    embedding VECTOR(1536),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS frames_session_time_idx
    ON frames (session_id, captured_at DESC);
