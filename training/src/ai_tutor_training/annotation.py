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

