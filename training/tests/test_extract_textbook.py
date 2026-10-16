"""Tests for Stage 1: extract_textbook."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ai_tutor_training.contracts import validate_jsonl_against_schema
from ai_tutor_training.stages.extract_textbook import extract_textbook


def test_extract_textbook_synthetic_pdf(
    sample_pdf: Path, tmp_path: Path, pipeline_config: dict, contracts_dir: Path
) -> None:
    output_jsonl = tmp_path / "extracted_pages.jsonl"
    manifest_json = tmp_path / "extract_manifest.json"

    pages = extract_textbook(
        pdf_path=sample_pdf,
        config=pipeline_config,
        output_path=output_jsonl,
        manifest_path=manifest_json,
    )

    # 1. Correct page count: synthetic PDF has exactly 6 pages
    assert len(pages) == 6
    assert output_jsonl.exists()
    assert manifest_json.exists()

    # 2. 1:1 page correspondence
    page_numbers = [p["page_number"] for p in pages]
    assert page_numbers == [1, 2, 3, 4, 5, 6]

    # 3. Chapter heading detection
    assert "CHAPTER 1: GENERAL INFORMATION" in pages[0]["text"]
    assert pages[0]["chapter"] is not None
    assert "GENERAL INFORMATION" in pages[0]["chapter"]

    # 4. Empty page detection (page 6 was left blank)
    assert pages[5]["is_empty"] is True
    assert pages[5]["empty_reason"] == "No text content detected"

    # 5. Bilingual text presence (Filipino in chapter 2)
    assert "marikit" in pages[3]["text"]
    assert "masigasig" in pages[3]["text"]
    assert "Susi sa Pagwawasto" in pages[4]["text"]

    # 6. Source ID consistency
    source_ids = {p["source_id"] for p in pages}
    assert len(source_ids) == 1
    assert len(list(source_ids)[0]) == 64

    # 7. Validate output against schema
    schema_path = contracts_dir / "extracted-page.schema.json"
    report = validate_jsonl_against_schema(output_jsonl, schema_path)
    assert report.is_valid, f"Contract errors: {report.errors}"
    assert report.valid_count == 6

    # 8. Verify manifest
    with manifest_json.open("r", encoding="utf-8") as f:
        manifest = json.load(f)
    assert manifest["stage"] == "extract_textbook"
    assert manifest["status"] == "success"
    assert manifest["record_count"] == 6
    assert "source_pdf" in manifest["input_hashes"] or sample_pdf.name in manifest["input_hashes"]
    assert "extracted_pages.jsonl" in manifest["output_hashes"]


def test_extract_nonexistent_pdf(tmp_path: Path, pipeline_config: dict) -> None:
    fake_pdf = tmp_path / "does_not_exist.pdf"
    with pytest.raises(FileNotFoundError):
        extract_textbook(fake_pdf, config=pipeline_config)
