"""Unit and integration tests for ProbabilisticTutorEngine, Stage 5 train, and Stage 6 export_gguf."""

from __future__ import annotations

import json
import os
from pathlib import Path

# Windows Python 3.13 OpenBLAS Threading Guardrail
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

import pytest

from ai_tutor_training.content_pack import build_content_pack
from ai_tutor_training.contracts import load_schema, validate_record_against_schema
from ai_tutor_training.probabilistic_engine import (
    ProbabilisticSamplingConfig,
    ProbabilisticTutorEngine,
)
from ai_tutor_training.stages.export_gguf import export_gguf
from ai_tutor_training.stages.train import format_chatml_to_text, train

pytestmark = [pytest.mark.unit, pytest.mark.integration]


@pytest.fixture
def populated_probabilistic_db(
    sample_linked_questions_path: Path,
    sample_passages_path: Path,
    tmp_path: Path,
) -> Path:
    """Compile a test content_pack.db from standard fixtures for probabilistic testing."""
    db_path = tmp_path / "probabilistic_test.db"
    build_content_pack(
        linked_questions_path=sample_linked_questions_path,
        passages_path=sample_passages_path,
        output_db_path=db_path,
        version="2026.10.1",
    )
    return db_path


class TestProbabilisticTutorEngine:
    """Verify non-deterministic sampling, Best-of-N consensus voting, and guardrails."""

    def test_stochastic_explanation_sampling_and_citations(
        self, populated_probabilistic_db: Path
    ) -> None:
        """Verify probabilistic engine retrieves Tier 1 evidence and produces cited explanations."""
        cfg = ProbabilisticSamplingConfig(do_sample=True, temperature=0.75, top_p=0.90)
        engine = ProbabilisticTutorEngine(
            db_path=populated_probabilistic_db,
            sampling_config=cfg,
        )

        res = engine.explain_iteratively_probabilistic(
            question_id="q0001",
            follow_up_query="Why is Congress vested with legislative power?",
        )

        assert res.question_id == "q0001"
        assert len(res.evidence_found) >= 1
        assert res.llm_explanation is not None
        assert "[Page " in res.llm_explanation

    def test_deterministic_greedy_mode_consistency(
        self, populated_probabilistic_db: Path
    ) -> None:
        """When do_sample=False or temperature=0.0, outputs are identical across runs."""
        cfg = ProbabilisticSamplingConfig(do_sample=False, temperature=0.0)
        engine = ProbabilisticTutorEngine(
            db_path=populated_probabilistic_db,
            sampling_config=cfg,
        )

        run1 = engine.explain_iteratively_probabilistic("q0001", temperature=0.0)
        run2 = engine.explain_iteratively_probabilistic("q0001", temperature=0.0)
        assert run1.llm_explanation == run2.llm_explanation

    def test_best_of_n_consensus_majority_equivalent(
        self, populated_probabilistic_db: Path, contracts_dir: Path
    ) -> None:
        """Verify Best-of-3 self-consistency voting selects the 2/3 majority verdict."""
        schema_path = contracts_dir / "free-answer-verdict.schema.json"

        # Simulate 3 stochastic LLM samples: 2 'equivalent' (high conf) and 1 'partially_equivalent'
        simulated_outputs = [
            json.dumps(
                {
                    "verdict": "equivalent",
                    "matched_concepts": ["Republic Act 6713", "Code of Conduct"],
                    "missing_concepts": [],
                    "evidence_passage_ids": ["p0003"],
                    "confidence": 0.94,
                }
            ),
            json.dumps(
                {
                    "verdict": "partially_equivalent",
                    "matched_concepts": ["Republic Act 6713"],
                    "missing_concepts": ["Ethical Standards"],
                    "evidence_passage_ids": ["p0003"],
                    "confidence": 0.82,
                }
            ),
            json.dumps(
                {
                    "verdict": "equivalent",
                    "matched_concepts": ["Republic Act 6713"],
                    "missing_concepts": [],
                    "evidence_passage_ids": ["p0003"],
                    "confidence": 0.91,
                }
            ),
        ]
        call_idx = {"idx": 0}

        def stochastic_mock_generator(_prompt: str, _cfg: ProbabilisticSamplingConfig) -> str:
            out = simulated_outputs[call_idx["idx"] % len(simulated_outputs)]
            call_idx["idx"] += 1
            return out

        engine = ProbabilisticTutorEngine(
            db_path=populated_probabilistic_db,
            generator_fn=stochastic_mock_generator,
        )

        consensus = engine.evaluate_free_answer_with_consensus(
            question_id="q0004",
            user_answer="Republic Act 6713",
            schema_path=schema_path,
            num_samples=3,
        )

        assert consensus.num_samples == 3
        assert consensus.final_result.verdict == "equivalent"
        assert consensus.final_result.score == 1.0
        assert consensus.final_result.is_uncertain is False
        assert consensus.verdict_distribution["equivalent"] == pytest.approx(0.6667, rel=1e-2)
        assert consensus.verdict_distribution["partially_equivalent"] == pytest.approx(0.3333, rel=1e-2)
        assert 0.85 <= consensus.average_confidence <= 0.95

    def test_best_of_n_consensus_rejects_hallucinated_citations(
        self, populated_probabilistic_db: Path, contracts_dir: Path
    ) -> None:
        """If stochastic samples cite an unverified passage ID (p9999), guardrails downgrade to uncertain."""
        schema_path = contracts_dir / "free-answer-verdict.schema.json"

        def hallucinating_generator(_prompt: str, _cfg: ProbabilisticSamplingConfig) -> str:
            return json.dumps(
                {
                    "verdict": "equivalent",
                    "matched_concepts": ["RA 6713"],
                    "missing_concepts": [],
                    "evidence_passage_ids": ["p9999"],  # Not in supplied passages!
                    "confidence": 0.99,
                }
            )

        engine = ProbabilisticTutorEngine(
            db_path=populated_probabilistic_db,
            generator_fn=hallucinating_generator,
        )

        consensus = engine.evaluate_free_answer_with_consensus(
            question_id="q0004",
            user_answer="RA 6713",
            schema_path=schema_path,
            num_samples=3,
        )

        assert consensus.final_result.verdict == "uncertain"
        assert consensus.final_result.score == 0.0
        assert consensus.final_result.is_uncertain is True
        assert consensus.verdict_distribution["uncertain"] == 1.0


