"""Generate Grounded RAG SFT dataset (ChatML format) from the English Civil Service Reviewer."""

import json
from pathlib import Path
from typing import Any

from ai_tutor_training.prompting import (
    EXPLAIN_SYSTEM_PROMPT,
    sanitize_data_content,
)

def build_reviewer_chatml_dataset(
    linked_questions_path: Path | str,
    passages_path: Path | str,
    output_sft_path: Path | str,
) -> list[dict[str, Any]]:
    """Build ChatML SFT dataset from linked questions and passages."""
    lq_file = Path(linked_questions_path)
    p_file = Path(passages_path)
    out_file = Path(output_sft_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)

    questions = []
    with lq_file.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                questions.append(json.loads(line))

    passages = []
    with p_file.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                passages.append(json.loads(line))

    sft_records: list[dict[str, Any]] = []

    for q in questions:
        # Match passages on the same source page
        matching_passages = [
            p for p in passages
            if p["start_page"] <= q["source_page"] <= p["end_page"]
        ]
        # Fallback to closest passage in same topic/chapter
        if not matching_passages:
            matching_passages = [
                p for p in passages
                if p["chapter"] == q["topic"]
            ]

        primary_passage = matching_passages[0] if matching_passages else passages[0]

        clean_stem = sanitize_data_content(q["stem"])
        clean_answer = sanitize_data_content(q.get("canonical_answer") or "")
        clean_passage = sanitize_data_content(primary_passage["text"])
        clean_explanation = sanitize_data_content(q.get("canonical_explanation") or "")

        choices_block = ""
        if q.get("choices"):
            choices_block = "\n".join(
                f"  {c['key']}. {sanitize_data_content(c['text'])}" for c in q["choices"]
            ) + "\n"

        user_content = (
            f"<context>\n"
            f"[EXCERPT (Page {q['source_page']})]:\n"
            f"{clean_passage}\n"
            f"</context>\n\n"
            f"<task>\n"
            f"Question: {clean_stem}\n"
            f"{choices_block}"
            f"Official Answer: {clean_answer}\n"
            f"Official Note: {clean_explanation}\n\n"
            f"Explain why this answer is correct based on the excerpt:\n"
            f"</task>"
        )

        assistant_content = (
            f"{q['canonical_explanation']} "
            f"(Source: {primary_passage['chapter']}, [Page {q['source_page']}])"
        )

        record = {
            "task_type": "explain_more",
            "question_id": q["question_id"],
            "topic": q["topic"],
            "messages": [
                {"role": "system", "content": EXPLAIN_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
                {"role": "assistant", "content": assistant_content},
            ],
        }
        sft_records.append(record)

    with out_file.open("w", encoding="utf-8") as f:
        for r in sft_records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    return sft_records

if __name__ == "__main__":
    lq = Path("training/artifacts/reviewer_run/linked_questions.jsonl")
    p = Path("training/artifacts/reviewer_run/passages.jsonl")
    out = Path("training/artifacts/reviewer_run/reviewer_sft_chatml.jsonl")
    records = build_reviewer_chatml_dataset(lq, p, out)
    print(f"Exported {len(records)} Grounded RAG ChatML training records to {out}")
    print("\nSample SFT Example 1:")
    print(json.dumps(records[0], indent=2))

