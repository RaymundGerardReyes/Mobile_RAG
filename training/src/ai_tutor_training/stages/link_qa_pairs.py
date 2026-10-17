"""Stage 2: Parse and link questions, choices, and answer keys."""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
import uuid
from pathlib import Path
from typing import Any

from ai_tutor_training.provenance import (
    create_stage_manifest,
    save_stage_manifest,
)


def parse_answer_keys(
    pages: list[dict[str, Any]],
    header_patterns: list[str],
    item_patterns: list[str],
    c_patterns: list[str] | None = None,
    q_patterns: list[str] | None = None,
) -> tuple[dict[tuple[str | None, int], tuple[str, int]], list[tuple[int, str, int]]]:
    """Pass 1: Find answer key sections and extract (question_num -> (key, page_num)).

    Returns:
        chapter_keys: {(chapter, q_num): (key_char_or_text, page_num)}
        global_keys: [(q_num, key_char_or_text, page_num)]
    """
    chapter_keys: dict[tuple[str | None, int], tuple[str, int]] = {}
    global_keys: list[tuple[int, str, int]] = []

    for page in pages:
        text = page.get("text", "")
        page_num = page.get("page_number", 1)
        chapter = page.get("chapter")

        lines = text.splitlines()
        in_answer_key = False

        for line in lines:
            line_str = line.strip()
            if not line_str:
                continue

            # If line is a choice or question stem, it cannot be an answer key header
            is_choice = any(re.match(c_pat, line_str) for c_pat in (c_patterns or []))
            is_question = any(re.match(q_pat, line_str) for q_pat in (q_patterns or []))

            # Check if this line signals an answer key section
            if not is_choice and not is_question:
                for h_pat in header_patterns:
                    if re.search(h_pat, line_str, re.IGNORECASE):
                        in_answer_key = True
                        break

            if in_answer_key:
                # Find all answers in the line
                found_in_line = False
                for i_pat in item_patterns:
                    matches = re.findall(i_pat, line_str)
                    if matches:
                        found_in_line = True
                        for m in matches:
                            try:
                                q_num = int(m[0])
                                ans_char = m[1].strip().upper()
                                chapter_keys[(chapter, q_num)] = (ans_char, page_num)
                                global_keys.append((q_num, ans_char, page_num))
                            except (ValueError, IndexError):
                                pass
                        break

                # Also support single-line identification/short-answer keys (e.g. "4 - Republic Act 6713")
                if not found_in_line:
                    text_ans_match = re.match(r"^\s*(\d{1,4})\s*[-–—.:]\s*(.+)$", line_str)
                    if text_ans_match:
                        try:
                            q_num = int(text_ans_match.group(1))
                            ans_val = text_ans_match.group(2).strip()
                            if ans_val:
                                found_in_line = True
                                if len(ans_val) == 1 and ans_val.upper() in "ABCD":
                                    ans_val = ans_val.upper()
                                chapter_keys[(chapter, q_num)] = (ans_val, page_num)
                                global_keys.append((q_num, ans_val, page_num))
                        except (ValueError, IndexError):
                            pass

                # If a new chapter or question heading appears, exit answer key section
                if not found_in_line:
                    if re.match(
                        r"^(?:CHAPTER|Chapter|KABANATA|Kabanata|PART|Part|BAHAGI|Bahagi)\s+",
                        line_str,
                        re.IGNORECASE,
                    ) or any(re.match(q_pat, line_str) for q_pat in (q_patterns or [])):
                        in_answer_key = False

    return chapter_keys, global_keys


def classify_question_type(stem: str, choices: list[dict[str, str]] | None) -> str:
    """Classify question into multiple_choice, essay, or identification."""
    if choices and len(choices) > 0:
        return "multiple_choice"

    stem_lower = stem.lower()
    essay_keywords = [
        "explain",
        "ipaliwanag",
        "discuss",
        "talakayin",
        "enumerate",
        "isa-isahin",
        "magbigay ng",
        "in your own words",
        "sa iyong sariling salita",
    ]
    for kw in essay_keywords:
        if kw in stem_lower:
            return "essay"

    return "identification"


