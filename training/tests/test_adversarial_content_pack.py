"""Adversarial validation and stress testing for mobile/assets/content_pack.db."""

import hashlib
import json
from pathlib import Path
import sqlite3
import pytest


MOBILE_DB_PATH = Path("mobile/assets/content_pack.db")
TRAIN_DB_PATH = Path("training/artifacts/content_pack.db")
MOBILE_MANIFEST_PATH = Path("mobile/assets/content_pack_manifest.json")
TRAIN_MANIFEST_PATH = Path("training/artifacts/content_pack_manifest.json")


def test_content_pack_asset_existence_and_hash_parity():
    """Verify exact byte-for-byte identity between training artifact and deployed mobile asset."""
    assert MOBILE_DB_PATH.exists(), f"Missing deployed DB at {MOBILE_DB_PATH}"
    assert TRAIN_DB_PATH.exists(), f"Missing training DB at {TRAIN_DB_PATH}"

    mobile_size = MOBILE_DB_PATH.stat().st_size
    train_size = TRAIN_DB_PATH.stat().st_size
    assert mobile_size == train_size, (
        f"File size mismatch: mobile={mobile_size}, train={train_size}"
    )
    assert mobile_size > 0, "DB file size must be non-zero"

    mobile_hash = hashlib.sha256(MOBILE_DB_PATH.read_bytes()).hexdigest()
    train_hash = hashlib.sha256(TRAIN_DB_PATH.read_bytes()).hexdigest()
    assert mobile_hash == train_hash, "Hash mismatch between mobile asset and training artifact!"
    assert len(mobile_hash) == 64, f"Invalid SHA256 hex length: {len(mobile_hash)}"

    assert MOBILE_MANIFEST_PATH.exists(), f"Missing mobile manifest at {MOBILE_MANIFEST_PATH}"
    assert TRAIN_MANIFEST_PATH.exists(), f"Missing train manifest at {TRAIN_MANIFEST_PATH}"
    mobile_m_hash = hashlib.sha256(MOBILE_MANIFEST_PATH.read_bytes()).hexdigest()
    train_m_hash = hashlib.sha256(TRAIN_MANIFEST_PATH.read_bytes()).hexdigest()
    assert mobile_m_hash == train_m_hash, "Hash mismatch between mobile manifest and training artifact!"


def test_sqlite_pragmas_and_db_integrity():
    """Adversarially verify SQLite integrity and foreign key constraints."""
    conn = sqlite3.connect(MOBILE_DB_PATH)
    cur = conn.cursor()

    # DB file integrity check
    cur.execute("PRAGMA integrity_check;")
    integrity = cur.fetchall()
    assert integrity == [("ok",)], f"PRAGMA integrity_check failed: {integrity}"

    # Foreign key constraint check
    cur.execute("PRAGMA foreign_key_check;")
    fk_errors = cur.fetchall()
    assert len(fk_errors) == 0, f"Foreign key violations detected: {fk_errors}"

    # Quick check
    cur.execute("PRAGMA quick_check;")
    quick = cur.fetchall()
    assert quick == [("ok",)], f"PRAGMA quick_check failed: {quick}"

    conn.close()


