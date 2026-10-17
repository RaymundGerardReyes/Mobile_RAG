"""Boundary, edge case, and failure mode tests across pipeline stages."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from ai_tutor_training.content_pack import build_content_pack
from ai_tutor_training.stages.build_embeddings import build_embeddings
from ai_tutor_training.stages.build_passages import build_passages
from ai_tutor_training.stages.export_gguf import export_gguf
from ai_tutor_training.stages.extract_textbook import extract_textbook
from ai_tutor_training.stages.link_qa_pairs import link_qa_pairs
from ai_tutor_training.stages.train import train


# ==============================================================================
# Stage 1: Extraction Boundary & Failure Tests
# ==============================================================================


def test_extract_corrupt_pdf_fails_cleanly(tmp_path: Path, pipeline_config: dict[str, Any]) -> None:
    """A corrupt / non-PDF file raises an error and leaves no output artifact."""
    corrupt_file = tmp_path / "corrupt.pdf"
    corrupt_file.write_bytes(b"%PDF-1.4\nCorrupted binary payload\x00\xff\xfe random garbage here")
    out_jsonl = tmp_path / "should_not_exist.jsonl"
    man_json = tmp_path / "should_not_exist_manifest.json"

    with pytest.raises(Exception):
        extract_textbook(
            pdf_path=corrupt_file,
            config=pipeline_config,
            output_path=out_jsonl,
            manifest_path=man_json,
        )

    assert not out_jsonl.exists(), "Corrupt PDF extraction should not leave output JSONL"
    assert not man_json.exists(), "Corrupt PDF extraction should not leave manifest"


def test_extract_empty_and_whitespace_only_pages(tmp_path: Path, pipeline_config: dict[str, Any]) -> None:
    """PDF containing whitespace-only pages sets is_empty and empty_reason correctly."""
    import fitz

    doc = fitz.open()
    p1 = doc.new_page()
    p1.insert_text((50, 50), "   \n\t\n   ", fontsize=10)
    p2 = doc.new_page()  # completely blank
    p3 = doc.new_page()
    p3.insert_text((50, 50), "CHAPTER 1: REAL CONTENT\n1. Valid question?", fontsize=10)

    pdf_path = tmp_path / "whitespace_test.pdf"
    doc.save(str(pdf_path))
    doc.close()

    out_jsonl = tmp_path / "whitespace_pages.jsonl"
    pages = extract_textbook(
        pdf_path=pdf_path,
        config=pipeline_config,
        output_path=out_jsonl,
    )

    assert len(pages) == 3
    assert pages[0]["is_empty"] is True
    assert pages[0]["empty_reason"] == "No text content detected"
    assert pages[1]["is_empty"] is True
    assert pages[1]["empty_reason"] == "No text content detected"
    assert pages[2]["is_empty"] is False
    assert pages[2]["empty_reason"] is None


# ==============================================================================
# Stage 2: Link QA Boundary & Failure Tests
# ==============================================================================


def test_link_qa_empty_pages_input(tmp_path: Path, pipeline_config: dict[str, Any]) -> None:
    """Empty list of pages produces empty output without crashing."""
    out_file = tmp_path / "empty_linked.jsonl"
    records = link_qa_pairs([], config=pipeline_config, output_path=out_file)
    assert len(records) == 0
    assert out_file.exists()


def test_link_qa_noisy_text_without_questions(tmp_path: Path, pipeline_config: dict[str, Any]) -> None:
    """Pages containing only narrative text produce 0 questions and valid output."""
    pages = [
        {
            "source_id": "test_id",
            "page_number": 1,
            "chapter": "Foreword",
            "section": "Preface",
            "text": "This is a foreword about the civil service examination. No questions here.",
            "is_empty": False,
            "empty_reason": None,
            "headings_detected": [],
        }
    ]
    out_file = tmp_path / "no_questions.jsonl"
    records = link_qa_pairs(pages, config=pipeline_config, output_path=out_file)
    assert len(records) == 0
    assert out_file.exists()


def test_link_qa_atomic_cleanup_on_write_failure(tmp_path: Path, pipeline_config: dict[str, Any]) -> None:
    """If target directory is read-only or invalid, temp files are cleaned up."""
    # Attempting to write into an impossible path (e.g., file used as directory)
    blocker = tmp_path / "blocker_file"
    blocker.write_text("not a directory", encoding="utf-8")
    invalid_target = blocker / "sub" / "output.jsonl"

    with pytest.raises(Exception):
        link_qa_pairs([], config=pipeline_config, output_path=invalid_target)

    # Verify no dangling temp files in tmp_path
    tmp_files = list(tmp_path.glob("*.tmp.*"))
    assert len(tmp_files) == 0


# ==============================================================================
# Stage 3: Passages Boundary Tests
# ==============================================================================


def test_build_passages_all_empty_pages(tmp_path: Path, pipeline_config: dict[str, Any]) -> None:
    """Extracted pages that are all marked is_empty yield 0 passages cleanly."""
    pages = [
        {
            "source_id": "s1",
            "page_number": 1,
            "chapter": "General",
            "section": None,
            "text": "",
            "is_empty": True,
            "empty_reason": "No text content detected",
            "headings_detected": [],
        },
        {
            "source_id": "s1",
            "page_number": 2,
            "chapter": "General",
            "section": None,
            "text": "   \n\n  ",
            "is_empty": True,
            "empty_reason": "No text content detected",
            "headings_detected": [],
        },
    ]
    out_file = tmp_path / "empty_passages.jsonl"
    passages = build_passages(pages, config=pipeline_config, output_path=out_file)
    assert len(passages) == 0
    assert out_file.exists()


def test_build_passages_huge_single_sentence(tmp_path: Path) -> None:
    """A sentence exceeding max_passage_words is still emitted without dropping or loop hanging."""
    huge_sentence = " ".join(["word"] * 500) + "."
    pages = [
        {
            "source_id": "s1",
            "page_number": 1,
            "chapter": "Stress Test",
            "section": None,
            "text": huge_sentence,
            "is_empty": False,
            "empty_reason": None,
            "headings_detected": [],
        }
    ]
    cfg = {"build_passages": {"max_passage_words": 100, "overlap_words": 20}}
    out_file = tmp_path / "huge_sentence.jsonl"
    passages = build_passages(pages, config=cfg, output_path=out_file)
    assert len(passages) >= 1
    assert passages[0]["word_count"] >= 500


# ==============================================================================
# Stages 4-6: Optional Subsystems Raise NotImplementedError
# ==============================================================================


def test_stage4_build_embeddings_raises_not_implemented() -> None:
    """Stage 4 (build_embeddings) raises NotImplementedError with clear MVP message."""
    with pytest.raises(NotImplementedError) as exc_info:
        build_embeddings([])
    assert "Embedding stage disabled for MVP" in str(exc_info.value)


def test_stage5_train_raises_not_implemented() -> None:
    """Stage 5 (train) raises NotImplementedError with clear MVP message."""
    with pytest.raises(NotImplementedError) as exc_info:
        train()
    assert "Training stage disabled for MVP" in str(exc_info.value)


def test_stage6_export_gguf_raises_not_implemented() -> None:
    """Stage 6 (export_gguf) raises NotImplementedError with clear MVP message."""
    with pytest.raises(NotImplementedError) as exc_info:
        export_gguf()
    assert "Export stage disabled for MVP" in str(exc_info.value)


# ==============================================================================
# Atomic Cleanup & Failure Rollback Tests
# ==============================================================================


def test_extract_atomic_cleanup_on_write_error(sample_pdf: Path, tmp_path: Path, pipeline_config: dict[str, Any]) -> None:
    """If extraction output target cannot be written, no orphan temp files remain."""
    blocker = tmp_path / "blocker"
    blocker.write_text("file_not_dir", encoding="utf-8")
    invalid_out = blocker / "sub" / "out.jsonl"

    with pytest.raises(Exception):
        extract_textbook(sample_pdf, config=pipeline_config, output_path=invalid_out)

    assert len(list(tmp_path.glob("*.tmp.*"))) == 0


def test_content_pack_atomic_cleanup_on_constraint_failure(tmp_path: Path, pipeline_config: dict[str, Any]) -> None:
    """If content pack fails DB constraints, no DB or temp files remain on disk."""
    bad_questions = tmp_path / "bad_q.jsonl"
    bad_questions.write_text(
        json.dumps(
            {
                "question_id": "q0001",
                "topic": "General",
                "question_type": "disallowed_type",  # CHECK constraint failure
                "stem": "Question stem",
                "source_page": 1,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    passages = tmp_path / "p.jsonl"
    passages.write_text(
        json.dumps(
            {
                "passage_id": "p0001",
                "chapter": "General",
                "start_page": 1,
                "end_page": 1,
                "text": "Some text content here.",
                "content_hash": "a" * 64,
                "word_count": 4,
            }
        )
        + "\n",
        encoding="utf-8",
    )

    out_db = tmp_path / "will_fail.db"
    with pytest.raises(Exception):
        build_content_pack(
            linked_questions_path=bad_questions,
            passages_path=passages,
            output_db_path=out_db,
            config=pipeline_config,
        )

    assert not out_db.exists()
    assert len(list(tmp_path.glob("*.tmp.*"))) == 0


def test_build_passages_atomic_cleanup_on_write_failure(tmp_path: Path, pipeline_config: dict[str, Any]) -> None:
    """If passages output target cannot be written, no orphan temp files remain."""
    blocker = tmp_path / "blocker_file"
    blocker.write_text("file_not_dir", encoding="utf-8")
    invalid_out = blocker / "sub" / "passages.jsonl"

    pages = [
        {
            "source_id": "test",
            "page_number": 1,
            "chapter": "General",
            "section": None,
            "text": "Valid sentence text here.",
            "is_empty": False,
            "empty_reason": None,
            "headings_detected": [],
        }
    ]
    with pytest.raises(Exception):
        build_passages(pages, config=pipeline_config, output_path=invalid_out)

    assert len(list(tmp_path.glob("*.tmp.*"))) == 0


def test_content_pack_missing_required_fields(tmp_path: Path, pipeline_config: dict[str, Any]) -> None:
    """Content pack building aborts and cleans up when input records lack required fields."""
    passages = tmp_path / "valid_passages.jsonl"
    passages.write_text(
        json.dumps(
            {
                "passage_id": "p0001",
                "chapter": "General",
                "start_page": 1,
                "end_page": 1,
                "text": "Some text content.",
                "content_hash": "a" * 64,
                "word_count": 3,
            }
        )
        + "\n",
        encoding="utf-8",
    )

    # 1. Question missing question_id
    bad_q_noid = tmp_path / "q_missing_id.jsonl"
    bad_q_noid.write_text(
        json.dumps(
            {
                "topic": "General",
                "question_type": "multiple_choice",
                "stem": "Stem without ID",
                "source_page": 1,
            }
        )
        + "\n",
        encoding="utf-8",
    )

    db_fail_1 = tmp_path / "fail1.db"
    with pytest.raises((KeyError, Exception)):
        build_content_pack(
            linked_questions_path=bad_q_noid,
            passages_path=passages,
            output_db_path=db_fail_1,
            config=pipeline_config,
        )
    assert not db_fail_1.exists()

    # 2. Question missing stem
    bad_q_nostem = tmp_path / "q_missing_stem.jsonl"
    bad_q_nostem.write_text(
        json.dumps(
            {
                "question_id": "q0001",
                "topic": "General",
                "question_type": "multiple_choice",
                "source_page": 1,
            }
        )
        + "\n",
        encoding="utf-8",
    )

    db_fail_2 = tmp_path / "fail2.db"
    with pytest.raises((KeyError, Exception)):
        build_content_pack(
            linked_questions_path=bad_q_nostem,
            passages_path=passages,
            output_db_path=db_fail_2,
            config=pipeline_config,
        )
    assert not db_fail_2.exists()


