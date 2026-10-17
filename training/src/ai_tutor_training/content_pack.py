"""Content pack builder: generates a versioned SQLite database with FTS5 search."""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import sqlite3
import sys
import uuid
from pathlib import Path
from typing import Any

from ai_tutor_training.provenance import (
    compute_sha256,
    create_stage_manifest,
    save_stage_manifest,
)

SCHEMA_VERSION = 1

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL,
    checksum TEXT NOT NULL
);

CREATE TABLE content_pack_metadata (
    pack_id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    content_hash TEXT NOT NULL
);

CREATE TABLE topics (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL
);

CREATE TABLE passages (
    id TEXT PRIMARY KEY,
    passage_id TEXT GENERATED ALWAYS AS (id) STORED,
    chapter TEXT NOT NULL,
    section TEXT,
    start_page INTEGER NOT NULL,
    end_page INTEGER NOT NULL,
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL
);

CREATE TABLE questions (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id),
    question_type TEXT NOT NULL CHECK(question_type IN ('multiple_choice', 'identification', 'essay')),
    stem TEXT NOT NULL,
    canonical_explanation TEXT,
    source_page INTEGER NOT NULL,
    difficulty TEXT CHECK(difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard')),
    content_version TEXT NOT NULL
);

CREATE TABLE choices (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    choice_key TEXT NOT NULL,
    text TEXT NOT NULL,
    sort_order INTEGER NOT NULL
);

CREATE TABLE question_answers (
    question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
    canonical_choice_id TEXT REFERENCES choices(id),
    canonical_answer TEXT
);

CREATE TABLE question_passages (
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    passage_id TEXT NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    link_type TEXT NOT NULL,
    confidence TEXT NOT NULL,
    reviewer_status TEXT NOT NULL,
    PRIMARY KEY (question_id, passage_id)
);

CREATE VIRTUAL TABLE passages_fts USING fts5(
    passage_id UNINDEXED,
    chapter,
    section,
    text,
    content='passages',
    content_rowid='rowid'
);

-- Learner progress tables (isolated and ready for mobile usage)
CREATE TABLE study_sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    mode TEXT NOT NULL
);

