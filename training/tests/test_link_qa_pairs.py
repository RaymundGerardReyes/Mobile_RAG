"""Tests for Stage 2: link_qa_pairs."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ai_tutor_training.contracts import validate_jsonl_against_schema
from ai_tutor_training.stages.link_qa_pairs import (
    classify_question_type,
    extract_inline_explanation_and_key,
    link_qa_pairs,
    parse_answer_keys,
    parse_inline_explanation_block,
    parse_questions_from_pages,
    validate_choice_count_warning,
)

pytestmark = [pytest.mark.unit, pytest.mark.integration]


def test_classify_question_types() -> None:
    # Multiple choice
    assert (
        classify_question_type("What is X?", [{"key": "A", "text": "Choice 1"}])
        == "multiple_choice"
    )
    # Essay with keyword
    assert (
        classify_question_type("Explain the importance of public service accountability.", None)
        == "essay"
    )
    assert (
        classify_question_type("Ipaliwanag ang kahalagahan ng Saligang Batas.", None)
        == "essay"
    )
    # Identification
    assert (
        classify_question_type("Republic Act number of the Code of Conduct.", None)
        == "identification"
    )


def test_parse_answer_keys_bilingual(sample_pages_path: Path) -> None:
    with sample_pages_path.open("r", encoding="utf-8") as f:
        pages = [json.loads(line) for line in f if line.strip()]

    header_patterns = [r"(?i)(?:answer\s+key|susi\s+sa\s+pagwawasto)"]
    item_patterns = [r"(\d{1,4})\s*[-–—:]\s*([A-Da-d])\b"]

    chapter_keys, global_keys = parse_answer_keys(pages, header_patterns, item_patterns)

    # Check that item 1, 2, 3 in chapter 1 are found
    assert any(q_num == 1 and k == "C" for (_, q_num), (k, _) in chapter_keys.items())
    assert any(q_num == 2 and k == "B" for (_, q_num), (k, _) in chapter_keys.items())
    assert any(q_num == 3 and k == "A" for (_, q_num), (k, _) in chapter_keys.items())

    # Check Filipino answer keys from page 5 ("Susi sa Pagwawasto")
    assert any(q_num == 6 and k == "A" for (_, q_num), (k, _) in chapter_keys.items())
    assert any(q_num == 7 and k == "B" for (_, q_num), (k, _) in chapter_keys.items())
    assert any(q_num == 8 and k == "B" for (_, q_num), (k, _) in chapter_keys.items())


def test_link_qa_pairs_from_sample_pages(
    sample_pages_path: Path, tmp_path: Path, pipeline_config: dict, contracts_dir: Path
) -> None:
    output_jsonl = tmp_path / "linked_questions.jsonl"
    manifest_json = tmp_path / "link_manifest.json"

    records = link_qa_pairs(
        extracted_pages=sample_pages_path,
        config=pipeline_config,
        output_path=output_jsonl,
        manifest_path=manifest_json,
    )

    assert len(records) >= 8
    assert output_jsonl.exists()
    assert manifest_json.exists()

    # 1. Question IDs are sequential: q0001, q0002...
    assert records[0]["question_id"] == "q0001"
    assert records[1]["question_id"] == "q0002"

    # 2. MC questions linked to correct choice key
    # Question 1: Congress of the Philippines -> C
    q1 = records[0]
    assert q1["question_type"] == "multiple_choice"
    assert q1["canonical_choice_key"] == "C"
    assert q1["link_confidence"] == "verified"
    assert len(q1["choices"]) == 4

    # 3. Question 2: Senate -> 24 -> B
    q2 = records[1]
    assert q2["canonical_choice_key"] == "B"
    assert q2["link_confidence"] == "verified"

    # 4. Identification question (Item 4)
    q4 = next((r for r in records if "Code of Conduct" in r["stem"] and r["question_type"] == "identification"), None)
    assert q4 is not None
    assert q4["question_type"] == "identification"

    # 5. Essay question (Item 5)
    q5 = next((r for r in records if "accountability" in r["stem"].lower()), None)
    assert q5 is not None
    assert q5["question_type"] == "essay"

    # 6. Bilingual question 6 (Filipino marikit -> A)
    q6 = next((r for r in records if "marikit" in r["stem"]), None)
    assert q6 is not None
    assert q6["canonical_choice_key"] == "A"
    assert q6["canonical_answer"] == "Maganda"
    assert q6["link_confidence"] == "verified"

    # 7. Output strictly validates against schema
    schema_path = contracts_dir / "linked-question.schema.json"
    report = validate_jsonl_against_schema(output_jsonl, schema_path)
    assert report.is_valid, f"Contract errors: {report.errors}"
    assert report.valid_count == len(records)

    # 8. Manifest validation
    with manifest_json.open("r", encoding="utf-8") as f:
        manifest = json.load(f)
    assert manifest["stage"] == "link_qa_pairs"
    assert manifest["status"] == "success"
    assert manifest["record_count"] == len(records)


def test_link_qa_warnings_for_missing_key(tmp_path: Path, pipeline_config: dict) -> None:
    # Page with a question stem but NO answer key
    pages = [
        {
            "source_id": "test_id",
            "page_number": 1,
            "chapter": "Chapter 1",
            "section": None,
            "text": "1. What is an orphan question?\nA. One without answer key\nB. Two\nC. Three",
            "is_empty": False,
            "empty_reason": None,
            "headings_detected": [],
        }
    ]
    out_file = tmp_path / "out.jsonl"
    recs = link_qa_pairs(pages, config=pipeline_config, output_path=out_file)
    assert len(recs) == 1
    assert recs[0]["link_confidence"] == "unresolved"
    assert len(recs[0]["link_warnings"]) > 0
    # Choice count warning (3 choices instead of 4)
    assert any("choices" in w for w in recs[0]["link_warnings"])


def test_validate_choice_count_warning() -> None:
    # 4 and 5 choices are standard Civil Service exam formats — no warning
    assert validate_choice_count_warning(4, "q0001", 1) is None
    assert validate_choice_count_warning(5, "q0002", 2) is None

    # Non-standard counts emit expected warning format
    w3 = validate_choice_count_warning(3, "q0003", 3)
    assert w3 is not None
    assert "has 3 choices (expected 4)" in w3

    w6 = validate_choice_count_warning(6, "q0004", 4)
    assert w6 is not None
    assert "has 6 choices (expected 4)" in w6


def test_extract_inline_explanation_and_key() -> None:
    text1, key1 = extract_inline_explanation_and_key("Explanation: Choice (b) is the correct answer because of accountability.")
    assert key1 == "B"
    assert "accountability" in text1

    text2, key2 = extract_inline_explanation_and_key("Paliwanag: Titik (c) ang tamang sagot ayon sa Artikulo VI.")
    assert key2 == "C"

    text3, key3 = extract_inline_explanation_and_key("Option D is the best answer.")
    assert key3 == "D"

    text4, key4 = extract_inline_explanation_and_key("Tamang sagot: E")
    assert key4 == "E"

    text5, key5 = extract_inline_explanation_and_key("Explanation: Under Section 4 of Republic Act 6713.")
    assert key5 is None


def test_parse_inline_explanation_block_and_multiline_pages() -> None:
    # Test block parser
    res = parse_inline_explanation_block("Explanation: Choice (a) shows the primary duty of civil servants.")
    assert res is not None
    assert res["canonical_choice_key"] == "A"
    assert "primary duty" in res["body"]

    # Non-explanation line returns None
    assert parse_inline_explanation_block("1. What is the supreme law?") is None

    # Test multi-line continuation with 5-choice question
    page_text = (
        "1. Which term describes the highest civil service standard?\n"
        "A. Loyalty\n"
        "B. Integrity\n"
        "C. Competence\n"
        "D. Professionalism\n"
        "E. Responsiveness\n"
        "Explanation:\n"
        "Choice (b) is correct.\n"
        "Integrity is the cornerstone of public office under RA 6713.\n"
    )
    pages = [{"page_number": 1, "chapter": "Ethics", "text": page_text}]
    raw_qs = parse_questions_from_pages(
        pages=pages,
        q_patterns=[r"^\s*(\d{1,4})[.)]\s+(.*)"],
        c_patterns=[r"^\s*([A-Ea-e])[.)]\s+(.*)"],
        header_patterns=[r"(?i)answer\s+key"],
    )
    assert len(raw_qs) == 1
    assert len(raw_qs[0]["choices"]) == 5
    assert raw_qs[0]["inline_canonical_choice_key"] == "B"
    assert len(raw_qs[0]["explanation_lines"]) == 2
    assert "Integrity" in " ".join(raw_qs[0]["explanation_lines"])

