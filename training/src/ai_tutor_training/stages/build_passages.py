"""Stage 3: Build bounded, sentence-aware passages with stable IDs."""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

from ai_tutor_training.provenance import (
    create_stage_manifest,
    save_stage_manifest,
)


_ABBREVIATION_PATTERN = re.compile(
    r"(?:"
    r"\b(?:No|Art|Sec|Mr|Ms|Mrs|Dr|Prof|Atty|vs|v|p|pp|RA|vol|par|para|ch|dept|gov|gen|col|lt|pres|sen|rep|univ|sr|jr|cf|al|Blg|Pah)"
    r"|\b[A-Za-z]\.[A-Za-z]"
    r"|\b[A-Za-z]\.[A-Za-z]\.[A-Za-z]"
    r")\.[)\]\"']{0,2}$",
    re.IGNORECASE,
)

_ENUMERATION_PATTERN = re.compile(r"^(\(?\d+[.)]?|\(?[A-Za-z][.)])$")
_SECTION_LABEL_PATTERN = re.compile(
    r"\b(?:Sec|Section|Art|Article|Rule|Item|Chapter)\.?\s+[A-Za-z0-9IVXLCDM]+[.:]?$",
    re.IGNORECASE,
)
_NAME_WITH_INITIAL_PATTERN = re.compile(
    r"(?:\b[A-Z][a-zA-Z'\-]+\s+[A-Z]|\b[A-Z]\.\s*[A-Z])\.[)\]\"']{0,2}$"
)


def _starts_with_lowercase(text: str) -> bool:
    stripped = text.lstrip("\"'([{\u201c\u2018")
    return bool(stripped and stripped[0].islower())


def split_into_sentences(text: str) -> list[str]:
    """Split text along sentence boundaries without splitting mid-sentence or on abbreviations."""
    if not text or not text.strip():
        return []

    # Split on periods/exclamations/question marks followed by whitespace or double newlines.
    # Note: Look-behinds (?<=[.!?]), (?<=[.!?][\"'”’\)\]]), and (?<=[.!?][\"'”’][\)\]]) are strictly
    # fixed-width (1, 2, and 3 chars), ensuring full compatibility with Python standard re while
    # cleanly handling sentences ending in quotes, parentheses, or brackets.
    raw_chunks = re.split(
        r"(?<=[.!?])\s+|(?<=[.!?][\"'”’\)\]])\s+|(?<=[.!?][\"'”’][\)\]])\s+|\n{2,}",
        text,
    )
    cleaned_chunks = [c.strip() for c in raw_chunks if c.strip()]
    if not cleaned_chunks:
        return []

    sentences: list[str] = []
    current = ""

    for chunk in cleaned_chunks:
        if not current:
            current = chunk
            continue

        # Rejoin if current chunk ends with a known abbreviation, a person's middle/first initial,
        # is a standalone item label (e.g. '1.' or 'A.'), matches a section label, or if subsequent
        # chunk starts with a lowercase letter.
        should_merge = (
            bool(_ABBREVIATION_PATTERN.search(current))
            or bool(_NAME_WITH_INITIAL_PATTERN.search(current))
            or bool(_ENUMERATION_PATTERN.match(current))
            or bool(_SECTION_LABEL_PATTERN.search(current))
            or _starts_with_lowercase(chunk)
        )

        if should_merge:
            current = f"{current} {chunk}"
        else:
            sentences.append(current)
            current = chunk

    if current:
        sentences.append(current)

    return sentences


def count_words(text: str) -> int:
    """Return approximate word count of text."""
    return len(text.split())


