"""Unit and integration tests for English reviewer parsing, 5-choice items, and inline explanations."""

import os
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

import sys
from pathlib import Path
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
TRAINING_DIR = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(TRAINING_DIR) not in sys.path:
    sys.path.insert(0, str(TRAINING_DIR))

from ai_tutor_training.stages.link_qa_pairs import (
    link_qa_pairs,
    parse_questions_from_pages,
)
try:
    from training.scripts.prepare_reviewer_sft import build_reviewer_chatml_dataset
except ImportError:
    from scripts.prepare_reviewer_sft import build_reviewer_chatml_dataset


@pytest.fixture
def sample_inline_explanation_pages():
    return [
        {
            "page_number": 1,
            "chapter": "Context Clues - Synonyms",
            "section": "Context Clues - Synonyms",
            "text": """
3. Context Clues
Introductory text defining context clues.

Context Clues - Synonyms
Directions: Choose the letter corresponding to the word.

1. The Vice-President's act was absolutely treacherous for the Filipinos.
a. betrayal
b. hazardous
c. harmless
d. commendable
e. secured
Explanation: Choice (a) "betrayal" is correct because "treacherous" means guilty of deception. Choice (b) is incorrect.

2. Relevant issues on death penalty were discussed.
a. Pertinent
b. Unique
c. Unrelated
d. Inapplicable
e. Abhor
Explanation: Choice (a) "Pertinent" is correct because both denote direct relevance. Choice (b) is incorrect.
            """.strip()
        }
    ]


def test_parse_questions_from_pages_with_inline_explanations(sample_inline_explanation_pages):
    q_patterns = [r"^\s*(\d{1,4})[.)]\s+(.*)"]
    c_patterns = [r"^\s*([A-Ea-e])[.)]\s+(.*)"]
    header_patterns = [r"(?i)(?:explanation\s*:|answer\s+key)"]

    raw_q = parse_questions_from_pages(
        pages=sample_inline_explanation_pages,
        q_patterns=q_patterns,
        c_patterns=c_patterns,
        header_patterns=header_patterns,
    )

    # '3. Context Clues' heading must NOT be parsed as question 3
    assert len(raw_q) == 2
    assert raw_q[0]["raw_num"] == 1
    assert raw_q[1]["raw_num"] == 2

    # Check choices (A through E = 5 choices)
    assert len(raw_q[0]["choices"]) == 5
    assert [c["key"] for c in raw_q[0]["choices"]] == ["A", "B", "C", "D", "E"]
    assert raw_q[0]["choices"][0]["text"] == "betrayal"
    assert raw_q[0]["choices"][4]["text"] == "secured"

    # Check inline explanation
    assert raw_q[0]["inline_canonical_choice_key"] == "A"
    assert len(raw_q[0]["explanation_lines"]) >= 1
    assert "betrayal" in raw_q[0]["explanation_lines"][0]


def test_link_qa_pairs_verifies_5_choice_inline_explanations(tmp_path, sample_inline_explanation_pages):
    cfg = {
        "link_qa_pairs": {
            "output_path": str(tmp_path / "linked.jsonl"),
            "manifest_path": str(tmp_path / "manifest.json"),
            "content_version": "2026.10.1",
            "question_patterns": [r"^\s*(\d{1,4})[.)]\s+(.*)"],
            "choice_patterns": [r"^\s*([A-Ea-e])[.)]\s+(.*)"],
            "answer_key_header_patterns": [r"(?i)(?:explanation\s*:|answer\s+key)"],
        }
    }

    linked = link_qa_pairs(
        extracted_pages=sample_inline_explanation_pages,
        config=cfg,
        output_path=tmp_path / "linked.jsonl",
        manifest_path=tmp_path / "manifest.json",
    )

    assert len(linked) == 2
    for q in linked:
        assert q["link_confidence"] == "verified"
        assert len(q["choices"]) == 5
        assert q["canonical_choice_key"] == "A"
        assert q["canonical_answer"] in ("betrayal", "Pertinent")
        assert q["canonical_explanation"] is not None
        assert len(q["link_warnings"]) == 0


def test_reviewer_chatml_generation(tmp_path, sample_inline_explanation_pages):
    linked_file = tmp_path / "linked.jsonl"
    passages_file = tmp_path / "passages.jsonl"
    sft_file = tmp_path / "sft.jsonl"

    cfg = {
        "link_qa_pairs": {
            "output_path": str(linked_file),
            "manifest_path": str(tmp_path / "link_manifest.json"),
            "choice_patterns": [r"^\s*([A-Ea-e])[.)]\s+(.*)"],
        }
    }
    link_qa_pairs(sample_inline_explanation_pages, config=cfg, output_path=linked_file)

    # Create dummy passage
    import json
    with open(passages_file, "w", encoding="utf-8") as f:
        f.write(json.dumps({
            "passage_id": "p0001",
            "chapter": "Context Clues - Synonyms",
            "section": "Context Clues - Synonyms",
            "start_page": 1,
            "end_page": 1,
            "text": "Context clues provide hints to determine the meaning of unusual words.",
            "content_hash": "dummyhash",
            "word_count": 10,
        }) + "\n")

    records = build_reviewer_chatml_dataset(linked_file, passages_file, sft_file)
    assert len(records) == 2
    for r in records:
        assert r["task_type"] == "explain_more"
        assert len(r["messages"]) == 3
        assert r["messages"][0]["role"] == "system"
        assert r["messages"][1]["role"] == "user"
        assert r["messages"][2]["role"] == "assistant"
        assert "(Source: Context Clues - Synonyms, [Page 1])" in r["messages"][2]["content"]


