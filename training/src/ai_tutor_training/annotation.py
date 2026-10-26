"""Multi-Subject Data Annotation & SFT Training Dataset Generator.

Provides the `DatasetAnnotator` class to:
1. Programmatically curate multi-subject questions (Multiple Choice, Identification, Essay)
   and reference passages across Philippine Civil Service Exam domains.
2. Validate every record against `contracts/linked-question.schema.json` and `contracts/passage.schema.json`.
3. Compile annotated records into SQLite `content_pack.db` with external-content FTS5 BM25 index.
4. Export Grounded RAG Supervised Fine-Tuning (SFT) datasets in standard ChatML format
   for Stage 5 Qwen3 LoRA fine-tuning.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import tempfile
from pathlib import Path
from typing import Any

from ai_tutor_training.content_pack import build_content_pack
from ai_tutor_training.contracts import (
    load_schema,
    validate_jsonl_against_schema,
    validate_record_against_schema,
)
from ai_tutor_training.prompting import (
    EXPLAIN_SYSTEM_PROMPT,
    FREE_ANSWER_SYSTEM_PROMPT,
    build_explain_prompt,
    build_free_answer_prompt,
    sanitize_data_content,
)


class DatasetAnnotator:
    """Helper class to annotate passages and multi-subject questions with strict contract validation."""

    def __init__(self, contracts_dir: Path | str, content_version: str = "2026.10.1") -> None:
        self.contracts_dir = Path(contracts_dir)
        self.content_version = content_version

        # Load official JSON schemas from contracts/ directory
        self.passage_schema = load_schema(self.contracts_dir / "passage.schema.json")
        self.question_schema = load_schema(self.contracts_dir / "linked-question.schema.json")
        self.verdict_schema = load_schema(self.contracts_dir / "free-answer-verdict.schema.json")

        self.passages: list[dict[str, Any]] = []
        self.questions: list[dict[str, Any]] = []

    def add_passage(
        self,
        chapter: str,
        section: str | None,
        start_page: int,
        end_page: int,
        text: str,
    ) -> dict[str, Any]:
        """Annotate a textbook reading passage and verify against passage.schema.json."""
        clean_text = text.strip()
        passage_id = f"p{len(self.passages) + 1:04d}"
        content_hash = hashlib.sha256(clean_text.encode("utf-8")).hexdigest()

        record = {
            "passage_id": passage_id,
            "chapter": chapter.strip(),
            "section": section.strip() if section else None,
            "start_page": start_page,
            "end_page": end_page,
            "text": clean_text,
            "content_hash": content_hash,
            "word_count": len(clean_text.split()),
        }

        errors = validate_record_against_schema(record, self.passage_schema)
        if errors:
            raise ValueError(f"Passage {passage_id} failed contract validation: {errors}")

        self.passages.append(record)
        return record

    def add_question(
        self,
        topic: str,
        question_type: str,
        stem: str,
        canonical_answer: str,
        source_page: int,
        choices: list[dict[str, str]] | None = None,
        canonical_choice_key: str | None = None,
        canonical_explanation: str | None = None,
        answer_key_page: int | None = None,
        difficulty: str = "medium",
        link_confidence: str = "verified",
        link_warnings: list[str] | None = None,
    ) -> dict[str, Any]:
        """Annotate a question across any subject and answer type, validating against linked-question.schema.json."""
        question_id = f"q{len(self.questions) + 1:04d}"

        # Clean choices if present
        clean_choices: list[dict[str, str]] | None = None
        if choices is not None:
            clean_choices = [
                {"key": c["key"].strip().upper(), "text": c["text"].strip()}
                for c in choices
            ]

        record = {
            "question_id": question_id,
            "topic": topic.strip(),
            "question_type": question_type.strip(),
            "stem": stem.strip(),
            "choices": clean_choices,
            "canonical_answer": canonical_answer.strip(),
            "canonical_choice_key": canonical_choice_key.strip().upper() if canonical_choice_key else None,
            "canonical_explanation": canonical_explanation.strip() if canonical_explanation else None,
            "source_page": source_page,
            "answer_key_page": answer_key_page,
            "difficulty": difficulty.strip(),
            "link_confidence": link_confidence.strip(),
            "link_warnings": link_warnings or [],
            "content_version": self.content_version,
        }

        errors = validate_record_against_schema(record, self.question_schema)
        if errors:
            raise ValueError(f"Question {question_id} failed contract validation: {errors}")

        self.questions.append(record)
        return record

    def load_from_jsonl(self, questions_path: Path | str, passages_path: Path | str) -> tuple[int, int]:
        """Load and validate existing questions and passages from JSONL files."""
        q_file = Path(questions_path)
        p_file = Path(passages_path)

        self.passages = []
        with p_file.open("r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rec = json.loads(line)
                    errors = validate_record_against_schema(rec, self.passage_schema)
                    if errors:
                        raise ValueError(f"Passage {rec.get('passage_id')} failed contract validation: {errors}")
                    self.passages.append(rec)

        self.questions = []
        with q_file.open("r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rec = json.loads(line)
                    errors = validate_record_against_schema(rec, self.question_schema)
                    if errors:
                        raise ValueError(f"Question {rec.get('question_id')} failed contract validation: {errors}")
                    self.questions.append(rec)

        return len(self.questions), len(self.passages)

    def export_artifacts(self, output_dir: Path | str) -> tuple[Path, Path]:
        """Write validated passages.jsonl and linked_questions.jsonl atomically to disk."""
        target_dir = Path(output_dir)
        target_dir.mkdir(parents=True, exist_ok=True)

        passages_path = target_dir / "passages.jsonl"
        questions_path = target_dir / "linked_questions.jsonl"

        # Atomic write passages
        with tempfile.NamedTemporaryFile("w", dir=target_dir, delete=False, encoding="utf-8") as tf:
            temp_p = Path(tf.name)
            for p in self.passages:
                tf.write(json.dumps(p, ensure_ascii=False) + "\n")
        os.replace(temp_p, passages_path)

        # Atomic write questions
        with tempfile.NamedTemporaryFile("w", dir=target_dir, delete=False, encoding="utf-8") as tf:
            temp_q = Path(tf.name)
            for q in self.questions:
                tf.write(json.dumps(q, ensure_ascii=False) + "\n")
        os.replace(temp_q, questions_path)

        # Validate full JSONL files against schemas
        p_report = validate_jsonl_against_schema(passages_path, self.contracts_dir / "passage.schema.json")
        q_report = validate_jsonl_against_schema(questions_path, self.contracts_dir / "linked-question.schema.json")

        if not p_report.is_valid:
            raise RuntimeError(f"Passages schema validation failed: {p_report.errors}")
        if not q_report.is_valid:
            raise RuntimeError(f"Questions schema validation failed: {q_report.errors}")

        return questions_path, passages_path

    def compile_content_pack(
        self,
        output_db_path: Path | str,
        questions_path: Path | str | None = None,
        passages_path: Path | str | None = None,
    ) -> Path:
        """Compile the annotated artifacts into an SQLite Content Pack with FTS5 BM25 search."""
        db_path = Path(output_db_path)
        db_path.parent.mkdir(parents=True, exist_ok=True)

        q_path = Path(questions_path) if questions_path else None
        p_path = Path(passages_path) if passages_path else None

        if not q_path or not p_path:
            q_path, p_path = self.export_artifacts(db_path.parent)

        return build_content_pack(
            linked_questions_path=q_path,
            passages_path=p_path,
            output_db_path=db_path,
            version=self.content_version,
        )

    def export_sft_chatml_jsonl(self, output_sft_path: Path | str) -> Path:
        """Generate a Grounded RAG SFT dataset in ChatML format for Stage 5 Qwen3 LoRA fine-tuning.

        Each record conforms to:
        {
          "task_type": "explain_more" | "interpret_free_answer",
          "question_id": "...",
          "topic": "...",
          "messages": [
            {"role": "system", "content": "..."},
            {"role": "user", "content": "..."},
            {"role": "assistant", "content": "..."}
          ]
        }
        """
        sft_path = Path(output_sft_path)
        sft_path.parent.mkdir(parents=True, exist_ok=True)

        sft_records: list[dict[str, Any]] = []

        for q in self.questions:
            # Match passages on the same page
            matching_passages = [
                p for p in self.passages
                if p["start_page"] <= q["source_page"] <= p["end_page"]
            ]
            primary_passage = matching_passages[0] if matching_passages else None

            # 1. Feature A: ExplainMore SFT Example
            if primary_passage and q.get("canonical_explanation"):
                clean_stem = sanitize_data_content(q["stem"])
                clean_answer = sanitize_data_content(q["canonical_answer"])
                clean_passage = sanitize_data_content(primary_passage["text"])
                clean_note = sanitize_data_content(q.get("canonical_explanation") or "")

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
                    f"Official Note: {clean_note}\n\n"
                    f"Explain why this answer is correct based on the excerpt:\n"
                    f"</task>"
                )

                assistant_content = (
                    f"{q['canonical_explanation']} "
                    f"(Source: {primary_passage['chapter']}, [Page {q['source_page']}])"
                )

                sft_records.append({
                    "task_type": "explain_more",
                    "question_id": q["question_id"],
                    "topic": q["topic"],
                    "messages": [
                        {"role": "system", "content": EXPLAIN_SYSTEM_PROMPT},
                        {"role": "user", "content": user_content},
                        {"role": "assistant", "content": assistant_content},
                    ],
                })

            # 2. Feature B: InterpretFreeAnswer SFT Example for Identification / Essay
            if q["question_type"] in ("identification", "essay") and matching_passages:
                eval_prompt_full = build_free_answer_prompt(
                    stem=q["stem"],
                    canonical_answer=q["canonical_answer"],
                    user_answer=q["canonical_answer"],  # Positive gold equivalent submission
                    passages=matching_passages[:2],
                )

                # Extract system vs user content from generated prompt
                system_tag = "<system>"
                end_system_tag = "</system>"
                system_start = eval_prompt_full.find(system_tag)
                system_end = eval_prompt_full.find(end_system_tag)

                if system_start != -1 and system_end != -1:
                    system_text = eval_prompt_full[system_start + len(system_tag):system_end].strip()
                    user_text = eval_prompt_full[system_end + len(end_system_tag):].strip()
                else:
                    system_text = FREE_ANSWER_SYSTEM_PROMPT
                    user_text = eval_prompt_full

                verdict_payload = {
                    "verdict": "equivalent",
                    "matched_concepts": [q["topic"], q["canonical_answer"][:40]],
                    "missing_concepts": [],
                    "evidence_passage_ids": [p["passage_id"] for p in matching_passages[:2]],
                    "confidence": 0.95,
                }

                # Validate verdict against schema
                v_errors = validate_record_against_schema(verdict_payload, self.verdict_schema)
                if v_errors:
                    raise ValueError(f"Generated verdict violated schema: {v_errors}")

                sft_records.append({
                    "task_type": "interpret_free_answer",
                    "question_id": q["question_id"],
                    "topic": q["topic"],
                    "messages": [
                        {"role": "system", "content": system_text},
                        {"role": "user", "content": user_text},
                        {"role": "assistant", "content": json.dumps(verdict_payload, ensure_ascii=False)},
                    ],
                })

        with tempfile.NamedTemporaryFile("w", dir=sft_path.parent, delete=False, encoding="utf-8") as tf:
            temp_sft = Path(tf.name)
            for rec in sft_records:
                tf.write(json.dumps(rec, ensure_ascii=False) + "\n")
        os.replace(temp_sft, sft_path)

        return sft_path

    def export_iterative_sft_chatml_jsonl(self, db_path: Path | str, output_sft_path: Path | str) -> Path:
        """Export Grounded RAG ChatML dataset using 3-tier Iterative RAG retrieval against content_pack.db."""
        return build_iterative_sft_chatml_dataset(
            db_path=db_path,
            output_chatml_path=output_sft_path,
            content_version=self.content_version,
            verdict_schema_path=self.contracts_dir / "free-answer-verdict.schema.json",
        )


def build_iterative_sft_chatml_dataset(
    db_path: Path | str,
    output_chatml_path: Path | str,
    content_version: str = "2026.10.1",
    verdict_schema_path: Path | str | None = None,
) -> Path:
    """Build Grounded RAG ChatML dataset by running 3-tier iterative FTS5 retrieval on content_pack.db.

    Connects questions in `content_pack.db` with supporting textbook evidence retrieved via:
      - Tier 1: Direct question_passages link
      - Tier 2: Strict FTS5 BM25 search (AND terms)
      - Tier 3: Broad FTS5 BM25 search (OR terms & distractor-aware)

    Generates ChatML records for:
      - Feature A: `explain_more` with exact page citations and textbook excerpts
      - Feature B: `interpret_free_answer` with gold equivalent verdict schema validation
    """
    db_p = Path(db_path)
    if not db_p.exists():
        raise FileNotFoundError(f"Content pack database not found: {db_p}")

    out_p = Path(output_chatml_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)

    from ai_tutor_training.iterative_justifier import IterativeRAGJustifier

    justifier = IterativeRAGJustifier(db_path=db_p, max_evidence_passages=2)

    v_schema: dict[str, Any] | None = None
    if verdict_schema_path and Path(verdict_schema_path).exists():
        v_schema = load_schema(verdict_schema_path)
    else:
        # Auto-locate contracts/free-answer-verdict.schema.json
        candidate_paths = [
            Path(__file__).parent.parent.parent / "contracts" / "free-answer-verdict.schema.json",
            Path("contracts/free-answer-verdict.schema.json"),
            Path("training/contracts/free-answer-verdict.schema.json"),
        ]
        for cp in candidate_paths:
            if cp.exists():
                v_schema = load_schema(cp)
                break

    conn = sqlite3.connect(str(db_p))
    try:
        cursor = conn.cursor()
        q_rows = cursor.execute(
            """
            SELECT q.id, q.topic_id, q.question_type, q.stem, q.canonical_explanation, q.source_page,
                   qa.canonical_answer, c.choice_key
            FROM questions q
            LEFT JOIN question_answers qa ON qa.question_id = q.id
            LEFT JOIN choices c ON c.id = qa.canonical_choice_id
            ORDER BY q.id ASC;
            """
        ).fetchall()

        sft_records: list[dict[str, Any]] = []

        for row in q_rows:
            q_id = row[0]
            topic_id = row[1] or "general"
            q_type = row[2]
            stem = row[3]
            explanation = row[4]
            source_page = row[5]
            canonical_answer = row[6] or ""
            canonical_choice_key = row[7]

            choices_rows = cursor.execute(
                "SELECT choice_key, text FROM choices WHERE question_id = ? ORDER BY sort_order ASC;",
                (q_id,),
            ).fetchall()
            choices = [{"key": cr[0], "text": cr[1]} for cr in choices_rows]

            # Run 3-tier iterative retrieval
            q_data, evidence_list, _ = justifier.retrieve_evidence_iteratively(q_id)

            if not evidence_list:
                continue

            primary_ev = evidence_list[0]

            # 1. Feature A: ExplainMore SFT Example
            if explanation:
                clean_stem = sanitize_data_content(stem)
                clean_answer = sanitize_data_content(canonical_answer)
                clean_note = sanitize_data_content(explanation)

                context_blocks = []
                for ev in evidence_list[:2]:
                    clean_ev_text = sanitize_data_content(ev.text)
                    context_blocks.append(f"[EXCERPT (Page {ev.start_page})]:\n{clean_ev_text}")
                context_str = "\n\n".join(context_blocks)

                choices_block = ""
                if choices:
                    choices_block = "\n".join(
                        f"  {c['key']}. {sanitize_data_content(c['text'])}" for c in choices
                    ) + "\n"

                user_content = (
                    f"<context>\n"
                    f"{context_str}\n"
                    f"</context>\n\n"
                    f"<task>\n"
                    f"Question: {clean_stem}\n"
                    f"{choices_block}"
                    f"Official Answer: {clean_answer}\n"
                    f"Official Note: {clean_note}\n\n"
                    f"Explain why this answer is correct based on the excerpt:\n"
                    f"</task>"
                )

                assistant_content = (
                    f"{explanation} "
                    f"(Source: {primary_ev.chapter}, [Page {primary_ev.start_page}])"
                )

                sft_records.append({
                    "task_type": "explain_more",
                    "question_id": q_id,
                    "topic": topic_id,
                    "retrieval_tier": primary_ev.retrieval_tier,
                    "messages": [
                        {"role": "system", "content": EXPLAIN_SYSTEM_PROMPT},
                        {"role": "user", "content": user_content},
                        {"role": "assistant", "content": assistant_content},
                    ],
                })

            # 2. Feature B: InterpretFreeAnswer SFT Example for Identification / Essay
            if q_type in ("identification", "essay"):
                passages_dicts = [
                    {
                        "passage_id": ev.passage_id,
                        "chapter": ev.chapter,
                        "start_page": ev.start_page,
                        "end_page": ev.end_page,
                        "text": ev.text,
                    }
                    for ev in evidence_list[:2]
                ]

                eval_prompt_full = build_free_answer_prompt(
                    stem=stem,
                    canonical_answer=canonical_answer,
                    user_answer=canonical_answer,
                    passages=passages_dicts,
                )

                system_tag = "<system>"
                end_system_tag = "</system>"
                s_start = eval_prompt_full.find(system_tag)
                s_end = eval_prompt_full.find(end_system_tag)
                if s_start != -1 and s_end != -1:
                    system_text = eval_prompt_full[s_start + len(system_tag):s_end].strip()
                    user_text = eval_prompt_full[s_end + len(end_system_tag):].strip()
                else:
                    system_text = FREE_ANSWER_SYSTEM_PROMPT
                    user_text = eval_prompt_full

                verdict_payload = {
                    "verdict": "equivalent",
                    "matched_concepts": [topic_id, canonical_answer[:40]],
                    "missing_concepts": [],
                    "evidence_passage_ids": [ev.passage_id for ev in evidence_list[:2]],
                    "confidence": 0.95,
                }

                if v_schema is not None:
                    v_errors = validate_record_against_schema(verdict_payload, v_schema)
                    if v_errors:
                        raise ValueError(f"Generated verdict violated schema: {v_errors}")

                sft_records.append({
                    "task_type": "interpret_free_answer",
                    "question_id": q_id,
                    "topic": topic_id,
                    "retrieval_tier": primary_ev.retrieval_tier,
                    "messages": [
                        {"role": "system", "content": system_text},
                        {"role": "user", "content": user_text},
                        {"role": "assistant", "content": json.dumps(verdict_payload, ensure_ascii=False)},
                    ],
                })
    finally:
        conn.close()

    with tempfile.NamedTemporaryFile("w", dir=out_p.parent, delete=False, encoding="utf-8") as tf:
        temp_sft = Path(tf.name)
        for rec in sft_records:
            tf.write(json.dumps(rec, ensure_ascii=False) + "\n")
    os.replace(temp_sft, out_p)

    return out_p

