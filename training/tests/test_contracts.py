"""Tests for JSON Schema contract enforcement and validation utilities."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ai_tutor_training.contracts import (
    load_schema,
    validate_jsonl_against_schema,
    validate_record_against_schema,
)

pytestmark = [pytest.mark.unit, pytest.mark.integration]


def test_sample_pages_contract(sample_pages_path: Path, contracts_dir: Path) -> None:
    schema_path = contracts_dir / "extracted-page.schema.json"
    report = validate_jsonl_against_schema(sample_pages_path, schema_path)
    assert report.is_valid, f"Validation failed: {report.errors}"
    assert report.valid_count == 10
    assert report.invalid_count == 0


def test_sample_linked_questions_contract(
    sample_linked_questions_path: Path, contracts_dir: Path
) -> None:
    schema_path = contracts_dir / "linked-question.schema.json"
    report = validate_jsonl_against_schema(sample_linked_questions_path, schema_path)
    assert report.is_valid, f"Validation failed: {report.errors}"
    assert report.valid_count == 15
    assert report.invalid_count == 0


def test_sample_passages_contract(
    sample_passages_path: Path, contracts_dir: Path
) -> None:
    schema_path = contracts_dir / "passage.schema.json"
    report = validate_jsonl_against_schema(sample_passages_path, schema_path)
    assert report.is_valid, f"Validation failed: {report.errors}"
    assert report.valid_count == 8
    assert report.invalid_count == 0


def test_extracted_page_missing_required_field(contracts_dir: Path) -> None:
    schema = load_schema(contracts_dir / "extracted-page.schema.json")
    bad_record = {
        # missing source_id
        "page_number": 1,
        "chapter": "General",
        "section": None,
        "text": "Hello world",
    }
    errors = validate_record_against_schema(bad_record, schema)
    assert len(errors) > 0
    assert any("source_id" in err for err in errors)


def test_linked_question_invalid_id_pattern(contracts_dir: Path) -> None:
    schema = load_schema(contracts_dir / "linked-question.schema.json")
    bad_record = {
        "question_id": "invalid_id_123",  # Must match ^q[0-9]{4,}$
        "topic": "General",
        "question_type": "multiple_choice",
        "stem": "Sample stem",
        "source_page": 1,
    }
    errors = validate_record_against_schema(bad_record, schema)
    assert len(errors) > 0
    assert any("question_id" in err for err in errors)


def test_linked_question_invalid_question_type(contracts_dir: Path) -> None:
    schema = load_schema(contracts_dir / "linked-question.schema.json")
    bad_record = {
        "question_id": "q0001",
        "topic": "General",
        "question_type": "true_false",  # Not in enum
        "stem": "Sample stem",
        "source_page": 1,
    }
    errors = validate_record_against_schema(bad_record, schema)
    assert len(errors) > 0
    assert any("question_type" in err for err in errors)


def test_passage_invalid_hash_pattern(contracts_dir: Path) -> None:
    schema = load_schema(contracts_dir / "passage.schema.json")
    bad_record = {
        "passage_id": "p0001",
        "chapter": "General",
        "start_page": 1,
        "end_page": 1,
        "text": "Sample text",
        "content_hash": "not_a_sha256_hash",  # must be 64-char hex
    }
    errors = validate_record_against_schema(bad_record, schema)
    assert len(errors) > 0
    assert any("content_hash" in err for err in errors)


def test_validate_empty_jsonl_file(tmp_path: Path, contracts_dir: Path) -> None:
    empty_file = tmp_path / "empty.jsonl"
    empty_file.write_text("", encoding="utf-8")
    schema_path = contracts_dir / "passage.schema.json"
    report = validate_jsonl_against_schema(empty_file, schema_path)
    assert report.is_valid
    assert report.valid_count == 0
    assert report.invalid_count == 0


def test_validate_nonexistent_file(tmp_path: Path, contracts_dir: Path) -> None:
    missing_file = tmp_path / "does_not_exist.jsonl"
    schema_path = contracts_dir / "passage.schema.json"
    report = validate_jsonl_against_schema(missing_file, schema_path)
    assert not report.is_valid
    assert report.invalid_count == 1


def test_stage_manifest_contract(tmp_path: Path, contracts_dir: Path) -> None:
    import datetime
    from ai_tutor_training.provenance import create_stage_manifest

    schema = load_schema(contracts_dir / "stage-manifest.schema.json")

    dummy_file = tmp_path / "dummy.txt"
    dummy_file.write_text("dummy content", encoding="utf-8")

    now = datetime.datetime.now(datetime.timezone.utc)
    manifest = create_stage_manifest(
        stage="extract_textbook",
        started_at=now,
        ended_at=now,
        status="success",
        input_files={"source": dummy_file},
        output_files={"output": dummy_file},
        record_count=10,
    )

    errors = validate_record_against_schema(manifest, schema)
    assert len(errors) == 0, f"Stage manifest schema errors: {errors}"


def test_model_manifest_contract(contracts_dir: Path) -> None:
    schema = load_schema(contracts_dir / "model-manifest.schema.json")

    valid_model_manifest = {
        "manifest_id": "model_qwen3_1.7b_q4_k_m",
        "model_name": "Qwen3-1.7B-Instruct",
        "model_revision": "2026.10",
        "base_model_repo": "Qwen/Qwen3-1.7B-Instruct",
        "quantization": "Q4_K_M",
        "file_sha256": "a" * 64,
        "file_size_bytes": 1073741824,
        "license": "Apache-2.0",
        "runtime": "llama.rn",
        "context_length": 2048,
        "created_at": "2026-10-15T00:00:00Z",
    }
    errors = validate_record_against_schema(valid_model_manifest, schema)
    assert len(errors) == 0, f"Model manifest schema errors: {errors}"

    # Invalid sha256 pattern
    bad_manifest = dict(valid_model_manifest, file_sha256="invalid_hash")
    bad_errors = validate_record_against_schema(bad_manifest, schema)
    assert len(bad_errors) > 0

