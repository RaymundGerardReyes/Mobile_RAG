#!/usr/bin/env python3
"""Multi-Subject Data Annotator & RAG Training Preparation Script.

Supports both:
1. Live Production Ingestion (`--mode live`, default):
   Loads, validates, and compiles all 200 authentic Civil Service Exam questions
   and 68 passages from `reviewer.pdf` / `linked_questions.jsonl`, compiles
   the SQLite `content_pack.db` with FTS5 search, exports ChatML SFT data,
   and runs a live demonstration of the 3-Tier Progressive Iterative RAG engine
   on authentic exam items.
2. Authoring SDK Demonstration (`--mode demo`):
   Demonstrates the programmatic `DatasetAnnotator` API with hand-crafted sample
   questions across 4 exam domains.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Add package source to path if running directly
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "training" / "src"))

from ai_tutor_training.annotation import DatasetAnnotator
from ai_tutor_training.iterative_justifier import IterativeRAGJustifier


def run_live_pipeline(
    contracts_dir: Path,
    output_dir: Path,
    questions_path: Path,
    passages_path: Path,
) -> None:
    """Execute live data validation, compilation, and iterative RAG demonstration."""
    print("======================================================================")
    print(" 1. Initializing Live Dataset Annotator with Authentic Reviewer Data")
    print("======================================================================")
    annotator = DatasetAnnotator(contracts_dir=contracts_dir, content_version="2026.10.1")

    print(f"Loading live questions: {questions_path}")
    print(f"Loading live passages:  {passages_path}")
    q_count, p_count = annotator.load_from_jsonl(questions_path, passages_path)
    print(f" [PASS] Loaded & validated {q_count} authentic questions and {p_count} passages against JSON schemas.")

    # 1. Export validated JSONL artifacts
    print("\n======================================================================")
    print(" 2. Exporting Schema-Validated JSONL Artifacts")
    print("======================================================================")
    q_out, p_out = annotator.export_artifacts(output_dir)
    print(f" [PASS] Validated Questions JSONL: {q_out}")
    print(f" [PASS] Validated Passages JSONL:  {p_out}")

    # 2. Compile SQLite Content Pack with FTS5
    print("\n======================================================================")
    print(" 3. Compiling SQLite Content Pack with FTS5 Virtual Table")
    print("======================================================================")
    db_path = annotator.compile_content_pack(output_dir / "content_pack.db", q_out, p_out)
    print(f" [PASS] SQLite Content Pack:       {db_path}")

    # 3. Export ChatML format SFT training dataset
    print("\n======================================================================")
    print(" 4. Exporting Grounded RAG SFT Dataset (ChatML Format)")
    print("======================================================================")
    sft_path = annotator.export_sft_chatml_jsonl(output_dir / "reviewer_sft_chatml.jsonl")
    print(f" [PASS] ChatML SFT Dataset:        {sft_path}")

    # 4. Live demonstration of 3-Tier Progressive Iterative RAG Engine
    print("\n======================================================================")
    print(" 5. Running 3-Tier Progressive Iterative RAG Justification Engine Demo")
    print("======================================================================")
    justifier = IterativeRAGJustifier(db_path=db_path, max_evidence_passages=2)

    # Use first live question for live RAG demonstration
    first_q = annotator.questions[0]
    target_q_id = first_q["question_id"]
    stem = first_q["stem"]
    choices = first_q.get("choices") or []
    distractor_key = "B" if choices and len(choices) > 1 else None
    distractor_text = choices[1]["text"] if choices and len(choices) > 1 else "alternative"

    result = justifier.justify_answer(
        question_id=target_q_id,
        follow_up_query=f"Why is Choice {distractor_key} ({distractor_text}) not the correct answer for this question?",
        distractor_choice_key=distractor_key,
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

    print("\nConstructed Grounded Prompt for Local Qwen Model:")
    print("----------------------------------------------------------------------")
    print(result.final_prompt[:450] + "\n... [TRUNCATED] ...\n" + result.final_prompt[-250:])
    print("----------------------------------------------------------------------")
    print(f"\n[SUCCESS] Authentic Civil Service Reviewer Data ({q_count} questions) compiled & verified.")


def run_demo_pipeline(contracts_dir: Path, output_dir: Path) -> None:
    """Execute 4-subject authoring SDK demo."""
    print("======================================================================")
    print(" 1. Initializing Multi-Subject Dataset Annotator (Authoring SDK Demo)")
    print("======================================================================")
    annotator = DatasetAnnotator(contracts_dir=contracts_dir, content_version="2026.10.1")

    # Subject 1: General Information / 1987 Philippine Constitution (Multiple Choice)
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

    # Subject 2: Civil Service Ethics & R.A. 6713 (Identification)
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

    # Subject 3: Filipino / Wika at Balarila (Essay)
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

    # Subject 4: Numerical Ability (Multiple Choice)
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

    q_path, p_path = annotator.export_artifacts(output_dir)
    print(f" [PASS] Validated Questions JSONL: {q_path}")
    print(f" [PASS] Validated Passages JSONL:  {p_path}")

    db_path = annotator.compile_content_pack(output_dir / "content_pack.db", q_path, p_path)
    print(f" [PASS] SQLite Content Pack:       {db_path}")

    sft_path = annotator.export_sft_chatml_jsonl(output_dir / "sft_training_chatml.jsonl")
    print(f" [PASS] ChatML SFT Dataset:        {sft_path}")

    justifier = IterativeRAGJustifier(db_path=db_path, max_evidence_passages=2)
    result = justifier.justify_answer(
        question_id="q0001",
        follow_up_query="Why is Choice A (Supreme Court of the Philippines) not the correct answer here?",
        distractor_choice_key="A",
    )
    print(f"Target Question: [{result.question_id}] {result.stem}")
    print(f"Official Answer: {result.canonical_answer}")
    print("\n[SUCCESS] Authoring SDK Demo pipeline verified.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Multi-Subject Data Annotator & RAG Training Preparation")
    parser.add_argument(
        "--mode",
        choices=["live", "demo"],
        default="live",
        help="Run on live authentic reviewer data ('live', default) or 4-subject sample demo ('demo')",
    )
    parser.add_argument(
        "--questions",
        type=str,
        default=str(REPO_ROOT / "training" / "artifacts" / "linked_questions.jsonl"),
        help="Path to linked_questions.jsonl",
    )
    parser.add_argument(
        "--passages",
        type=str,
        default=str(REPO_ROOT / "training" / "artifacts" / "passages.jsonl"),
        help="Path to passages.jsonl",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(REPO_ROOT / "training" / "artifacts"),
        help="Output directory for compiled artifacts",
    )
    args = parser.parse_args()

    contracts_dir = REPO_ROOT / "contracts"
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    questions_path = Path(args.questions)
    passages_path = Path(args.passages)

    if args.mode == "live":
        if not questions_path.exists() or not passages_path.exists():
            print(f"[WARN] Live files not found at {questions_path} or {passages_path}. Falling back to demo mode.")
            run_demo_pipeline(contracts_dir, output_dir / "annotated_custom")
        else:
            run_live_pipeline(contracts_dir, output_dir, questions_path, passages_path)
    else:
        demo_out = output_dir / "annotated_custom"
        demo_out.mkdir(parents=True, exist_ok=True)
        run_demo_pipeline(contracts_dir, demo_out)


if __name__ == "__main__":
    main()