def parse_questions_from_pages(
    pages: list[dict[str, Any]],
    q_patterns: list[str],
    c_patterns: list[str],
    header_patterns: list[str],
) -> list[dict[str, Any]]:
    """Pass 2: Extract question stems and choices across pages."""
    raw_questions: list[dict[str, Any]] = []

    current_q: dict[str, Any] | None = None
    current_choice: dict[str, str] | None = None
    in_answer_key = False

    for page in pages:
        text = page.get("text", "")
        page_num = page.get("page_number", 1)
        chapter = page.get("chapter")

        lines = text.splitlines()

        for line in lines:
            line_str = line.strip()
            if not line_str:
                continue

            # If line is a choice or question stem, it cannot be an answer key header
            is_choice = any(re.match(c_pat, line_str) for c_pat in c_patterns)
            is_question = any(re.match(q_pat, line_str) for q_pat in q_patterns)

            # Check if answer key starts — questions stop here
            is_ak_header = (not is_choice and not is_question) and any(
                re.search(h_pat, line_str, re.IGNORECASE) for h_pat in header_patterns
            )
            if is_ak_header:
                in_answer_key = True
                if current_q:
                    raw_questions.append(current_q)
                    current_q = None
                    current_choice = None
                continue

            # If inside answer key, check if a new chapter or question restarts normal text
            if in_answer_key:
                if re.match(
                    r"^(?:CHAPTER|Chapter|KABANATA|Kabanata|PART|Part|BAHAGI|Bahagi)\s+",
                    line_str,
                    re.IGNORECASE,
                ):
                    in_answer_key = False
                    continue
                if any(re.match(q_pat, line_str) for q_pat in q_patterns):
                    in_answer_key = False
                    # Fall through to parse question
                else:
                    continue

            # Check for question stem
            matched_q = False
            for q_pat in q_patterns:
                m = re.match(q_pat, line_str)
                if m:
                    # Save previous question if exists
                    if current_q:
                        raw_questions.append(current_q)

                    try:
                        q_num = int(m.group(1))
                    except (IndexError, ValueError):
                        q_num = len(raw_questions) + 1

                    if len(m.groups()) >= 2 and m.group(2):
                        stem_text = m.group(2).strip()
                    else:
                        stem_text = line_str[m.end():].strip()

                    current_q = {
                        "raw_num": q_num,
                        "chapter": chapter,
                        "page_number": page_num,
                        "stem_lines": [stem_text] if stem_text else [],
                        "choices": [],
                        "inline_answer": None,
                    }
                    current_choice = None
                    matched_q = True
                    break

            if matched_q:
                continue

            # Check for choices (A., B., C., D.) if inside a question
            if current_q:
                # Check for inline answer pattern (e.g. "Answer: A" or "Sagot: Republic Act 6713")
                inline_match = re.match(
                    r"^(?:Answer|Sagot|Canonical Answer)\s*[:\-]\s*(.*)$",
                    line_str,
                    re.IGNORECASE,
                )
                if inline_match:
                    current_q["inline_answer"] = inline_match.group(1).strip()
                    continue

                matched_c = False
                for c_pat in c_patterns:
                    m = re.match(c_pat, line_str)
                    if m:
                        key = m.group(1).upper()
                        if len(m.groups()) >= 2 and m.group(2):
                            choice_text = m.group(2).strip()
                        else:
                            choice_text = line_str[m.end():].strip()
                        current_choice = {"key": key, "text": choice_text}
                        current_q["choices"].append(current_choice)
                        matched_c = True
                        break

                if matched_c:
                    continue

                # Continuation line
                if current_choice:
                    current_choice["text"] += f" {line_str}"
                else:
                    current_q["stem_lines"].append(line_str)

    if current_q:
        raw_questions.append(current_q)

    return raw_questions


