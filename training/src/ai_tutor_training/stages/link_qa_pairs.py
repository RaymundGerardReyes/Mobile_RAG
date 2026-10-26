"""Stage 2: Parse and link questions, choices, and answer keys."""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any

from ai_tutor_training.provenance import (
    create_stage_manifest,
    save_stage_manifest,
)


def validate_choice_count_warning(num_choices: int, q_id: str, raw_num: int) -> str | None:
    """Validate multiple choice option count.

    Civil Service Commission exams support standard 4-choice (General Subprofessional)
    and 5-choice (Professional / Verbal Ability) formats.
    Returns a warning string if num_choices is not in (4, 5), otherwise None.
    """
    if num_choices not in (4, 5):
        return f"{q_id} (Item {raw_num}) has {num_choices} choices (expected 4)"
    return None


def extract_inline_explanation_and_key(text: str) -> tuple[str, str | None]:
    """Extract explanation text and any embedded canonical choice key (A-E).

    Recognizes patterns such as:
      - 'Choice (a)' or 'Option (B)' or 'Titik (c)'
      - 'Choice A' or 'Option B'
      - '(a) is correct' or '(b) is the right answer'
      - 'Correct answer: B', 'Tamang sagot: C', 'Answer: D'
    """
    clean = text.strip()
    key: str | None = None

    # 1. Parenthesized or labeled choice: Choice (b), Option (c), Titik (a), Choice A, Option B
    m = re.search(r"(?:Choice|Option|Titik)\s*\(?([A-Ea-e])\)?(?:\s+is\b|\b)", clean, re.IGNORECASE)
    if m:
        key = m.group(1).upper()
    else:
        # 2. '(b) is correct' or '(b) is the right answer'
        m2 = re.search(r"\(([A-Ea-e])\)\s+is\s+(?:the\s+)?(?:correct|right|best)\b", clean, re.IGNORECASE)
        if m2:
            key = m2.group(1).upper()
        else:
            # 3. 'Answer: B' or 'Tamang sagot: C' or 'Correct answer is D'
            m3 = re.search(
                r"(?:(?:Correct\s+)?(?:Answer|Sagot)|Tamang\s+sagot)\s*[:\-]?\s*\(?([A-Ea-e])\)?\b",
                clean,
                re.IGNORECASE,
            )
            if m3:
                key = m3.group(1).upper()

    return clean, key


def parse_inline_explanation_block(line_str: str) -> dict[str, Any] | None:
    """Check if line starts an inline explanation block, and parse body & choice key.

    Returns:
        dict with keys:
          - 'body': str (the stripped text after the explanation prefix)
          - 'canonical_choice_key': str | None ('A'-'E' if detected)
        or None if line is not an explanation header.
    """
    exp_match = re.match(r"^(?:Explanation|Paliwanag|Rason)\s*[:\-]\s*(.*)$", line_str, re.IGNORECASE)
    if not exp_match:
        return None

    body = exp_match.group(1).strip()
    _, key = extract_inline_explanation_and_key(line_str)
    return {
        "body": body,
        "canonical_choice_key": key,
    }


