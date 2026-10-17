"""Tests for Content Pack SQLite generation and FTS5 search."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from ai_tutor_training.content_pack import build_content_pack

pytestmark = pytest.mark.integration


def test_build_content_pack(
    sample_linked_questions_path: Path,
    sample_passages_path: Path,
    tmp_path: Path,
    pipeline_config: dict,
) -> None:
    output_db = tmp_path / "content_pack.db"
    manifest_json = tmp_path / "content_pack_manifest.json"

    result_path = build_content_pack(
        linked_questions_path=sample_linked_questions_path,
        passages_path=sample_passages_path,
        output_db_path=output_db,
        version="2026.10.1",
        config=pipeline_config,
        manifest_path=manifest_json,
    )

    assert result_path.exists()
    assert manifest_json.exists()

    conn = sqlite3.connect(str(output_db))
    conn.execute("PRAGMA foreign_keys = ON;")
    cursor = conn.cursor()

    # 1. Foreign key integrity check
    fk_errors = cursor.execute("PRAGMA foreign_key_check;").fetchall()
    assert len(fk_errors) == 0, f"Foreign key violations found: {fk_errors}"

    # 2. Database integrity check
    integrity = cursor.execute("PRAGMA integrity_check;").fetchone()
    assert integrity[0] == "ok"

    # 3. Check all expected tables exist
    tables = [
        row[0]
        for row in cursor.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'view');"
        ).fetchall()
    ]
    expected_tables = [
        "schema_migrations",
        "content_pack_metadata",
        "topics",
        "passages",
        "questions",
        "choices",
        "question_answers",
        "question_passages",
        "passages_fts",
        "study_sessions",
        "answer_attempts",
    ]
    for tbl in expected_tables:
        assert tbl in tables, f"Expected table '{tbl}' not found in SQLite DB"

    # 4. Check topics populated
    topics = cursor.execute("SELECT id, title FROM topics;").fetchall()
    assert len(topics) >= 3

    # 5. Check questions and choices count
    q_count = cursor.execute("SELECT COUNT(*) FROM questions;").fetchone()[0]
    assert q_count == 15

    c_count = cursor.execute("SELECT COUNT(*) FROM choices;").fetchone()[0]
    assert c_count > 30

    # 6. Verify deterministic answer keys
    # q0001 canonical choice should be Congress of the Philippines
    cursor.execute(
        """
        SELECT c.text, c.choice_key, qa.canonical_answer
        FROM question_answers qa
        JOIN choices c ON c.id = qa.canonical_choice_id
        WHERE qa.question_id = 'q0001';
        """
    )
    ans_row = cursor.fetchone()
    assert ans_row is not None
    assert ans_row[1] == "C"
    assert "Congress" in ans_row[0]
    assert ans_row[2] == "Congress of the Philippines"

    # Verify identification question (q0004) has answer stored without choices
    q4_ans = cursor.execute(
        """
        SELECT canonical_choice_id, canonical_answer
        FROM question_answers
        WHERE question_id = 'q0004';
        """
    ).fetchone()
    assert q4_ans is not None
    assert q4_ans[0] is None
    assert q4_ans[1] == "Republic Act 6713"

    # 7. Check FTS5 Lexical Search functionality
    fts_results = cursor.execute(
        """
        SELECT p.id, p.text, bm25(passages_fts) as rank
        FROM passages_fts fts
        JOIN passages p ON p.rowid = fts.rowid
        WHERE passages_fts MATCH 'Constitution'
        ORDER BY rank ASC;
        """
    ).fetchall()
    assert len(fts_results) > 0
    assert "Constitution" in fts_results[0][1]

    # Also verify join using passage_id UNINDEXED column
    fts_by_id = cursor.execute(
        """
        SELECT p.id, p.text
        FROM passages_fts fts
        JOIN passages p ON p.id = fts.passage_id
        WHERE passages_fts MATCH 'Constitution'
        LIMIT 1;
        """
    ).fetchone()
    assert fts_by_id is not None
    assert "Constitution" in fts_by_id[1]

    # 8. Check Filipino search in FTS5
    fts_fil = cursor.execute(
        """
        SELECT p.id, p.text
        FROM passages_fts fts
        JOIN passages p ON p.rowid = fts.rowid
        WHERE passages_fts MATCH 'marikit'
        LIMIT 1;
        """
    ).fetchone()
    assert fts_fil is not None
    assert "marikit" in fts_fil[1]

    # 9. Verify metadata
    meta = cursor.execute(
        "SELECT version, content_hash FROM content_pack_metadata;"
    ).fetchone()
    assert meta is not None
    assert meta[0] == "2026.10.1"
    assert len(meta[1]) == 64  # SHA-256 hash of DB

    conn.close()


def test_build_content_pack_atomic_on_failure(tmp_path: Path, pipeline_config: dict) -> None:
    # Test atomic rollback: bad linked question that references non-existent choice in question_answers
    bad_questions_file = tmp_path / "bad_questions.jsonl"
    passages_file = tmp_path / "passages.jsonl"
    passages_file.write_text(
        json.dumps(
            {
                "passage_id": "p0001",
                "chapter": "General",
                "start_page": 1,
                "end_page": 1,
                "text": "Some text",
                "content_hash": "a" * 64,
                "word_count": 2,
            }
        )
        + "\n",
        encoding="utf-8",
    )

    # Invalid question: question_type is invalid for CHECK constraint
    bad_questions_file.write_text(
        json.dumps(
            {
                "question_id": "q0001",
                "topic": "General",
                "question_type": "invalid_type",  # Violates CHECK(question_type IN (...))
                "stem": "Bad question",
                "source_page": 1,
                "choices": [],
                "canonical_answer": "X",
                "canonical_choice_key": "A",
                "link_confidence": "verified",
            }
        )
        + "\n",
        encoding="utf-8",
    )

    out_db = tmp_path / "should_not_exist.db"

    with pytest.raises(Exception):
        build_content_pack(
            linked_questions_path=bad_questions_file,
            passages_path=passages_file,
            output_db_path=out_db,
            config=pipeline_config,
        )

    # Output file should NOT exist because atomic write caught the error and cleaned up
    assert not out_db.exists()