def link_qa_pairs(
    extracted_pages: list[dict[str, Any]] | Path | str,
    config: dict[str, Any] | None = None,
    output_path: Path | str | None = None,
    manifest_path: Path | str | None = None,
) -> list[dict[str, Any]]:
    """Parse, link, and validate questions against answer keys.

    Returns:
        List of dicts conforming to linked-question.schema.json
    """
    started_at = datetime.datetime.now(datetime.timezone.utc)
    cfg = config or {}
    stage_cfg = cfg.get("link_qa_pairs", {})

    content_version = stage_cfg.get("content_version", "2026.10.1")
    out_file = Path(output_path or stage_cfg.get("output_path", "artifacts/linked_questions.jsonl"))
    if manifest_path:
        man_file = Path(manifest_path)
    elif output_path:
        cfg_name = Path(stage_cfg.get("manifest_path", "artifacts/link_manifest.json")).name
        man_file = out_file.parent / cfg_name
    else:
        man_file = Path(stage_cfg.get("manifest_path", "artifacts/link_manifest.json"))

    # Load pages if path is given
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

    q_patterns = stage_cfg.get(
        "question_patterns",
        [
            r"^\s*(\d{1,4})[.)]\s+(.*)",
            r"^\s*Question\s+(\d{1,4})[.:]\s*(.*)",
            r"^\s*Tanong\s+(\d{1,4})[.:]\s*(.*)",
        ],
    )
    c_patterns = stage_cfg.get(
        "choice_patterns",
        [
            r"^\s*([A-Da-d])[.)]\s+(.*)",
            r"^\s*\[([A-Da-d])\]\s*(.*)",
        ],
    )
    ak_header_patterns = stage_cfg.get(
        "answer_key_header_patterns",
        [r"(?i)(?:answer\s+key|susi\s+sa\s+pagwawasto|mga\s+tamang\s+sagot|correct\s+answers)"],
    )
    ak_item_patterns = stage_cfg.get(
        "answer_key_item_patterns",
        [
            r"(\d{1,4})\s*[-–—:]\s*([A-Da-d])\b",
            r"(\d{1,4})[.)]\s*([A-Da-d])\b",
            r"(\d{1,4})\s+([A-Da-d])\b",
        ],
    )

    # Pass 1: Parse Answer Keys
    chapter_keys, global_keys = parse_answer_keys(
        pages, ak_header_patterns, ak_item_patterns, c_patterns, q_patterns
    )

    # Pass 2: Parse Questions and Choices
    raw_questions = parse_questions_from_pages(
        pages, q_patterns, c_patterns, ak_header_patterns
    )

    linked_records: list[dict[str, Any]] = []
    warnings: list[str] = []
    used_keys: set[tuple[str | None, int]] = set()

    for idx, rq in enumerate(raw_questions, start=1):
        q_id = f"q{idx:04d}"
        raw_num = rq["raw_num"]
        chapter = rq["chapter"]
        page_num = rq["page_number"]
        stem = " ".join(rq["stem_lines"]).strip()
        choices = rq["choices"] if rq["choices"] else None
        inline_answer = rq.get("inline_answer")

        q_type = classify_question_type(stem, choices)
        topic = chapter or "General Information"

        canonical_choice_key: str | None = None
        canonical_answer: str | None = None
        answer_key_page: int | None = None
        confidence: str = "unresolved"
        item_warnings: list[str] = []

        # Find answer in answer keys
        ak_hit = chapter_keys.get((chapter, raw_num))
        matched_key = None
        if ak_hit:
            canonical_choice_key, answer_key_page = ak_hit
            matched_key = (chapter, raw_num)
        else:
            # Try matching by normalized chapter or global matching by question number
            for (c_cand, q_cand), (ans_cand, p_cand) in chapter_keys.items():
                if q_cand == raw_num:
                    if c_cand and chapter and (c_cand.lower() in chapter.lower() or chapter.lower() in c_cand.lower()):
                        canonical_choice_key = ans_cand
                        answer_key_page = p_cand
                        matched_key = (c_cand, q_cand)
                        break
            if not matched_key:
                for (c_cand, q_cand), (ans_cand, p_cand) in chapter_keys.items():
                    if q_cand == raw_num:
                        canonical_choice_key = ans_cand
                        answer_key_page = p_cand
                        matched_key = (c_cand, q_cand)
                        break

        if matched_key:
            used_keys.add(matched_key)

        if q_type == "multiple_choice":
            num_choices = len(choices) if choices else 0
            if num_choices != 4:
                msg = f"{q_id} (Item {raw_num}) has {num_choices} choices (expected 4)"
                item_warnings.append(msg)
                warnings.append(msg)

            if canonical_choice_key and len(canonical_choice_key) == 1 and canonical_choice_key.upper() in ["A", "B", "C", "D"]:
                canonical_choice_key = canonical_choice_key.upper()
                matched_text = ""
                for c in choices or []:
                    if c["key"] == canonical_choice_key:
                        matched_text = c["text"]
                        break
                canonical_answer = matched_text or canonical_choice_key
                confidence = "verified"
            elif inline_answer:
                canonical_answer = inline_answer
                # Check if inline answer is a single choice letter
                if len(inline_answer) == 1 and inline_answer.upper() in ["A", "B", "C", "D"]:
                    canonical_choice_key = inline_answer.upper()
                confidence = "high"
            else:
                canonical_answer = None
                canonical_choice_key = None
                confidence = "unresolved"
                msg = f"{q_id} (Item {raw_num}): No answer key entry found"
                item_warnings.append(msg)
                warnings.append(msg)

        elif q_type == "identification":
            if canonical_choice_key:
                canonical_answer = canonical_choice_key
                canonical_choice_key = None
                confidence = "high"
            elif inline_answer:
                canonical_answer = inline_answer
                canonical_choice_key = None
                confidence = "high"
            else:
                canonical_answer = None
                canonical_choice_key = None
                confidence = "unresolved"
                msg = f"{q_id} (Item {raw_num}): Identification item has no answer"
                item_warnings.append(msg)
                warnings.append(msg)

        else:  # essay
            canonical_answer = inline_answer or (canonical_choice_key if canonical_choice_key else "Comprehensive discussion required.")
            canonical_choice_key = None
            confidence = "low"

        record: dict[str, Any] = {
            "question_id": q_id,
            "topic": topic,
            "question_type": q_type,
            "stem": stem,
            "choices": choices,
            "canonical_answer": canonical_answer,
            "canonical_choice_key": canonical_choice_key,
            "canonical_explanation": None,
            "source_page": page_num,
            "answer_key_page": answer_key_page,
            "difficulty": None,
            "link_confidence": confidence,
            "link_warnings": item_warnings,
            "content_version": content_version,
        }
        linked_records.append(record)

    # Check for orphan answer keys
    for (c_name, q_num), (k_val, k_page) in chapter_keys.items():
        if (c_name, q_num) not in used_keys:
            msg = f"Orphan answer key: Chapter '{c_name}' Item {q_num}={k_val} on page {k_page} has no question"
            warnings.append(msg)

    # Write output JSONL atomically
    out_file.parent.mkdir(parents=True, exist_ok=True)
    temp_out = out_file.parent / f"{out_file.name}.tmp.{uuid.uuid4().hex}"
    try:
        with temp_out.open("w", encoding="utf-8") as f:
            for rec in linked_records:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        if out_file.exists():
            out_file.unlink()
        temp_out.rename(out_file)
    except Exception:
        if temp_out.exists():
            try:
                temp_out.unlink()
            except Exception:
                pass
        raise

    ended_at = datetime.datetime.now(datetime.timezone.utc)

    # Save manifest
    input_files: dict[str, Path | str] = {}
    if pages_input_path and pages_input_path.exists():
        input_files["extracted_pages"] = pages_input_path

    manifest = create_stage_manifest(
        stage="link_qa_pairs",
        started_at=started_at,
        ended_at=ended_at,
        status="success",
        input_files=input_files,
        output_files={"linked_questions": out_file},
        config=cfg,
        record_count=len(linked_records),
        warnings=warnings,
    )
    save_stage_manifest(manifest, man_file)

    return linked_records


def main() -> int:
    parser = argparse.ArgumentParser(description="Link QA pairs from extracted pages.")
    parser.add_argument("--input", required=True, help="Path to extracted_pages.jsonl")
    parser.add_argument("--output", help="Path to linked_questions.jsonl")
    parser.add_argument("--manifest", help="Path to link_manifest.json")
    parser.add_argument("--config", help="Path to pipeline YAML config")
    args = parser.parse_args()

    cfg: dict[str, Any] = {}
    if args.config:
        import yaml

        with open(args.config, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}

    records = link_qa_pairs(
        extracted_pages=args.input,
        config=cfg,
        output_path=args.output,
        manifest_path=args.manifest,
    )
    print(f"Linked {len(records)} questions.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