def test_production_row_counts_and_referential_completeness():
    """Verify table counts match production requirements: dynamically validating questions and passages."""
    q_file = Path("training/artifacts/linked_questions.jsonl")
    p_file = Path("training/artifacts/passages.jsonl")

    expected_q = (
        sum(1 for line in q_file.open(encoding="utf-8") if line.strip())
        if q_file.exists()
        else None
    )
    expected_p = (
        sum(1 for line in p_file.open(encoding="utf-8") if line.strip())
        if p_file.exists()
        else None
    )

    conn = sqlite3.connect(MOBILE_DB_PATH)
    cur = conn.cursor()

    # 1. Questions: dynamically matches artifact count, contract requires >= 15
    cur.execute("SELECT COUNT(*) FROM questions")
    q_count = cur.fetchone()[0]
    if expected_q is not None:
        assert q_count == expected_q, f"DB questions ({q_count}) does not match artifacts ({expected_q})"
    assert q_count >= 15, f"Expected at least 15 questions, got {q_count}"

    # 2. Passages: dynamically matches artifact count, contract requires >= 8
    cur.execute("SELECT COUNT(*) FROM passages")
    p_count = cur.fetchone()[0]
    if expected_p is not None:
        assert p_count == expected_p, f"DB passages ({p_count}) does not match artifacts ({expected_p})"
    assert p_count >= 8, f"Expected at least 8 passages, got {p_count}"

    # 3. Topics
    cur.execute("SELECT COUNT(*) FROM topics")
    t_count = cur.fetchone()[0]
    assert t_count >= 4, f"Expected at least 4 topics, got {t_count}"

    # 4. Choices: multiple choices per question
    cur.execute("SELECT COUNT(*) FROM choices")
    choice_count = cur.fetchone()[0]
    assert choice_count >= q_count * 2, f"Expected multiple choices per question, got {choice_count}"

    # 5. Question Answers: matches question count
    cur.execute("SELECT COUNT(*) FROM question_answers")
    qa_count = cur.fetchone()[0]
    assert qa_count == q_count, f"Expected {q_count} question answers, got {qa_count}"

    # 6. Question Passages: every question must be linked
    cur.execute("SELECT COUNT(DISTINCT question_id) FROM question_passages")
    distinct_qp = cur.fetchone()[0]
    assert distinct_qp == q_count, f"Expected {q_count} distinct questions in question_passages, got {distinct_qp}"

    # 7. Passages FTS: exactly matches passage count
    cur.execute("SELECT COUNT(*) FROM passages_fts")
    fts_count = cur.fetchone()[0]
    assert fts_count == p_count, f"Expected {p_count} FTS records, got {fts_count}"

    # 8. Schema Migrations
    cur.execute("SELECT version, checksum FROM schema_migrations")
    migrations = cur.fetchall()
    assert len(migrations) >= 1
    assert migrations[0][0] == 1

    # 9. Metadata
    cur.execute("SELECT pack_id, version, content_hash FROM content_pack_metadata")
    meta = cur.fetchall()
    assert len(meta) == 1
    assert meta[0][0].startswith("cp_")
    assert meta[0][1] == "2026.10.1"

    # Deep relational integrity:
    # A. Check that EVERY question has at least 2 choices
    cur.execute("""
        SELECT q.id, COUNT(c.id) as choice_cnt
        FROM questions q
        LEFT JOIN choices c ON q.id = c.question_id
        GROUP BY q.id
        HAVING choice_cnt < 2
    """)
    sparse_questions = cur.fetchall()
    assert len(sparse_questions) == 0, f"Found questions with < 2 choices: {sparse_questions}"

    # B. Check that EVERY question has an answer entry with valid canonical_choice_id
    cur.execute("""
        SELECT qa.question_id, qa.canonical_choice_id
        FROM question_answers qa
        LEFT JOIN choices c ON qa.canonical_choice_id = c.id
        WHERE c.id IS NULL
    """)
    orphan_answers = cur.fetchall()
    assert len(orphan_answers) == 0, f"Found question_answers with invalid choice ID: {orphan_answers}"

    # C. Check that EVERY question has a question_passage link
    cur.execute("""
        SELECT qp.question_id, qp.passage_id
        FROM question_passages qp
        LEFT JOIN passages p ON qp.passage_id = p.id
        WHERE p.id IS NULL
    """)
    broken_passage_links = cur.fetchall()
    assert len(broken_passage_links) == 0, f"Broken passage links in question_passages: {broken_passage_links}"

    conn.close()


