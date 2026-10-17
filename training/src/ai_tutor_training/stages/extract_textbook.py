"""Stage 1: Extract text and structure from textbook PDF using PyMuPDF."""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any

from ai_tutor_training.provenance import (
    compute_sha256,
    create_stage_manifest,
    save_stage_manifest,
)


def extract_page_headings(
    text: str,
    chapter_patterns: list[str],
    section_patterns: list[str],
) -> tuple[str | None, str | None, list[str]]:
    """Scan text for chapter and section headings using regex patterns."""
    detected: list[str] = []
    chapter: str | None = None
    section: str | None = None

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        for pat in chapter_patterns:
            m = re.search(pat, line, re.IGNORECASE)
            if m:
                # Capture group 1 if present, else full match
                val = m.group(1).strip() if m.groups() and m.group(1) else line
                chapter = val
                detected.append(f"Chapter: {val}")
                break

        for pat in section_patterns:
            m = re.search(pat, line, re.IGNORECASE)
            if m:
                val = m.group(1).strip() if m.groups() and m.group(1) else line
                section = val
                detected.append(f"Section: {val}")
                break

    return chapter, section, detected


def extract_textbook(
    pdf_path: Path | str,
    config: dict[str, Any] | None = None,
    output_path: Path | str | None = None,
    manifest_path: Path | str | None = None,
) -> list[dict[str, Any]]:
    """Extract page-by-page text from a PDF, preserving 1:1 page correspondence.

    Returns:
        List of dicts conforming to extracted-page.schema.json
    """
    started_at = datetime.datetime.now(datetime.timezone.utc)
    pdf_p = Path(pdf_path)
    if not pdf_p.exists():
        raise FileNotFoundError(f"Source PDF does not exist: {pdf_p}")

    cfg = config or {}
    stage_cfg = cfg.get("extract_textbook", {})
    chapter_patterns = stage_cfg.get(
        "chapter_heading_patterns",
        [
            r"^(?:CHAPTER|Chapter|KABANATA|Kabanata)\s+[\dIVXLCDM]+[.:]?\s*(.*)",
            r"^(?:PART|Part|BAHAGI|Bahagi)\s+[\dIVXLCDM]+[.:]?\s*(.*)",
            r"^(?:ENGLISH|MATH|FILIPINO|GENERAL\s+(?:INFORMATION|LAWS?)|CLERICAL\s+OPERATIONS)",
            r"^(?:NUMERICAL\s+ABILITY|VERBAL\s+ABILITY|ANALYTICAL\s+ABILITY)",
        ],
    )
    section_heading_patterns = stage_cfg.get(
        "section_heading_patterns",
        [
            r"^(?:Section|Seksyon)(?:\s+[\dIVXLCDM]+)?[.:]?\s*(.*)",
            r"^(?:Vocabulary|Grammar|Reading Comprehension|Analogy|Logic|Word Problems)",
            r"^(?:Balarila|Talasalitaan|Pagbasa|Saligang Batas|R\.A\.\s*6713)",
        ],
    )

    out_file = Path(output_path or stage_cfg.get("output_path", "artifacts/extracted_pages.jsonl"))
    if manifest_path:
        man_file = Path(manifest_path)
    elif output_path:
        cfg_name = Path(stage_cfg.get("manifest_path", "artifacts/extract_manifest.json")).name
        man_file = out_file.parent / cfg_name
    else:
        man_file = Path(stage_cfg.get("manifest_path", "artifacts/extract_manifest.json"))

    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise ImportError(
            "PyMuPDF is required for PDF extraction. Install via: pip install pymupdf"
        )

    doc = fitz.open(str(pdf_p))
    try:
        source_id = compute_sha256(pdf_p)

        extracted_pages: list[dict[str, Any]] = []
        current_chapter: str | None = None
        current_section: str | None = None
        warnings: list[str] = []

        for page_idx in range(len(doc)):
            page_num = page_idx + 1
            page = doc[page_idx]
            raw_text = page.get_text("text") or ""
            clean_text = raw_text.strip()

            is_empty = len(clean_text) == 0
            empty_reason = "No text content detected" if is_empty else None

            new_chap, new_sec, headings = extract_page_headings(
                clean_text, chapter_patterns, section_heading_patterns
            )
            if new_chap:
                current_chapter = new_chap
            if new_sec:
                current_section = new_sec

            record: dict[str, Any] = {
                "source_id": source_id,
                "page_number": page_num,
                "chapter": current_chapter,
                "section": current_section,
                "text": clean_text,
                "is_empty": is_empty,
                "empty_reason": empty_reason,
                "headings_detected": headings,
            }
            extracted_pages.append(record)
    finally:
        doc.close()

    # Save output JSONL atomically
    out_file.parent.mkdir(parents=True, exist_ok=True)
    temp_out = out_file.parent / f"{out_file.name}.tmp.{uuid.uuid4().hex}"
    try:
        with temp_out.open("w", encoding="utf-8") as f:
            for rec in extracted_pages:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        os.replace(temp_out, out_file)
    except Exception:
        if temp_out.exists():
            try:
                temp_out.unlink()
            except Exception:
                pass
        raise

    ended_at = datetime.datetime.now(datetime.timezone.utc)

    # Save manifest
    manifest = create_stage_manifest(
        stage="extract_textbook",
        started_at=started_at,
        ended_at=ended_at,
        status="success",
        input_files={"source_pdf": pdf_p},
        output_files={"extracted_pages": out_file},
        config=cfg,
        record_count=len(extracted_pages),
        warnings=warnings,
    )
    save_stage_manifest(manifest, man_file)

    return extracted_pages


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract textbook pages from PDF to JSONL.")
    parser.add_argument("--pdf", required=True, help="Path to input PDF file.")
    parser.add_argument("--output", help="Path to output JSONL file.")
    parser.add_argument("--manifest", help="Path to output manifest JSON file.")
    parser.add_argument("--config", help="Path to pipeline YAML config.")
    args = parser.parse_args()

    cfg: dict[str, Any] = {}
    if args.config:
        import yaml

        with open(args.config, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}

    pages = extract_textbook(
        pdf_path=args.pdf,
        config=cfg,
        output_path=args.output,
        manifest_path=args.manifest,
    )
    print(f"Extracted {len(pages)} pages successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
