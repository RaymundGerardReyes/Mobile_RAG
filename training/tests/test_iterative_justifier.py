"""Tests for 3-Tier Progressive Iterative RAG Evidence & Justification Engine."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from ai_tutor_training.annotation import DatasetAnnotator
from ai_tutor_training.iterative_justifier import (
    IterativeRAGJustifier,
    extract_search_keywords,
)


@pytest.fixture
def test_db_path(tmp_path: Path) -> Path:
    """Create a populated content_pack.db with multiple subjects and FTS5 index."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    contracts_dir = repo_root / "contracts"

    annotator = DatasetAnnotator(contracts_dir=contracts_dir)

    # Passage 1: Constitution
    annotator.add_passage(
        chapter="General Information",
        section="1987 Constitution Article VI",
        start_page=12,
        end_page=12,
        text="The legislative power shall be vested in the Congress of the Philippines consisting of Senate and House of Representatives.",
    )

    # Passage 2: Civil Service Ethics
    annotator.add_passage(
        chapter="Civil Service Ethics",
        section="Code of Conduct",
        start_page=24,
        end_page=24,
        text="Republic Act 6713 establishes the ethical standards and public accountability for all civil servants.",
    )

    # Passage 3: Distractor Counter-Evidence (Supreme Court Judiciary)
    annotator.add_passage(
        chapter="General Information",
        section="1987 Constitution Article VIII",
        start_page=18,
        end_page=18,
        text="Judicial power is vested in one Supreme Court and in such lower courts as may be established by law. The Supreme Court interprets laws, not enacts them.",
    )

    # Question 1: Linked to page 12 (Tier 1 direct link candidate)
    annotator.add_question(
        topic="General Information",
        question_type="multiple_choice",
        stem="Which body holds legislative power under the 1987 Constitution?",
        choices=[
            {"key": "A", "text": "Supreme Court of the Philippines"},
            {"key": "B", "text": "Office of the President"},
            {"key": "C", "text": "Congress of the Philippines"},
            {"key": "D", "text": "Sandiganbayan"},
        ],
        canonical_answer="Congress of the Philippines",
        canonical_choice_key="C",
        canonical_explanation="Article VI vests legislative power in Congress.",
        source_page=12,
    )

    # Question 2: On page 99 (no direct passage link on page 99, but keywords match Passage 2 via Tier 2)
    annotator.add_question(
        topic="Ethics",
        question_type="multiple_choice",
        stem="Which law mandates ethical standards and accountability for civil servants?",
        choices=[
            {"key": "A", "text": "Republic Act 6713"},
            {"key": "B", "text": "Republic Act 9184"},
            {"key": "C", "text": "Republic Act 7160"},
            {"key": "D", "text": "Republic Act 3019"},
        ],
        canonical_answer="Republic Act 6713",
        canonical_choice_key="A",
        canonical_explanation="R.A. 6713 is the Code of Conduct and Ethical Standards.",
        source_page=99,
    )

    # Question 3: Distractor analysis target
    annotator.add_question(
        topic="General Information",
        question_type="multiple_choice",
        stem="Which government entity enacts statutory legislation in the Philippines?",
        choices=[
            {"key": "A", "text": "Supreme Court judiciary"},
            {"key": "B", "text": "Congress of the Philippines"},
        ],
        canonical_answer="Congress of the Philippines",
        canonical_choice_key="B",
        source_page=12,
    )

    db_path = tmp_path / "test_content_pack.db"
    annotator.compile_content_pack(db_path)
    return db_path