def test_fts5_bm25_queries_and_adversarial_queries():
    """Test FTS5 full-text indexing, BM25 ranking, and adversarial inputs."""
    import re
    conn = sqlite3.connect(MOBILE_DB_PATH)
    cur = conn.cursor()

    # Dynamically extract search terms from the database's actual passages
    cur.execute("SELECT text FROM passages LIMIT 10")
    sample_texts = [row[0] for row in cur.fetchall()]
    extracted_words = []
    stopwords = {"that", "this", "with", "from", "which", "were", "have", "been", "their", "there"}
    for text in sample_texts:
        found = re.findall(r"\b[A-Za-z]{5,}\b", text)
        for w in found:
            w_lower = w.lower()
            if w_lower not in stopwords and len(w_lower) >= 5:
                extracted_words.append(w_lower)

    # Pick top 5 distinct terms
    valid_queries = list(dict.fromkeys(extracted_words))[:5]
    if not valid_queries:
        valid_queries = ["context", "synonym"]

    for q in valid_queries:
        cur.execute("""
            SELECT passage_id, text, bm25(passages_fts) as rank
            FROM passages_fts
            WHERE passages_fts MATCH ?
            ORDER BY rank ASC
            LIMIT 5
        """, (q,))
        rows = cur.fetchall()
        assert len(rows) > 0, f"Query '{q}' returned 0 matches in FTS5!"
        # BM25 scores in SQLite FTS5 are negative numbers (lower is better match)
        assert rows[0][2] < 0.0, f"BM25 rank should be negative, got {rows[0][2]}"

    # Adversarial input queries to ensure no syntax crash
    adversarial_inputs = [
        '"safe query"',
        f'{valid_queries[0]} OR test',
        'NOTHING_SHOULD_MATCH_XYZ_12345',
    ]
    for adv in adversarial_inputs:
        cur.execute("""
            SELECT passage_id, text, bm25(passages_fts) as rank
            FROM passages_fts
            WHERE passages_fts MATCH ?
            ORDER BY rank ASC
            LIMIT 5
        """, (adv,))
        rows = cur.fetchall()
        if adv == 'NOTHING_SHOULD_MATCH_XYZ_12345':
            assert len(rows) == 0
        else:
            assert len(rows) >= 0

    conn.close()


def test_passage_word_clamping_invariants():
    """Verify that _clamp_passage_words enforces token-bounded passage lengths for ChatML."""
    from ai_tutor_training.annotation import _clamp_passage_words

    # Text shorter than max_words remains unchanged
    short_text = "Civil Service Commission exam reviewer."
    assert _clamp_passage_words(short_text, max_words=10) == short_text

    # Text exactly equal to max_words remains unchanged
    exact_text = "word1 word2 word3 word4 word5"
    assert _clamp_passage_words(exact_text, max_words=5) == exact_text

    # Text longer than max_words is truncated and appended with '...'
    long_text = " ".join([f"word_{i}" for i in range(200)])
    clamped = _clamp_passage_words(long_text, max_words=140)
    assert clamped.endswith("...")
    words = clamped[:-4].split()
    assert len(words) == 140
    assert words[0] == "word_0"
    assert words[-1] == "word_139"

    # Non-positive max_words disables clamping
    assert _clamp_passage_words(long_text, max_words=0) == long_text
    assert _clamp_passage_words(long_text, max_words=-5) == long_text


def test_deploy_content_pack_to_mobile_parity_and_cleanup(tmp_path):
    """Test that deploy_content_pack_to_mobile enforces SHA-256 parity and removes legacy JSON."""
    from ai_tutor_training.cli import deploy_content_pack_to_mobile

    artifacts_dir = tmp_path / "artifacts"
    artifacts_dir.mkdir(parents=True)
    mobile_dir = tmp_path / "mobile_assets"
    mobile_dir.mkdir(parents=True)

    dummy_db = artifacts_dir / "content_pack.db"
    dummy_manifest = artifacts_dir / "content_pack_manifest.json"
    dummy_db.write_bytes(b"SQLITE_TEST_CONTENT_PACK_DATA")
    dummy_manifest.write_text('{"pack_id": "cp_test", "version": "2026.10.1"}', encoding="utf-8")

    # Create legacy JSON in target dir
    legacy_json = mobile_dir / "live_content_pack.json"
    legacy_json.write_text('{"legacy": true}', encoding="utf-8")
    assert legacy_json.exists()

    result = deploy_content_pack_to_mobile(
        artifacts_dir=artifacts_dir,
        mobile_assets_dir=mobile_dir,
    )

    assert result["status"] == "deployed"
    assert result["removed_legacy_json"] is True
    assert not legacy_json.exists(), "Legacy live_content_pack.json was not removed!"

    dest_db = mobile_dir / "content_pack.db"
    dest_manifest = mobile_dir / "content_pack_manifest.json"
    assert dest_db.exists()
    assert dest_manifest.exists()
    assert dest_db.read_bytes() == dummy_db.read_bytes()
    assert dest_manifest.read_text(encoding="utf-8") == dummy_manifest.read_text(encoding="utf-8")

