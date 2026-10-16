"""Tests for Stage 3: build_passages."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from ai_tutor_training.contracts import validate_jsonl_against_schema
from ai_tutor_training.stages.build_passages import (
    build_passages,
    count_words,
    split_into_sentences,
)


def test_split_into_sentences() -> None:
    text = (
        "This is sentence one. This is sentence two! Is this sentence three? "
        "Yes, indeed it is.\n\nNew paragraph sentence here."
    )
    sents = split_into_sentences(text)
    assert len(sents) >= 4
    assert sents[0] == "This is sentence one."
    assert sents[1] == "This is sentence two!"
    assert sents[2] == "Is this sentence three?"

    # Verify abbreviations (No., R.A., Art., Sec., Dr., Mr., i.e., p., pp., vs.) are not falsely split
    abbrev_text = (
        "Republic Act No. 6713, also cited as R.A. 6713, governs public ethics. "
        "See Art. 12 and Sec. 4 for guidelines from Dr. Rizal and Mr. Santos (i.e. official text). "
        "Refer to p. 10 or pp. 20-25 for cases vs. violators."
    )
    abbrev_sents = split_into_sentences(abbrev_text)
    assert len(abbrev_sents) == 3
    assert abbrev_sents[0] == "Republic Act No. 6713, also cited as R.A. 6713, governs public ethics."
    assert abbrev_sents[1] == "See Art. 12 and Sec. 4 for guidelines from Dr. Rizal and Mr. Santos (i.e. official text)."
    assert abbrev_sents[2] == "Refer to p. 10 or pp. 20-25 for cases vs. violators."

    # Verify quotes and parentheses at sentence boundaries
    quote_text = 'He stated, "Public office is a public trust." This is a key principle.'
    quote_sents = split_into_sentences(quote_text)
    assert len(quote_sents) == 2
    assert quote_sents[0] == 'He stated, "Public office is a public trust."'
    assert quote_sents[1] == "This is a key principle."

    paren_text = "See provisions (enacted in 1987). A new system was then established."
    paren_sents = split_into_sentences(paren_text)
    assert len(paren_sents) == 2
    assert paren_sents[0] == "See provisions (enacted in 1987)."
    assert paren_sents[1] == "A new system was then established."

    # Verify Philippine legal abbreviations and section headings
    ph_law_text = (
        "Under P.D. 807 and B.P. Blg. 881, election standards are enforced by Atty. Cruz. "
        "Sec. 2. The Senate shall be composed of twenty-four Senators."
    )
    ph_sents = split_into_sentences(ph_law_text)
    assert len(ph_sents) == 2
    assert "Under P.D. 807" in ph_sents[0]
    assert ph_sents[1] == "Sec. 2. The Senate shall be composed of twenty-four Senators."

    # Verify empty / whitespace inputs
    assert split_into_sentences("") == []
    assert split_into_sentences("   \n\n  ") == []


def test_build_passages_from_sample_pages(
    sample_pages_path: Path, tmp_path: Path, pipeline_config: dict, contracts_dir: Path
) -> None:
    output_jsonl = tmp_path / "passages.jsonl"
    manifest_json = tmp_path / "passages_manifest.json"

    passages = build_passages(
        extracted_pages=sample_pages_path,
        config=pipeline_config,
        output_path=output_jsonl,
        manifest_path=manifest_json,
    )

    assert len(passages) >= 5
    assert output_jsonl.exists()
    assert manifest_json.exists()

    # 1. Stable sequential passage IDs
    assert passages[0]["passage_id"] == "p0001"
    assert passages[1]["passage_id"] == "p0002"

    # 2. Check metadata fields
    for p in passages:
        assert p["start_page"] >= 1
        assert p["end_page"] >= p["start_page"]
        assert len(p["text"]) > 0
        assert p["word_count"] > 0
        # Verify SHA-256 content_hash matches actual text
        computed_hash = hashlib.sha256(p["text"].encode("utf-8")).hexdigest()
        assert p["content_hash"] == computed_hash

    # 3. Check max_passage_words bound
    max_words = pipeline_config["build_passages"]["max_passage_words"]
    for p in passages:
        # Each chunk is bounded (allow some tolerance for long single sentences)
        assert p["word_count"] <= max_words + 50

    # 4. Empty page was skipped (page 6 has no passages)
    assert not any(p["start_page"] == 6 and p["end_page"] == 6 for p in passages)

    # 5. Output strictly validates against passage.schema.json
    schema_path = contracts_dir / "passage.schema.json"
    report = validate_jsonl_against_schema(output_jsonl, schema_path)
    assert report.is_valid, f"Contract errors: {report.errors}"
    assert report.valid_count == len(passages)

    # 6. Verify manifest
    with manifest_json.open("r", encoding="utf-8") as f:
        manifest = json.load(f)
    assert manifest["stage"] == "build_passages"
    assert manifest["status"] == "success"
    assert manifest["record_count"] == len(passages)


def test_build_passages_sentence_integrity(tmp_path: Path, pipeline_config: dict) -> None:
    # Verify that sentences are never split in half
    long_sentences = [
        "First sentence has seven specific words.",
        "Second sentence contains another set of words.",
        "Third sentence completes the thought for testing.",
    ]
    pages = [
        {
            "source_id": "test_id",
            "page_number": 1,
            "chapter": "Test Chapter",
            "section": None,
            "text": " ".join(long_sentences),
            "is_empty": False,
            "empty_reason": None,
            "headings_detected": [],
        }
    ]
    cfg = {
        "build_passages": {
            "max_passage_words": 10,  # small max to force chunking
            "overlap_words": 0,
        }
    }
    out_file = tmp_path / "passages_chunked.jsonl"
    passages = build_passages(pages, config=cfg, output_path=out_file)
    assert len(passages) >= 2
    # Ensure every passage ends with sentence-ending punctuation
    for p in passages:
        assert p["text"].endswith((".", "!", "?"))