class TestStage5TrainAndStage6ExportGGUF:
    """Verify Stage 5 dry-run QLoRA training and Stage 6 GGUF manifest generation."""

    def test_stage5_train_dry_run_validates_chatml(self, tmp_path: Path) -> None:
        sft_file = tmp_path / "sample_sft.jsonl"
        adapter_dir = tmp_path / "lora_out"

        sample_record = {
            "task_type": "explain_more",
            "question_id": "q0001",
            "topic": "Constitution",
            "messages": [
                {"role": "system", "content": "You are an offline AI tutor."},
                {"role": "user", "content": "<context>Art VI</context><task>Explain</task>"},
                {"role": "assistant", "content": "Congress holds legislative power [Page 1]."},
            ],
        }
        sft_file.write_text(json.dumps(sample_record) + "\n", encoding="utf-8")

        formatted = format_chatml_to_text(sample_record["messages"])
        assert "<|im_start|>system" in formatted
        assert "<|im_start|>assistant" in formatted

        summary = train(
            sft_dataset_path=sft_file,
            output_adapter_dir=adapter_dir,
            dry_run=True,
        )
        assert summary["status"] == "dry_run_verified"
        assert summary["train_samples"] == 1
        assert (adapter_dir / "adapter_training_summary.json").exists()

    def test_stage6_export_gguf_generates_schema_valid_manifest(
        self, tmp_path: Path, contracts_dir: Path
    ) -> None:
        adapter_dir = tmp_path / "lora_adapter"
        adapter_dir.mkdir(parents=True)
        (adapter_dir / "adapter_config.json").write_text("{}", encoding="utf-8")

        gguf_out = tmp_path / "models" / "qwen3-1.7b-instruct-q4_k_m.gguf"
        manifest_out = tmp_path / "models" / "model-manifest.json"
        stage_manifest_out = tmp_path / "models" / "export_stage_manifest.json"

        manifest_data = export_gguf(
            adapter_dir=adapter_dir,
            output_gguf_path=gguf_out,
            model_manifest_path=manifest_out,
            stage_manifest_path=stage_manifest_out,
            contracts_dir=contracts_dir,
            simulate_if_no_llama_cpp=True,
        )

        assert gguf_out.exists()
        assert manifest_out.exists()
        assert stage_manifest_out.exists()
        assert len(manifest_data["file_sha256"]) == 64
        assert manifest_data["quantization"] == "Q4_K_M"

        # Validate against official contracts/model-manifest.schema.json
        schema = load_schema(contracts_dir / "model-manifest.schema.json")
        errors = validate_record_against_schema(manifest_data, schema)
        assert errors == []

