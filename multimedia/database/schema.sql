-- Shared EchoSight MySQL 8 schema for all three members: accounts, sessions, frames, objects, questions and warnings.
-- setup.py runs this file inside the database named in multimedia/database/.env. All times are UTC; text is utf8mb4 for Arabic and French.

-- ---------- Member 2: dashboard accounts ----------

CREATE TABLE IF NOT EXISTS users (
    user_id            CHAR(36)     NOT NULL PRIMARY KEY,
    email              VARCHAR(254) NOT NULL UNIQUE,
    name               VARCHAR(80)  NOT NULL,
    password_hash      VARCHAR(255) NOT NULL,
    preferred_language VARCHAR(5)   NULL,       -- en, fr or ar; used when the phone can't tell
    speech_rate        FLOAT        NULL,       -- 1.0 is normal speed
    created_at         DATETIME(3)  NOT NULL
);

-- One row per login; only a hash of the cookie token is stored.
CREATE TABLE IF NOT EXISTS login_sessions (
    token_hash CHAR(64)    NOT NULL PRIMARY KEY,
    user_id    CHAR(36)    NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    INDEX login_sessions_expires_idx (expires_at),
    CONSTRAINT login_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- ---------- Member 1: one assistant session per Start/Stop on the phone ----------

-- session_id is the UUID the phone already uses; the stream is published at live/<session_id>.
CREATE TABLE IF NOT EXISTS sessions (
    session_id    CHAR(36)              NOT NULL PRIMARY KEY,
    user_id       CHAR(36)              NULL,   -- set once the phone logs in with the same account
    status        ENUM('live', 'ended') NOT NULL DEFAULT 'live',
    started_at    DATETIME(3)           NOT NULL,
    ended_at      DATETIME(3)           NULL,
    consent_given BOOLEAN               NOT NULL DEFAULT FALSE,
    INDEX sessions_user_status_idx (user_id, status, started_at),
    CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE SET NULL
);

-- ---------- Member 3: stored frames and what was found in them ----------

-- The JPEG stays on disk at image_path; a cleanup job deletes the file and the row after expires_at.
CREATE TABLE IF NOT EXISTS frames (
    frame_id        CHAR(36)     NOT NULL PRIMARY KEY,
    session_id      CHAR(36)     NOT NULL,
    captured_at     DATETIME(3)  NOT NULL,
    image_path      VARCHAR(512) NOT NULL,
    caption         TEXT         NOT NULL,
    ocr_text        TEXT         NOT NULL,
    ocr_confidence  FLOAT        NULL,          -- 0 to 1
    ocr_language    VARCHAR(5)   NULL,
    sharpness       FLOAT        NULL,
    brightness      FLOAT        NULL,
    enhanced        BOOLEAN      NOT NULL DEFAULT FALSE,
    embedding       BLOB         NULL,          -- float32 vector bytes; MySQL 8 has no vector type, so similarity runs in Python
    embedding_model VARCHAR(100) NULL,
    expires_at      DATETIME(3)  NOT NULL,
    INDEX frames_session_time_idx (session_id, captured_at DESC),
    INDEX frames_expires_idx (expires_at),
    FULLTEXT INDEX frames_text_ft (caption, ocr_text),
    CONSTRAINT frames_session_fk FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE
);

-- One row per detected object; box values are fractions of the image (0 to 1).
CREATE TABLE IF NOT EXISTS frame_objects (
    object_id  BIGINT AUTO_INCREMENT PRIMARY KEY,
    frame_id   CHAR(36)                         NOT NULL,
    label      VARCHAR(64)                      NOT NULL,
    confidence FLOAT                            NOT NULL,
    position   ENUM('left', 'center', 'right') NULL,
    box_x      FLOAT                            NULL,
    box_y      FLOAT                            NULL,
    box_w      FLOAT                            NULL,
    box_h      FLOAT                            NULL,
    INDEX frame_objects_frame_idx (frame_id),
    INDEX frame_objects_label_idx (label, confidence),
    CONSTRAINT frame_objects_frame_fk FOREIGN KEY (frame_id) REFERENCES frames (frame_id) ON DELETE CASCADE
);

-- ---------- Member 2: questions, answers and the frames they used ----------

CREATE TABLE IF NOT EXISTS questions (
    question_id CHAR(36)                  NOT NULL PRIMARY KEY,
    session_id  CHAR(36)                  NOT NULL,
    user_id     CHAR(36)                  NULL,
    asked_at    DATETIME(3)               NOT NULL,
    question    TEXT                      NOT NULL,
    answer      TEXT                      NOT NULL,
    language    VARCHAR(5)                NOT NULL,
    uncertain   BOOLEAN                   NOT NULL DEFAULT FALSE,  -- the answer said "I'm not sure"
    confidence  FLOAT                     NULL,                    -- combined OCR, detection and search score, 0 to 1
    refused     BOOLEAN                   NOT NULL DEFAULT FALSE,  -- off-topic question the safeguards declined
    model       VARCHAR(100)              NULL,                    -- e.g. groq/<model> or gemini/<model>
    stt_ms      INT                       NULL,
    search_ms   INT                       NULL,
    ai_ms       INT                       NULL,
    total_ms    INT                       NULL,
    feedback    ENUM('correct', 'wrong')  NULL,                    -- tester's "was this right?"
    feedback_at DATETIME(3)               NULL,
    INDEX questions_session_time_idx (session_id, asked_at DESC),
    INDEX questions_user_time_idx (user_id, asked_at DESC),
    CONSTRAINT questions_session_fk FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE,
    CONSTRAINT questions_user_fk FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE SET NULL
);

-- No foreign key to frames: frames expire and are deleted, but the record of which frames an answer used stays.
CREATE TABLE IF NOT EXISTS question_evidence (
    question_id CHAR(36) NOT NULL,
    frame_id    CHAR(36) NOT NULL,
    `rank`      TINYINT  NOT NULL,              -- 1 is the best match
    relevance   FLOAT    NULL,                  -- the search score, 0 to 1
    PRIMARY KEY (question_id, frame_id),
    CONSTRAINT question_evidence_question_fk FOREIGN KEY (question_id) REFERENCES questions (question_id) ON DELETE CASCADE
);

-- ---------- Bonus: warnings given without being asked ----------

CREATE TABLE IF NOT EXISTS warnings (
    warning_id CHAR(36)    NOT NULL PRIMARY KEY,
    session_id CHAR(36)    NOT NULL,
    frame_id   CHAR(36)    NULL,
    created_at DATETIME(3) NOT NULL,
    kind       VARCHAR(32) NOT NULL,            -- e.g. closed_door, stairs
    message    TEXT        NOT NULL,
    language   VARCHAR(5)  NOT NULL,
    confidence FLOAT       NULL,
    INDEX warnings_session_time_idx (session_id, created_at DESC),
    CONSTRAINT warnings_session_fk FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE
);
