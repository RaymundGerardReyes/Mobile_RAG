"""Shared pytest fixtures for the AI Tutor test suite."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

try:
    from fixtures.generate_sample_pdf import generate_sample_pdf
except ImportError:
    try:
        from tests.fixtures.generate_sample_pdf import generate_sample_pdf
    except ImportError:
        from training.tests.fixtures.generate_sample_pdf import generate_sample_pdf


@pytest.fixture
def repo_root() -> Path:
    """Return absolute path to repository root."""
    return Path(__file__).resolve().parent.parent.parent


@pytest.fixture
def fixtures_dir(repo_root: Path) -> Path:
    """Return path to tests/fixtures directory."""
    return repo_root / "training" / "tests" / "fixtures"


@pytest.fixture
def contracts_dir(repo_root: Path) -> Path:
    """Return path to contracts directory."""
    return repo_root / "contracts"


@pytest.fixture
def sample_pages_path(fixtures_dir: Path) -> Path:
    """Return path to sample_pages.jsonl."""
    return fixtures_dir / "sample_pages.jsonl"


@pytest.fixture
def sample_linked_questions_path(fixtures_dir: Path) -> Path:
    """Return path to sample_linked_questions.jsonl."""
    return fixtures_dir / "sample_linked_questions.jsonl"


@pytest.fixture
def sample_passages_path(fixtures_dir: Path) -> Path:
    """Return path to sample_passages.jsonl."""
    return fixtures_dir / "sample_passages.jsonl"


@pytest.fixture
def sample_pdf(tmp_path: Path) -> Path:
    """Generate and return a synthetic PDF in a temporary directory."""
    pdf_path = tmp_path / "synthetic_reviewer.pdf"
    generate_sample_pdf(pdf_path)
    return pdf_path


@pytest.fixture
def pipeline_config() -> dict[str, Any]:
    """Default test pipeline configuration."""
    return {
        "source": {"pdf_path": "data/raw/reviewer.pdf"},
        "extract_textbook": {
            "output_path": "artifacts/extracted_pages.jsonl",
            "manifest_path": "artifacts/extract_manifest.json",
            "chapter_heading_patterns": [
                r"^(?:CHAPTER|Chapter|KABANATA|Kabanata)\s+[\dIVXLCDM]+[.:]?\s*(.*)",
            ],
            "section_heading_patterns": [
                r"^(?:Section|Seksyon)\s+[\dIVXLCDM]+[.:]?\s*(.*)",
            ],
        },
        "link_qa_pairs": {
            "content_version": "2026.10.1",
            "question_patterns": [
                r"^\s*(\d{1,4})[.)]\s+(.*)",
            ],
            "choice_patterns": [
                r"^\s*([A-Da-d])[.)]\s+(.*)",
            ],
            "answer_key_header_patterns": [
                r"(?i)(?:answer\s+key|susi\s+sa\s+pagwawasto)",
            ],
            "answer_key_item_patterns": [
                r"(\d{1,4})\s*[-–—:]\s*([A-Da-d])\b",
                r"(\d{1,4})[.)]\s*([A-Da-d])\b",
            ],
        },
        "build_passages": {
            "max_passage_words": 300,
            "overlap_words": 50,
        },
        "content_pack": {
            "version": "2026.10.1",
        },
    }