def test_live_reviewer_artifacts_schema_conformance(contracts_dir):
    """Validate that authentic reviewer artifacts conform strictly to official JSON schemas."""
    import json
    from ai_tutor_training.contracts import validate_jsonl_against_schema

    artifacts_dir = Path("training/artifacts")
    q_file = artifacts_dir / "linked_questions.jsonl"
    p_file = artifacts_dir / "passages.jsonl"

    if not q_file.exists() or not p_file.exists():
        pytest.skip("Live reviewer artifacts not generated yet.")

    # Dynamically extract actual record counts from training artifacts
    actual_q_count = sum(1 for line in q_file.open(encoding="utf-8") if line.strip())
    actual_p_count = sum(1 for line in p_file.open(encoding="utf-8") if line.strip())

    q_report = validate_jsonl_against_schema(q_file, contracts_dir / "linked-question.schema.json")
    assert q_report.is_valid, f"Questions schema failed: {q_report.errors}"
    assert q_report.valid_count == actual_q_count
    assert q_report.valid_count >= 15, f"Expected at least 15 verified questions, got {q_report.valid_count}"
    assert q_report.invalid_count == 0

    p_report = validate_jsonl_against_schema(p_file, contracts_dir / "passage.schema.json")
    assert p_report.is_valid, f"Passages schema failed: {p_report.errors}"
    assert p_report.valid_count == actual_p_count
    assert p_report.valid_count >= 8, f"Expected at least 8 passages, got {p_report.valid_count}"
    assert p_report.invalid_count == 0


def test_live_content_pack_database_integrity():
    """Verify that the compiled SQLite content_pack.db matches actual artifact counts and FTS5 search."""
    import sqlite3

    db_path = Path("training/artifacts/content_pack.db")
    if not db_path.exists():
        pytest.skip("Live content_pack.db not compiled yet.")

    artifacts_dir = Path("training/artifacts")
    q_file = artifacts_dir / "linked_questions.jsonl"
    p_file = artifacts_dir / "passages.jsonl"

    expected_q_count = (
        sum(1 for line in q_file.open(encoding="utf-8") if line.strip())
        if q_file.exists()
        else None
    )
    expected_p_count = (
        sum(1 for line in p_file.open(encoding="utf-8") if line.strip())
        if p_file.exists()
        else None
    )

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Verify questions count matches linked_questions.jsonl and satisfies production minimum
    cursor.execute("SELECT COUNT(*) FROM questions")
    q_count = cursor.fetchone()[0]
    if expected_q_count is not None:
        assert q_count == expected_q_count
    assert q_count >= 15, f"Expected at least 15 questions in DB, got {q_count}"

    # Verify topics count
    cursor.execute("SELECT COUNT(*) FROM topics")
    t_count = cursor.fetchone()[0]
    assert t_count >= 4, f"Expected at least 4 topics in DB, got {t_count}"

    # Verify passages count matches passages.jsonl and satisfies production minimum
    cursor.execute("SELECT COUNT(*) FROM passages")
    p_count = cursor.fetchone()[0]
    if expected_p_count is not None:
        assert p_count == expected_p_count
    assert p_count >= 8, f"Expected at least 8 passages in DB, got {p_count}"

    # Verify FTS5 BM25 search (supports authentic reviewer content and fallback search)
    cursor.execute(
        "SELECT passage_id, text, bm25(passages_fts) as rank "
        "FROM passages_fts WHERE passages_fts MATCH 'context clues' "
        "ORDER BY rank LIMIT 3"
    )
    fts_results = cursor.fetchall()
    if not fts_results:
        cursor.execute(
            "SELECT passage_id, text, bm25(passages_fts) as rank "
            "FROM passages_fts WHERE passages_fts MATCH 'Constitution' "
            "ORDER BY rank LIMIT 3"
        )
        fts_results = cursor.fetchall()
    assert len(fts_results) > 0, "FTS5 BM25 search returned no results"
    conn.close()


def test_live_reviewer_sft_chatml_structure():
    """Verify ChatML Grounded RAG fine-tuning examples match question counts and format."""
    import json

    sft_file = Path("training/artifacts/reviewer_sft_chatml.jsonl")
    if not sft_file.exists():
        pytest.skip("reviewer_sft_chatml.jsonl not generated yet.")

    q_file = Path("training/artifacts/linked_questions.jsonl")
    expected_records = (
        sum(1 for line in q_file.open(encoding="utf-8") if line.strip())
        if q_file.exists()
        else None
    )

    records = []
    with open(sft_file, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                records.append(json.loads(line))

    if expected_records is not None:
        assert len(records) == expected_records, (
            f"ChatML records count ({len(records)}) does not match linked questions ({expected_records})"
        )
    assert len(records) >= 15, f"Expected at least 15 ChatML records, got {len(records)}"

    for r in records:
        assert r["task_type"] == "explain_more"
        assert len(r["messages"]) == 3
        assert r["messages"][0]["role"] == "system"
        assert r["messages"][1]["role"] == "user"
        assert r["messages"][2]["role"] == "assistant"
        assert "<context>" in r["messages"][1]["content"]
        assert "<task>" in r["messages"][1]["content"]

