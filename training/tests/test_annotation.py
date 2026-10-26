"""Tests for DatasetAnnotator and ChatML SFT dataset export."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from ai_tutor_training.annotation import DatasetAnnotator, build_iterative_sft_chatml_dataset
from ai_tutor_training.contracts import load_schema, validate_record_against_schema


@pytest.fixture
def contracts_dir() -> Path:
    repo_root = Path(__file__).resolve().parent.parent.parent
    return repo_root / "contracts"


class TestDatasetAnnotator:
    """Unit and integration tests for DatasetAnnotator."""

    def test_add_passage_valid_and_schema_conformance(self, contracts_dir: Path) -> None:
        annotator = DatasetAnnotator(contracts_dir=contracts_dir)
        rec = annotator.add_passage(
            chapter="General Information",
            section="1987 Constitution",
            start_page=1,
            end_page=1,
            text="The Philippines is a democratic and republican State. Sovereignty resides in the people.",
        )

        assert rec["passage_id"] == "p0001"
        assert rec["chapter"] == "General Information"
        assert rec["word_count"] > 5
        assert len(rec["content_hash"]) == 64
        assert len(annotator.passages) == 1

    def test_add_passage_invalid_schema_raises_value_error(self, contracts_dir: Path) -> None:
        annotator = DatasetAnnotator(contracts_dir=contracts_dir)
        with pytest.raises(ValueError, match="failed contract validation"):
            # start_page must be an integer >= 1
            annotator.add_passage(
                chapter="General Info",
                section=None,
                start_page=-5,
                end_page=1,
                text="Invalid page passage.",
            )

    def test_add_question_multiple_choice_and_free_answer(self, contracts_dir: Path) -> None:
        annotator = DatasetAnnotator(contracts_dir=contracts_dir)

        # 1. Multiple Choice
        q_mc = annotator.add_question(
            topic="General Information",
            question_type="multiple_choice",
            stem="What is the prime duty of the Government?",
            choices=[
                {"key": "a", "text": "Collect taxes"},
                {"key": "b", "text": "Serve and protect the people"},
                {"key": "c", "text": "Build infrastructure"},
                {"key": "d", "text": "Regulate trade"},
            ],
            canonical_answer="Serve and protect the people",
            canonical_choice_key="B",
            canonical_explanation="Article II, Section 4 declares this.",
            source_page=1,
        )
        assert q_mc["question_id"] == "q0001"
        assert q_mc["canonical_choice_key"] == "B"
        assert q_mc["choices"][1]["key"] == "B"

        # 2. Identification (Free Answer)
        q_id = annotator.add_question(
            topic="Ethics",
            question_type="identification",
            stem="Name the Republic Act on Code of Conduct for Public Officials.",
            choices=None,
            canonical_answer="R.A. 6713",
            source_page=2,
        )
        assert q_id["question_id"] == "q0002"
        assert q_id["choices"] is None

        # 3. Essay (Free Answer)
        q_es = annotator.add_question(
            topic="Ethics",
            question_type="essay",
            stem="Explain the concept of public office as a public trust.",
            choices=None,
            canonical_answer="Public office requires continuous accountability and integrity.",
            source_page=2,
        )
        assert q_es["question_id"] == "q0003"
        assert len(annotator.questions) == 3

    def test_add_question_invalid_schema_raises_value_error(self, contracts_dir: Path) -> None:
        annotator = DatasetAnnotator(contracts_dir=contracts_dir)
        with pytest.raises(ValueError, match="failed contract validation"):
            # Invalid difficulty
            annotator.add_question(
                topic="Math",
                question_type="multiple_choice",
                stem="What is 2+2?",
                choices=[{"key": "A", "text": "4"}],
                canonical_answer="4",
                source_page=1,
                difficulty="impossible_difficulty",
            )

    def test_export_artifacts_atomic_and_valid(self, contracts_dir: Path, tmp_path: Path) -> None:
        annotator = DatasetAnnotator(contracts_dir=contracts_dir)
        annotator.add_passage(
            chapter="Verbal Ability",
            section="Grammar",
            start_page=10,
            end_page=10,
            text="Subject-verb agreement requires singular subjects to take singular verbs.",
        )
        annotator.add_question(
            topic="Verbal Ability",
            question_type="multiple_choice",
            stem="Neither the teacher nor the students ____ present.",
            choices=[
                {"key": "A", "text": "is"},
                {"key": "B", "text": "are"},
                {"key": "C", "text": "was"},
                {"key": "D", "text": "be"},
            ],
            canonical_answer="are",
            canonical_choice_key="B",
            source_page=10,
        )

        q_file, p_file = annotator.export_artifacts(tmp_path)
        assert q_file.exists()
        assert p_file.exists()

        with q_file.open("r", encoding="utf-8") as f:
            lines = [json.loads(line) for line in f]
            assert len(lines) == 1
            assert lines[0]["question_id"] == "q0001"

    def test_compile_content_pack_and_fts5_indexing(self, contracts_dir: Path, tmp_path: Path) -> None:
        annotator = DatasetAnnotator(contracts_dir=contracts_dir)
        annotator.add_passage(
            chapter="Filipino",
            section="Balarila",
            start_page=20,
            end_page=20,
            text="Paggamit ng ng at nang sa pangungusap.",
        )
        annotator.add_question(
            topic="Filipino",
            question_type="identification",
            stem="Aling salita ang ginagamit bilang pantukoy sa layon?",
            canonical_answer="ng",
            source_page=20,
        )

        db_file = tmp_path / "compiled_pack.db"
        res_path = annotator.compile_content_pack(db_file)
        assert res_path.exists()

        conn = sqlite3.connect(str(res_path))
        cursor = conn.cursor()

        # Check tables and FTS5 table
        tables = [r[0] for r in cursor.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()]
        assert "questions" in tables
        assert "passages" in tables
        assert "passages_fts" in tables

        # Search FTS5
        fts_rows = cursor.execute("SELECT * FROM passages_fts WHERE passages_fts MATCH 'pangungusap';").fetchall()
        assert len(fts_rows) == 1
        conn.close()

    def test_export_sft_chatml_jsonl(self, contracts_dir: Path, tmp_path: Path) -> None:
        annotator = DatasetAnnotator(contracts_dir=contracts_dir)
        annotator.add_passage(
            chapter="Ethics",
            section="R.A. 6713",
            start_page=5,
            end_page=5,
            text="Republic Act 6713 mandates high ethical standards for civil servants.",
        )
        annotator.add_question(
            topic="Ethics",
            question_type="multiple_choice",
            stem="Which law sets ethical standards for civil servants?",
            choices=[
                {"key": "A", "text": "R.A. 6713"},
                {"key": "B", "text": "R.A. 9184"},
                {"key": "C", "text": "R.A. 7160"},
                {"key": "D", "text": "R.A. 3019"},
            ],
            canonical_answer="R.A. 6713",
            canonical_choice_key="A",
            canonical_explanation="R.A. 6713 is the Code of Conduct and Ethical Standards.",
            source_page=5,
        )
        annotator.add_question(
            topic="Ethics",
            question_type="identification",
            stem="Name the Republic Act on Ethical Standards.",
            canonical_answer="Republic Act 6713",
            source_page=5,
        )

        sft_file = tmp_path / "sft_data.jsonl"
        out_path = annotator.export_sft_chatml_jsonl(sft_file)
        assert out_path.exists()

        verdict_schema = load_schema(contracts_dir / "free-answer-verdict.schema.json")

        with out_path.open("r", encoding="utf-8") as f:
            records = [json.loads(line) for line in f]

        assert len(records) == 2

        # 1. ExplainMore record in ChatML format
        rec_em = records[0]
        assert rec_em["task_type"] == "explain_more"
        assert "messages" in rec_em
        messages_em = rec_em["messages"]
        assert len(messages_em) == 3
        assert messages_em[0]["role"] == "system"
        assert messages_em[1]["role"] == "user"
        assert messages_em[2]["role"] == "assistant"
        assert "[Page 5]" in messages_em[2]["content"]

        # 2. InterpretFreeAnswer record in ChatML format
        rec_fa = records[1]
        assert rec_fa["task_type"] == "interpret_free_answer"
        messages_fa = rec_fa["messages"]
        assert len(messages_fa) == 3
        assert messages_fa[0]["role"] == "system"
        assert messages_fa[1]["role"] == "user"
        assert messages_fa[2]["role"] == "assistant"

        # Check assistant payload is valid JSON adhering to verdict schema
        verdict_data = json.loads(messages_fa[2]["content"])
        errors = validate_record_against_schema(verdict_data, verdict_schema)
        assert errors == []
        assert verdict_data["verdict"] == "equivalent"
        assert verdict_data["confidence"] >= 0.9

    def test_export_iterative_sft_chatml_jsonl(self, contracts_dir: Path, tmp_path: Path) -> None:
        """Verify 3-tier iterative RAG SFT export pairs questions with content_pack.db passages."""
        annotator = DatasetAnnotator(contracts_dir=contracts_dir)
        annotator.add_passage(
            chapter="Ethics",
            section="Standards",
            start_page=5,
            end_page=5,
            text="Republic Act 6713 is the Code of Conduct and Ethical Standards for Public Officials and Employees.",
        )
        annotator.add_question(
            topic="Ethics",
            question_type="multiple_choice",
            stem="What law governs ethical standards?",
            choices=[{"key": "A", "text": "R.A. 6713"}, {"key": "B", "text": "R.A. 3019"}],
            canonical_answer="R.A. 6713",
            canonical_choice_key="A",
            canonical_explanation="R.A. 6713 is the Code of Conduct.",
            source_page=5,
        )
        annotator.add_question(
            topic="Ethics",
            question_type="identification",
            stem="Which statute establishes code of conduct?",
            canonical_answer="Republic Act 6713",
            source_page=5,
        )

        db_path = tmp_path / "test_cp.db"
        annotator.compile_content_pack(output_db_path=db_path)
        assert db_path.exists()

        out_sft = tmp_path / "iterative_sft.jsonl"
        res_path = annotator.export_iterative_sft_chatml_jsonl(db_path=db_path, output_sft_path=out_sft)
        assert res_path.exists()

        with out_sft.open("r", encoding="utf-8") as f:
            records = [json.loads(line) for line in f]

        assert len(records) >= 2
        # Check that each record includes retrieval_tier and ChatML structure
        rec0 = records[0]
        assert "retrieval_tier" in rec0
        assert rec0["task_type"] == "explain_more"
        assert len(rec0["messages"]) == 3
        assert "Page 5" in rec0["messages"][2]["content"]

        rec1 = records[1]
        assert rec1["task_type"] == "interpret_free_answer"
        verdict = json.loads(rec1["messages"][2]["content"])
        assert verdict["verdict"] == "equivalent"
        assert "evidence_passage_ids" in verdict

        # Also test standalone build_iterative_sft_chatml_dataset function directly
        out_sft2 = tmp_path / "iterative_sft_direct.jsonl"
        res_path2 = build_iterative_sft_chatml_dataset(db_path=db_path, output_chatml_path=out_sft2)
        assert res_path2.exists()


