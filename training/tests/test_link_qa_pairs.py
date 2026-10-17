"""Tests for Stage 2: link_qa_pairs."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ai_tutor_training.contracts import validate_jsonl_against_schema
from ai_tutor_training.stages.link_qa_pairs import (
    classify_question_type,
    link_qa_pairs,
    parse_answer_keys,
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