CREATE TABLE answer_attempts (
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

CREATE INDEX idx_questions_topic ON questions(topic_id);
CREATE INDEX idx_choices_question ON choices(question_id);
CREATE INDEX idx_qp_passage ON question_passages(passage_id);
"""


def load_jsonl(file_path: Path | str) -> list[dict[str, Any]]:
    """Read a JSONL file into a list of dicts."""
    p = Path(file_path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {p}")
    records = []
    with p.open("r", encoding="utf-8") as f:
        for line in f:
            line_str = line.strip()
            if line_str:
                records.append(json.loads(line_str))
    return records


def build_content_pack(
    linked_questions_path: Path | str,
    passages_path: Path | str,
    output_db_path: Path | str,
    version: str = "2026.10.1",
    config: dict[str, Any] | None = None,
    manifest_path: Path | str | None = None,
) -> Path:
    """Build the versioned SQLite content pack atomically with FTS5 lexical search.

    Ensures all foreign key constraints and schema rules are verified before committing.
    """
    started_at = datetime.datetime.now(datetime.timezone.utc)
    out_p = Path(output_db_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)

    if manifest_path:
        man_p = Path(manifest_path)
    elif output_db_path:
        cfg_name = Path((config or {}).get("content_pack", {}).get("manifest_path", "artifacts/content_pack_manifest.json")).name
        man_p = out_p.parent / cfg_name
    else:
        man_p = Path((config or {}).get("content_pack", {}).get("manifest_path", "artifacts/content_pack_manifest.json"))

    questions = load_jsonl(linked_questions_path)
    passages = load_jsonl(passages_path)

    # Atomic write pattern: build in a temporary file in same directory
    temp_db_path = out_p.parent / f"{out_p.name}.tmp.{uuid.uuid4().hex}"

    conn = None
    try:
        conn = sqlite3.connect(str(temp_db_path))
        conn.execute("PRAGMA foreign_keys = ON;")
        cursor = conn.cursor()

        # 1. Apply DDL
        cursor.executescript(SCHEMA_SQL)

        # 2. Record migration
        schema_hash = hashlib.sha256(SCHEMA_SQL.encode("utf-8")).hexdigest()
        cursor.execute(
            "INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?, ?, ?);",
            (SCHEMA_VERSION, started_at.isoformat(), schema_hash),
        )

        # 3. Insert Topics (deduplicated from questions)
        distinct_topics = sorted(list({q.get("topic") or "General" for q in questions}))
        topic_map: dict[str, str] = {}
        for idx, t_name in enumerate(distinct_topics, start=1):
            t_id = f"t{idx:03d}"
            topic_map[t_name] = t_id
            cursor.execute(
                "INSERT INTO topics (id, title, sort_order) VALUES (?, ?, ?);",
                (t_id, t_name, idx),
            )

        # 4. Insert Passages
        passage_by_id: dict[str, dict[str, Any]] = {}
        for p in passages:
            p_id = p["passage_id"]
            passage_by_id[p_id] = p
            cursor.execute(
                """
                INSERT INTO passages (id, chapter, section, start_page, end_page, text, content_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    p_id,
                    p["chapter"],
                    p.get("section"),
                    p["start_page"],
                    p["end_page"],
                    p["text"],
                    p["content_hash"],
                ),
            )

        # 5. Populate FTS5 table
        cursor.execute(
            """
            INSERT INTO passages_fts (rowid, passage_id, chapter, section, text)
            SELECT rowid, id, chapter, section, text FROM passages;
            """
        )

        # 6. Insert Questions, Choices, Answers, and Question-Passage Links
        choices_inserted: set[str] = set()

        for q in questions:
            q_id = q["question_id"]
            topic_name = q.get("topic") or "General"
            topic_id = topic_map.get(topic_name, topic_map[distinct_topics[0]])
            q_type = q["question_type"]
            stem = q["stem"]
            explanation = q.get("canonical_explanation")
            source_page = q["source_page"]
            difficulty = q.get("difficulty")
            c_version = q.get("content_version", version)

            cursor.execute(
                """
                INSERT INTO questions (id, topic_id, question_type, stem, canonical_explanation, source_page, difficulty, content_version)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    q_id,
                    topic_id,
                    q_type,
                    stem,
                    explanation,
                    source_page,
                    difficulty,
                    c_version,
                ),
            )

            # Insert choices
            canonical_choice_id: str | None = None
            choices_list = q.get("choices") or []
            canonical_key = q.get("canonical_choice_key")

            for s_idx, c in enumerate(choices_list, start=1):
                c_key = c["key"].strip().upper()
                c_id = f"{q_id}_{c_key}"
                cursor.execute(
                    """
                    INSERT INTO choices (id, question_id, choice_key, text, sort_order)
                    VALUES (?, ?, ?, ?, ?);
                    """,
                    (c_id, q_id, c_key, c["text"], s_idx),
                )
                choices_inserted.add(c_id)
                if canonical_key and c_key == canonical_key.upper():
                    canonical_choice_id = c_id

            # Insert question answer (supports both MC choices and free-form / identification answers)
            canonical_ans_text = q.get("canonical_answer")
            if canonical_choice_id or canonical_ans_text:
                cursor.execute(
                    """
                    INSERT INTO question_answers (question_id, canonical_choice_id, canonical_answer)
                    VALUES (?, ?, ?);
                    """,
                    (q_id, canonical_choice_id, canonical_ans_text),
                )

            # Link question to relevant passage(s)
            # Find candidate passages spanning source_page
            linked_passages = [
                p
                for p in passages
                if p["start_page"] <= source_page <= p["end_page"]
                and (p["chapter"] == topic_name or p["chapter"] == "General")
            ]
            if not linked_passages:
                # Fallback: any passage covering source_page
                linked_passages = [
                    p for p in passages if p["start_page"] <= source_page <= p["end_page"]
                ]

            for p_match in linked_passages[:2]:
                cursor.execute(
                    """
                    INSERT OR IGNORE INTO question_passages (question_id, passage_id, link_type, confidence, reviewer_status)
                    VALUES (?, ?, ?, ?, ?);
                    """,
                    (
                        q_id,
                        p_match["passage_id"],
                        "source_page_match",
                        q.get("link_confidence", "high"),
                        "auto_linked",
                    ),
                )

        # 7. Integrity & Foreign Key Verification
        fk_check = cursor.execute("PRAGMA foreign_key_check;").fetchall()
        if fk_check:
            raise RuntimeError(f"Foreign key constraint violation: {fk_check}")

        integrity = cursor.execute("PRAGMA integrity_check;").fetchone()
        if not integrity or integrity[0] != "ok":
            raise RuntimeError(f"Database integrity check failed: {integrity}")

        # 8. Record Content Pack Metadata
        content_hasher = hashlib.sha256()
        for q in questions:
            content_hasher.update(q.get("question_id", "").encode("utf-8"))
            content_hasher.update(q.get("stem", "").encode("utf-8"))
            content_hasher.update(str(q.get("canonical_answer", "")).encode("utf-8"))
        for p in passages:
            content_hasher.update(p.get("passage_id", "").encode("utf-8"))
            content_hasher.update(p.get("content_hash", "").encode("utf-8"))
        content_hash = content_hasher.hexdigest()

        pack_id = f"cp_{version}_{uuid.uuid4().hex[:8]}"
        cursor.execute(
            """
            INSERT INTO content_pack_metadata (pack_id, version, source_revision, imported_at, content_hash)
            VALUES (?, ?, ?, ?, ?);
            """,
            (pack_id, version, "v1", started_at.isoformat(), content_hash),
        )

        conn.commit()
        conn.close()
        conn = None

        # Atomically publish to output path
        if out_p.exists():
            out_p.unlink()
        temp_db_path.rename(out_p)

    except Exception:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        if temp_db_path.exists():
            try:
                temp_db_path.unlink()
            except Exception:
                pass
        raise

    ended_at = datetime.datetime.now(datetime.timezone.utc)

    # Save stage manifest
    manifest = create_stage_manifest(
        stage="build_content_pack",
        started_at=started_at,
        ended_at=ended_at,
        status="success",
        input_files={
            "linked_questions": linked_questions_path,
            "passages": passages_path,
        },
        output_files={"content_pack_db": out_p},
        config=config,
        record_count=len(questions),
    )
    save_stage_manifest(manifest, man_p)

    return out_p


def main() -> int:
    parser = argparse.ArgumentParser(description="Build SQLite content pack with FTS5 search.")
    parser.add_argument("--questions", required=True, help="Path to linked_questions.jsonl")
    parser.add_argument("--passages", required=True, help="Path to passages.jsonl")
    parser.add_argument("--output", help="Path to output content_pack.db")
    parser.add_argument("--manifest", help="Path to output manifest JSON")
    parser.add_argument("--version", default="2026.10.1", help="Content pack version")
    parser.add_argument("--config", help="Path to pipeline YAML config")
    args = parser.parse_args()

    cfg: dict[str, Any] = {}
    if args.config:
        import yaml

        with open(args.config, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}

    out_file = args.output or "artifacts/content_pack.db"
    pack_path = build_content_pack(
        linked_questions_path=args.questions,
        passages_path=args.passages,
        output_db_path=out_file,
        version=args.version,
        config=cfg,
        manifest_path=args.manifest,
    )
    print(f"Built content pack successfully: {pack_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
