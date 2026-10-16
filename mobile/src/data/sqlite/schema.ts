export const CURRENT_SCHEMA_VERSION = 1;

export const INITIAL_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL,
    checksum TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_pack_metadata (
    pack_id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    content_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS passages (
    id TEXT PRIMARY KEY,
    chapter TEXT NOT NULL,
    section TEXT,
    start_page INTEGER NOT NULL,
    end_page INTEGER NOT NULL,
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id),
    question_type TEXT NOT NULL CHECK(question_type IN ('multiple_choice', 'identification', 'essay')),
    stem TEXT NOT NULL,
    canonical_explanation TEXT,
    source_page INTEGER NOT NULL,
    difficulty TEXT CHECK(difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard')),
    content_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS choices (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    choice_key TEXT NOT NULL,
    text TEXT NOT NULL,
    sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS question_answers (
    question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
    canonical_choice_id TEXT REFERENCES choices(id),
    canonical_answer TEXT
);

CREATE TABLE IF NOT EXISTS question_passages (
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    passage_id TEXT NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    link_type TEXT NOT NULL,
    confidence TEXT NOT NULL,
    reviewer_status TEXT NOT NULL,
    PRIMARY KEY (question_id, passage_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(
    passage_id UNINDEXED,
    chapter,
    section,
    text,
    content='passages',
    content_rowid='rowid'
);

-- User Progress Tables (Preserved across content-pack imports)
CREATE TABLE IF NOT EXISTS study_sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    mode TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS answer_attempts (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES study_sessions(id),
    question_id TEXT NOT NULL REFERENCES questions(id),
    selected_choice_id TEXT REFERENCES choices(id),
    free_text_answer TEXT,
    is_correct INTEGER NOT NULL,
    score REAL NOT NULL DEFAULT 0.0,
    duration_ms INTEGER NOT NULL,
    answered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_installations (
    id TEXT PRIMARY KEY,
    manifest_id TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL,
    installed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_run_summaries (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES questions(id),
    model_id TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    retrieved_passage_ids_json TEXT NOT NULL,
    output_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic_id);
CREATE INDEX IF NOT EXISTS idx_choices_question ON choices(question_id);
CREATE INDEX IF NOT EXISTS idx_qp_passage ON question_passages(passage_id);
CREATE INDEX IF NOT EXISTS idx_attempts_question ON answer_attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_attempts_session ON answer_attempts(session_id);
`;

