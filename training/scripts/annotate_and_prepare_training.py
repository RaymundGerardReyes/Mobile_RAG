#!/usr/bin/env python3
"""Multi-Subject Data Annotator & RAG Training Preparation Script.

Reuses the `ai_tutor_training` package to:
1. Programmatically annotate multi-subject questions across 4 Civil Service Exam domains
   (General Information, Ethics R.A. 6713, Filipino Balarila, Numerical Ability).
2. Validate all records against `contracts/*.schema.json`.
3. Compile the validated artifacts into an SQLite `content_pack.db` with FTS5 search.
4. Export Grounded RAG Instruction Fine-Tuning datasets in ChatML format.
5. Run a live demonstration of the 3-Tier Progressive Iterative RAG Justification Engine.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add package source to path if running directly
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "training" / "src"))

from ai_tutor_training.annotation import DatasetAnnotator
from ai_tutor_training.iterative_justifier import IterativeRAGJustifier


def main() -> None:
    contracts_dir = REPO_ROOT / "contracts"
    output_dir = REPO_ROOT / "training" / "artifacts" / "annotated_custom"
    output_dir.mkdir(parents=True, exist_ok=True)

    print("======================================================================")
    print(" 1. Initializing Multi-Subject Dataset Annotator")
    print("======================================================================")
    annotator = DatasetAnnotator(contracts_dir=contracts_dir, content_version="2026.10.1")

    # --- Subject 1: General Information / 1987 Philippine Constitution (Multiple Choice) ---
    annotator.add_passage(
        chapter="General Information",
        section="1987 Philippine Constitution - Article VI",
        start_page=12,
        end_page=12,
        text=(
            "Article VI, Section 1 of the 1987 Constitution states: The legislative power "
            "shall be vested in the Congress of the Philippines which shall consist of a Senate "
            "and a House of Representatives, except to the extent reserved to the people by the "
            "provision on initiative and referendum."
        ),
    )
    annotator.add_question(
        topic="General Information",
        question_type="multiple_choice",
        stem="Which government body is vested with legislative power under the 1987 Constitution?",
        choices=[
            {"key": "A", "text": "Supreme Court of the Philippines"},
            {"key": "B", "text": "Office of the President"},
            {"key": "C", "text": "Congress of the Philippines"},
            {"key": "D", "text": "Civil Service Commission"},
        ],
        canonical_answer="Congress of the Philippines",
        canonical_choice_key="C",
        canonical_explanation="Article VI, Section 1 explicitly vests legislative power in the Congress of the Philippines.",
        source_page=12,
        answer_key_page=15,
        difficulty="easy",
        link_confidence="verified",
    )

    # --- Subject 2: Civil Service Ethics & R.A. 6713 (Identification) ---
    annotator.add_passage(
        chapter="Civil Service Ethics",
        section="Code of Conduct (R.A. 6713)",
        start_page=24,
        end_page=24,
        text=(
            "Republic Act No. 6713 is the Code of Conduct and Ethical Standards for Public "
            "Officials and Employees. It establishes that public office is a public trust, "
            "mandating high standards of ethics, accountability, integrity, and responsiveness."
        ),
    )
    annotator.add_question(
        topic="Civil Service Ethics",
        question_type="identification",
        stem="Identify the Republic Act known as the Code of Conduct and Ethical Standards for Public Officials and Employees.",
        choices=None,
        canonical_answer="Republic Act 6713",
        canonical_choice_key=None,
        canonical_explanation="R.A. 6713 is the official Code of Conduct and Ethical Standards for Public Officials.",
        source_page=24,
        answer_key_page=26,
        difficulty="medium",
        link_confidence="verified",
    )

    # --- Subject 3: Filipino / Wika at Balarila (Essay) ---
    annotator.add_passage(
        chapter="Filipino",
        section="Wika at Balarila",
        start_page=35,
        end_page=35,
        text=(
            "Ang 'ng' ay ginagamit bilang pantukoy ng layon ng pandiwa o pagmamay-ari ng pangngalan. "
            "Samantala, ang 'nang' ay ginagamit bilang pangatnig sa pagitan ng mga salitang inuulit, "
            "o bilang pang-abay na sumasagot sa tanong na paano."
        ),
    )
    annotator.add_question(
        topic="Filipino",
        question_type="essay",
        stem="Ipaliwanag ang wastong pagkakaiba ng paggamit ng mga katagang 'ng' at 'nang' sa balarilang Filipino.",
        choices=None,
        canonical_answer="Ang 'ng' ay pantukoy sa layon o pagmamay-ari, habang ang 'nang' ay pang-abay o pangatnig sa inuulit na salita.",
        canonical_choice_key=None,
        canonical_explanation="Ginagamit ang 'ng' bilang pantukoy sa pangngalan at layon; ang 'nang' ay sumasagot sa paano o nag-uugnay ng inuulit na pandiwa.",
        source_page=35,
        answer_key_page=None,
        difficulty="hard",
        link_confidence="verified",
    )

    # --- Subject 4: Numerical Ability (Multiple Choice) ---
    annotator.add_passage(
        chapter="Numerical Ability",
        section="Percentage and Fractions",
        start_page=42,
        end_page=42,
        text=(
            "To calculate percentage change: subtract the old value from the new value, divide by "
            "the original value, and multiply by 100. For example, an increase from 50 to 75 is (75 - 50) / 50 * 100 = 50%."
        ),
    )
    annotator.add_question(
        topic="Numerical Ability",
        question_type="multiple_choice",
        stem="A government agency increased its budget from 50 million pesos to 75 million pesos. What is the percentage increase?",
        choices=[
            {"key": "A", "text": "25%"},
            {"key": "B", "text": "33.33%"},
            {"key": "C", "text": "50%"},
            {"key": "D", "text": "75%"},
        ],
        canonical_answer="50%",
        canonical_choice_key="C",
        canonical_explanation="Percentage increase is calculated as ((75 - 50) / 50) * 100 = 50%.",
        source_page=42,
        answer_key_page=45,
        difficulty="medium",
        link_confidence="verified",
    )

    # 1. Export validated JSONL artifacts
    print("\n======================================================================")
    print(" 2. Exporting Schema-Validated JSONL Artifacts")
    print("======================================================================")
    q_path, p_path = annotator.export_artifacts(output_dir)
    print(f" [PASS] Validated Questions JSONL: {q_path}")
    print(f" [PASS] Validated Passages JSONL:  {p_path}")

    # 2. Compile SQLite Content Pack with FTS5
    print("\n======================================================================")
    print(" 3. Compiling SQLite Content Pack with FTS5 Virtual Table")
    print("======================================================================")
    db_path = annotator.compile_content_pack(output_dir / "content_pack.db", q_path, p_path)
    print(f" [PASS] SQLite Content Pack:       {db_path}")

    # 3. Export ChatML format SFT training dataset
    print("\n======================================================================")
    print(" 4. Exporting Grounded RAG SFT Dataset (ChatML Format)")
    print("======================================================================")
    sft_path = annotator.export_sft_chatml_jsonl(output_dir / "sft_training_chatml.jsonl")
    print(f" [PASS] ChatML SFT Dataset:        {sft_path}")

    # 4. Live demonstration of 3-Tier Progressive Iterative RAG Engine
    print("\n======================================================================")
    print(" 5. Running 3-Tier Progressive Iterative RAG Justification Engine Demo")
    print("======================================================================")
    justifier = IterativeRAGJustifier(db_path=db_path, max_evidence_passages=2)

    # Execute justification with distractor-aware follow-up question
    result = justifier.justify_answer(
        question_id="q0001",
        follow_up_query="Why is Choice A (Supreme Court of the Philippines) not the correct answer here?",
        distractor_choice_key="A",
    )

    print(f"Target Question: [{result.question_id}] {result.stem}")
    print(f"Official Answer: {result.canonical_answer}")
    print("\nSearch Execution Trace:")
    for step in result.iterations_run:
        print(f"  • {step}")

    print(f"\nEvidence Retrieved ({len(result.evidence_found)} passages):")
    for ev in result.evidence_found:
        print(f"  [{ev.passage_id}] {ev.chapter} (Page {ev.start_page}) — {ev.retrieval_tier}")
        print(f"    Text: {ev.text[:120]}...")

    print("\nConstructed Grounded Prompt for Local Qwen3-1.7B:")
    print("----------------------------------------------------------------------")
    print(result.final_prompt[:450] + "\n... [TRUNCATED] ...\n" + result.final_prompt[-250:])
    print("----------------------------------------------------------------------")
    print("\n[SUCCESS] Multi-Subject Data Annotation & Iterative RAG Engine verified.")


if __name__ == "__main__":
    main()