def build_passages(
    extracted_pages: list[dict[str, Any]] | Path | str,
    config: dict[str, Any] | None = None,
    output_path: Path | str | None = None,
    manifest_path: Path | str | None = None,
) -> list[dict[str, Any]]:
    """Chunk extracted pages into passages adhering to passage.schema.json."""
    started_at = datetime.datetime.now(datetime.timezone.utc)
    cfg = config or {}
    stage_cfg = cfg.get("build_passages", {})

    max_words = stage_cfg.get("max_passage_words", 300)
    overlap_words = stage_cfg.get("overlap_words", 50)
    out_file = Path(output_path or stage_cfg.get("output_path", "artifacts/passages.jsonl"))
    if manifest_path:
        man_file = Path(manifest_path)
    elif output_path:
        cfg_name = Path(stage_cfg.get("manifest_path", "artifacts/passages_manifest.json")).name
        man_file = out_file.parent / cfg_name
    else:
        man_file = Path(stage_cfg.get("manifest_path", "artifacts/passages_manifest.json"))

    pages: list[dict[str, Any]]
    pages_input_path: Path | None = None
    if isinstance(extracted_pages, (str, Path)):
        pages_input_path = Path(extracted_pages)
        pages = []
        with pages_input_path.open("r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    pages.append(json.loads(line))
    else:
        pages = extracted_pages

    # Group consecutive non-empty pages by chapter & section
    groups: list[dict[str, Any]] = []
    current_group: dict[str, Any] | None = None

    for page in pages:
        if page.get("is_empty"):
            continue
        text = page.get("text", "").strip()
        if not text:
            continue

        chap = page.get("chapter") or "General"
        sec = page.get("section")
        p_num = page.get("page_number", 1)

        if (
            current_group is None
            or current_group["chapter"] != chap
            or current_group["section"] != sec
        ):
            if current_group:
                groups.append(current_group)
            current_group = {
                "chapter": chap,
                "section": sec,
                "pages": [(p_num, text)],
            }
        else:
            current_group["pages"].append((p_num, text))

    if current_group:
        groups.append(current_group)

    passages: list[dict[str, Any]] = []
    p_counter = 1

    for grp in groups:
        chapter = grp["chapter"]
        section = grp["section"]

        # Sentence-level stream with page mapping
        sentence_stream: list[tuple[int, str]] = []
        for p_num, p_text in grp["pages"]:
            sents = split_into_sentences(p_text)
            for s in sents:
                sentence_stream.append((p_num, s))

        if not sentence_stream:
            continue

        idx = 0
        while idx < len(sentence_stream):
            chunk_sents: list[str] = []
            chunk_pages: list[int] = []
            current_word_count = 0

            inner_idx = idx
            while inner_idx < len(sentence_stream):
                p_num, s_text = sentence_stream[inner_idx]
                s_words = count_words(s_text)

                # If first sentence alone exceeds max_words, include it anyway
                if current_word_count > 0 and (current_word_count + s_words > max_words):
                    break

                chunk_sents.append(s_text)
                chunk_pages.append(p_num)
                current_word_count += s_words
                inner_idx += 1

            if not chunk_sents:
                # Progress at least 1 sentence even if huge
                p_num, s_text = sentence_stream[idx]
                chunk_sents.append(s_text)
                chunk_pages.append(p_num)
                current_word_count = count_words(s_text)
                inner_idx = idx + 1

            passage_text = " ".join(chunk_sents).strip()
            content_hash = hashlib.sha256(passage_text.encode("utf-8")).hexdigest()
            passage_id = f"p{p_counter:04d}"
            p_counter += 1

            passages.append(
                {
                    "passage_id": passage_id,
                    "chapter": chapter,
                    "section": section,
                    "start_page": min(chunk_pages),
                    "end_page": max(chunk_pages),
                    "text": passage_text,
                    "content_hash": content_hash,
                    "word_count": current_word_count,
                }
            )

            # Move index forward, accounting for overlap
            if inner_idx >= len(sentence_stream):
                break

            # Calculate how many sentences to rewind for overlap
            overlap_accum = 0
            rewind = 0
            while rewind < len(chunk_sents) - 1:
                cand_s = chunk_sents[-(rewind + 1)]
                overlap_accum += count_words(cand_s)
                if overlap_accum >= overlap_words:
                    rewind += 1
                    break
                rewind += 1

            step = (inner_idx - idx) - rewind
            if step <= 0:
                step = 1
            idx += step

    # Write output JSONL
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with out_file.open("w", encoding="utf-8") as f:
        for p in passages:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    ended_at = datetime.datetime.now(datetime.timezone.utc)

    # Save manifest
    input_files: dict[str, Path | str] = {}
    if pages_input_path and pages_input_path.exists():
        input_files["extracted_pages"] = pages_input_path

    manifest = create_stage_manifest(
        stage="build_passages",
        started_at=started_at,
        ended_at=ended_at,
        status="success",
        input_files=input_files,
        output_files={"passages": out_file},
        config=cfg,
        record_count=len(passages),
    )
    save_stage_manifest(manifest, man_file)

    return passages


def main() -> int:
    parser = argparse.ArgumentParser(description="Build passages from extracted pages.")
    parser.add_argument("--input", required=True, help="Path to extracted_pages.jsonl")
    parser.add_argument("--output", help="Path to passages.jsonl")
    parser.add_argument("--manifest", help="Path to passages_manifest.json")
    parser.add_argument("--config", help="Path to pipeline YAML config")
    args = parser.parse_args()

    cfg: dict[str, Any] = {}
    if args.config:
        import yaml

        with open(args.config, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}

    records = build_passages(
        extracted_pages=args.input,
        config=cfg,
        output_path=args.output,
        manifest_path=args.manifest,
    )
    print(f"Built {len(records)} passages.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