class TestIterativeRAGJustifier:
    """Unit and integration tests for IterativeRAGJustifier."""

    def test_extract_search_keywords_filtering(self) -> None:
        raw_text = "What is the prime duty of the Government under the 1987 Constitution?"
        kw = extract_search_keywords(raw_text, max_keywords=5)
        # Should exclude "what", "is", "the", "of", "under"
        assert "prime" in kw
        assert "duty" in kw
        assert "government" in kw
        assert "constitution" in kw
        assert "the" not in kw
        assert len(kw) <= 5

    def test_missing_database_raises_file_not_found(self, tmp_path: Path) -> None:
        missing_db = tmp_path / "does_not_exist.db"
        with pytest.raises(FileNotFoundError, match="not found"):
            IterativeRAGJustifier(db_path=missing_db)

    def test_tier1_direct_link_retrieval(self, test_db_path: Path) -> None:
        justifier = IterativeRAGJustifier(db_path=test_db_path, max_evidence_passages=1)

        # q0001 is on page 12, matching passage p0001
        q_data, evidence, iterations = justifier.retrieve_evidence_iteratively(question_id="q0001")

        assert q_data["question_id"] == "q0001"
        assert len(evidence) == 1
        assert evidence[0].passage_id == "p0001"
        assert evidence[0].retrieval_tier == "Tier 1: Direct Page Link"
        assert any("Tier 1" in it for it in iterations)

    def test_tier2_strict_fts5_bm25_retrieval(self, test_db_path: Path) -> None:
        justifier = IterativeRAGJustifier(db_path=test_db_path, max_evidence_passages=1)

        # q0002 is on page 99 (no direct link in question_passages)
        q_data, evidence, iterations = justifier.retrieve_evidence_iteratively(question_id="q0002")

        assert q_data["question_id"] == "q0002"
        assert len(evidence) >= 1
        # Should have found passage p0002 via strict FTS5 BM25
        assert evidence[0].passage_id == "p0002"
        assert "FTS5" in evidence[0].retrieval_tier
        assert any("Iteration 2" in it for it in iterations)

    def test_tier3_distractor_aware_retrieval(self, test_db_path: Path) -> None:
        justifier = IterativeRAGJustifier(db_path=test_db_path, max_evidence_passages=2)

        # Target Question q0003, inquiring specifically about Choice A (Supreme Court judiciary)
        q_data, evidence, iterations = justifier.retrieve_evidence_iteratively(
            question_id="q0003",
            follow_up_query="Why is Choice A incorrect?",
            distractor_choice_key="A",
        )

        assert q_data["question_id"] == "q0003"
        # Should have retrieved passage p0001 (Congress) and passage p0003 (Supreme Court counter-evidence)
        retrieved_ids = [ev.passage_id for ev in evidence]
        assert "p0001" in retrieved_ids or "p0003" in retrieved_ids
        assert any("Iteration 3" in it or "Iteration 2" in it for it in iterations)

    def test_build_deep_justification_prompt_structure(self, test_db_path: Path) -> None:
        justifier = IterativeRAGJustifier(db_path=test_db_path, max_evidence_passages=2)

        result = justifier.justify_answer(
            question_id="q0001",
            follow_up_query="Why is Choice A wrong?",
            distractor_choice_key="A",
        )

        prompt = result.final_prompt
        assert "<system>" in prompt
        assert "</system>" in prompt
        assert "<context>" in prompt
        assert "</context>" in prompt
        assert "<task>" in prompt
        assert "</task>" in prompt
        assert "[DIRECT PROOF]" in prompt
        assert "[DISTRACTOR ELIMINATION]" in prompt
        assert "Choice [A]" in prompt
        assert "Page 12" in prompt or "Page 18" in prompt
        assert "Ang ibinigay na sanggunian ay walang sapat na detalye" in prompt

    def test_zero_evidence_fallback_prompt(self, tmp_path: Path, contracts_dir: Path) -> None:
        # Create an empty db with questions but no passages
        annotator = DatasetAnnotator(contracts_dir=contracts_dir)
        annotator.add_question(
            topic="Astronomy",
            question_type="multiple_choice",
            stem="What is the distance to Proxima Centauri?",
            choices=[{"key": "A", "text": "4.24 light years"}],
            canonical_answer="4.24 light years",
            source_page=50,
        )
        empty_db = tmp_path / "empty_passages.db"
        annotator.compile_content_pack(empty_db)

        justifier = IterativeRAGJustifier(db_path=empty_db)
        result = justifier.justify_answer(question_id="q0001")

        assert len(result.evidence_found) == 0
        assert "[NO MATCHING TEXTBOOK PASSAGES FOUND IN DATABASE]" in result.final_prompt

    def test_justify_answer_with_mock_inference_callback(self, test_db_path: Path) -> None:
        justifier = IterativeRAGJustifier(db_path=test_db_path)

        def mock_llm(prompt: str) -> str:
            assert "<system>" in prompt
            return "According to Article VI on [Page 12], legislative power belongs to Congress. Choice A is incorrect because judicial power belongs to the Supreme Court."

        result = justifier.justify_answer(
            question_id="q0001",
            distractor_choice_key="A",
            llm_inference_fn=mock_llm,
        )

        assert result.llm_explanation is not None
        assert "Article VI" in result.llm_explanation
        assert "Choice A is incorrect" in result.llm_explanation