def is_answer_key_item_line(line_str: str, item_patterns: list[str]) -> bool:
    """Check if a line represents answer key content rather than a question stem.

    Returns True for:
      - '1 - A', '1 - C', '1: A', '1. A', '1 A'
      - '1. A  2. B  3. C'
      - '4 - Republic Act 6713', '4: RA 6713' (identification answers with non-period delimiter)
    Returns False for:
      - '1. Which branch of the Philippine government...' (real question stem)
      - '1. A dog is a domestic animal...' (stem starting with A)
    """
    clean = line_str.strip()
    if not clean:
        return False

    # 1. Matches single letter answer key item standalone: e.g. '1. A', '1 - A', '1: A', '1 A', '1. A.'
    if re.match(r"^\s*\d{1,4}\s*[-–—.:]?\s*[A-Ea-e]\s*[.)]?\s*$", clean):
        return True

    # 2. Matches multiple answer key items on the same line: e.g. '1. A  2. B  3. C' or '1 - A  2 - B'
    for pat in item_patterns:
        matches = re.findall(pat, clean)
        if len(matches) >= 2:
            return True
        if len(matches) == 1 and not re.search(r"[a-zA-Z]{3,}", clean):
            return True

    # 3. Single-line identification answer key with non-period delimiter (e.g. '4 - Republic Act 6713')
    if re.match(r"^\s*\d{1,4}\s*[-–—:]\s*(.+)$", clean):
        return True

    return False


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
    in_answer_key = False

    effective_q_patterns = q_patterns or [
        r"^\s*(\d{1,4})[.)]\s+(.*)",
        r"^\s*Question\s+(\d{1,4})[.:]\s*(.*)",
        r"^\s*Tanong\s+(\d{1,4})[.:]\s*(.*)",
    ]

    chapter_header_re = re.compile(
        r"^(?:CHAPTER|Chapter|KABANATA|Kabanata|PART|Part|BAHAGI|Bahagi)\s+",
        re.IGNORECASE,
    )

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
            is_choice = any(re.match(c_pat, line_str) for c_pat in (c_patterns or []))
            is_question = any(re.match(q_pat, line_str) for q_pat in effective_q_patterns)

            # Check if this line signals an answer key section
            if not is_choice and not is_question:
                for h_pat in header_patterns:
                    if re.search(h_pat, line_str, re.IGNORECASE):
                        in_answer_key = True
                        break

            if in_answer_key:
                # 1. New chapter or part heading explicitly closes answer key section
                if chapter_header_re.match(line_str):
                    in_answer_key = False
                    continue

                # 2. Real question stem explicitly closes answer key section
                if is_question and not is_answer_key_item_line(line_str, item_patterns):
                    in_answer_key = False
                    continue

                # 3. Find all answers in the line
                found_in_line = False
                for i_pat in item_patterns:
                    matches = re.findall(i_pat, line_str)
                    if matches:
                        if not is_answer_key_item_line(line_str, item_patterns):
                            continue
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
                    text_ans_match = re.match(r"^\s*(\d{1,4})\s*[-–—:]\s*(.+)$", line_str)
                    if text_ans_match:
                        try:
                            q_num = int(text_ans_match.group(1))
                            ans_val = text_ans_match.group(2).strip()
                            if ans_val:
                                found_in_line = True
                                if len(ans_val) == 1 and ans_val.upper() in "ABCDE":
                                    ans_val = ans_val.upper()
                                chapter_keys[(chapter, q_num)] = (ans_val, page_num)
                                global_keys.append((q_num, ans_val, page_num))
                        except (ValueError, IndexError):
                            pass

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
    item_patterns: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Pass 2: Extract question stems and choices across pages."""
    raw_questions: list[dict[str, Any]] = []

    current_q: dict[str, Any] | None = None
    current_choice: dict[str, str] | None = None
    in_answer_key = False
    in_explanation = False

    chapter_header_re = re.compile(
        r"^(?:CHAPTER|Chapter|KABANATA|Kabanata|PART|Part|BAHAGI|Bahagi)\s+",
        re.IGNORECASE,
    )

    for page in pages:
        text = page.get("text", "")
        page_num = page.get("page_number", 1)
        chapter = page.get("chapter")

        lines = text.splitlines()

        for line in lines:
            line_str = line.strip()
            if not line_str:
                continue

            # Check if line is an explicit chapter/section heading or directions directive
            is_heading_or_directive = bool(
                chapter_header_re.match(line_str)
                or re.match(
                    r"^\s*(?:Directions|Panuto|\d+\.\s+(?:Context\s+Clues|Vocabulary)|(?:Context\s+Clues|Vocabulary)\s*-\s*(?:Synonyms|Antonyms))",
                    line_str,
                    re.IGNORECASE,
                )
            )
            if is_heading_or_directive:
                if current_q:
                    raw_questions.append(current_q)
                    current_q = None
                    current_choice = None
                    in_explanation = False
                continue

            # If line is a choice or question stem, it cannot be an answer key header
            is_choice = any(re.match(c_pat, line_str) for c_pat in c_patterns)
            is_question = any(re.match(q_pat, line_str) for q_pat in q_patterns)

            # Check for inline explanation block (e.g. "Explanation: Choice (b) ... is correct")
            exp_info = parse_inline_explanation_block(line_str)
            if exp_info is not None:
                if current_q:
                    current_choice = None
                    in_explanation = True
                    if exp_info["body"]:
                        current_q["explanation_lines"].append(exp_info["body"])
                    if exp_info["canonical_choice_key"]:
                        current_q["inline_canonical_choice_key"] = exp_info["canonical_choice_key"]
                continue

            if in_explanation and current_q:
                # If a new question starts, exit explanation mode
                if is_question:
                    in_explanation = False
                    # Fall through to question stem parsing below
                else:
                    # Accumulate explanation continuation lines
                    current_q["explanation_lines"].append(line_str)
                    if not current_q.get("inline_canonical_choice_key"):
                        _, cont_key = extract_inline_explanation_and_key(line_str)
                        if cont_key:
                            current_q["inline_canonical_choice_key"] = cont_key
                    continue

            # Check if answer key starts — questions stop here
            is_ak_header = (not is_choice and not is_question) and any(
                re.search(h_pat, line_str, re.IGNORECASE) for h_pat in header_patterns
                if not re.search(r"explanation\s*:", h_pat, re.IGNORECASE)
            )
            if is_ak_header:
                in_answer_key = True
                if current_q:
                    raw_questions.append(current_q)
                    current_q = None
                    current_choice = None
                    in_explanation = False
                continue

            # If inside answer key, check if a new chapter or question restarts normal text
            if in_answer_key:
                if chapter_header_re.match(line_str):
                    in_answer_key = False
                    continue
                # If this line is an answer key item line, stay in answer key
                if item_patterns and is_answer_key_item_line(line_str, item_patterns):
                    continue
                # If it's a real question stem, exit answer key and parse question
                if is_question:
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
                        "inline_canonical_choice_key": None,
                        "explanation_lines": [],
                    }
                    current_choice = None
                    in_explanation = False
                    matched_q = True
                    break

            if matched_q:
                continue

            # Check for choices (A., B., C., D., E.) if inside a question
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
        pages, q_patterns, c_patterns, ak_header_patterns, ak_item_patterns
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
        is_ambiguous = False
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
            # Global fallback across all chapters is attempted if no inline answer is provided
            if not matched_key and not inline_answer:
                candidates = [
                    ((c_cand, q_cand), (ans_cand, p_cand))
                    for (c_cand, q_cand), (ans_cand, p_cand) in chapter_keys.items()
                    if q_cand == raw_num
                ]
                if len(candidates) == 1:
                    matched_key, (canonical_choice_key, answer_key_page) = candidates[0]
                elif len(candidates) > 1:
                    is_ambiguous = True
                    candidate_chapters = [c[0][0] for c in candidates]
                    msg = (
                        f"{q_id} (Item {raw_num}): Ambiguous answer key match across multiple chapters: "
                        f"{candidate_chapters}. Downgrading confidence to unresolved."
                    )
                    item_warnings.append(msg)
                    warnings.append(msg)
                    canonical_choice_key = None
                    answer_key_page = None

        if matched_key:
            used_keys.add(matched_key)

        inline_canonical_choice_key = rq.get("inline_canonical_choice_key")
        raw_explanation_lines = rq.get("explanation_lines", [])
        canonical_explanation = " ".join(raw_explanation_lines).strip() or None

        if q_type == "multiple_choice":
            num_choices = len(choices) if choices else 0
            choice_warning = validate_choice_count_warning(num_choices, q_id, raw_num)
            if choice_warning:
                item_warnings.append(choice_warning)
                warnings.append(choice_warning)

            if inline_canonical_choice_key:
                canonical_choice_key = inline_canonical_choice_key
                matched_text = ""
                for c in choices or []:
                    if c["key"] == canonical_choice_key:
                        matched_text = c["text"]
                        break
                canonical_answer = matched_text or canonical_choice_key
                confidence = "verified"
                answer_key_page = page_num
            elif canonical_choice_key and len(canonical_choice_key) == 1 and canonical_choice_key.upper() in ["A", "B", "C", "D", "E"]:
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
                if len(inline_answer) == 1 and inline_answer.upper() in ["A", "B", "C", "D", "E"]:
                    canonical_choice_key = inline_answer.upper()
                confidence = "high"
            else:
                canonical_answer = None
                canonical_choice_key = None
                confidence = "unresolved"
                if not is_ambiguous:
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
                if not is_ambiguous:
                    msg = f"{q_id} (Item {raw_num}): Identification item has no answer"
                    item_warnings.append(msg)
                    warnings.append(msg)

        else:  # essay
            canonical_answer = inline_answer or (canonical_choice_key if canonical_choice_key else "Comprehensive discussion required.")
            canonical_choice_key = None
            confidence = "unresolved" if is_ambiguous else "low"

        record: dict[str, Any] = {
            "question_id": q_id,
            "topic": topic,
            "question_type": q_type,
            "stem": stem,
            "choices": choices,
            "canonical_answer": canonical_answer,
            "canonical_choice_key": canonical_choice_key,
            "canonical_explanation": canonical_explanation,
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
