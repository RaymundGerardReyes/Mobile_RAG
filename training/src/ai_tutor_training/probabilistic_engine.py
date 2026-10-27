"""Probabilistic (Non-Deterministic) AI Inference & Self-Consistency Engine.

Connects `IterativeRAGJustifier` and `evaluation.validate_and_score_free_answer`
to a stochastic LLM generator (Hugging Face Transformers/PEFT or custom callable)
using temperature/top-p nucleus sampling and Best-of-N self-consistency voting.
"""

from __future__ import annotations

import json
import os
import random
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

# Windows Python 3.13 OpenBLAS Threading Guardrail
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

from ai_tutor_training.evaluation import (
    EvaluationResult,
    FreeAnswerScoreResult,
    validate_and_score_free_answer,
)
from ai_tutor_training.iterative_justifier import (
    IterativeRAGJustifier,
    JustificationResult,
)
from ai_tutor_training.prompting import build_free_answer_prompt


@dataclass
class ProbabilisticSamplingConfig:
    """Parameters governing non-deterministic (probabilistic) LLM generation."""

    do_sample: bool = True
    temperature: float = 0.65
    top_p: float = 0.90
    top_k: int = 40
    max_new_tokens: int = 256
    repetition_penalty: float = 1.1
    num_consensus_samples: int = 3  # Used for Best-of-N self-consistency grading


@dataclass
class ConsensusEvaluationResult:
    """Result of multi-sample probabilistic self-consistency free-answer grading."""

    final_result: EvaluationResult
    num_samples: int
    verdict_distribution: dict[str, float]
    average_confidence: float
    individual_runs: list[EvaluationResult] = field(default_factory=list)


class ProbabilisticTutorEngine:
    """Executes non-deterministic LLM sampling wrapped in deterministic RAG guardrails."""

    def __init__(
        self,
        db_path: Path | str,
        sampling_config: ProbabilisticSamplingConfig | None = None,
        generator_fn: Callable[[str, ProbabilisticSamplingConfig], str] | None = None,
        model_or_adapter_path: Path | str | None = None,
    ) -> None:
        self.db_path = Path(db_path)
        self.config = sampling_config or ProbabilisticSamplingConfig()
        self.justifier = IterativeRAGJustifier(db_path=self.db_path, max_evidence_passages=2)
        self._generator_fn = generator_fn
        self._hf_model: Any = None
        self._hf_tokenizer: Any = None

        if model_or_adapter_path is not None and self._generator_fn is None:
            self._load_hf_model(Path(model_or_adapter_path))

    def _load_hf_model(self, model_path: Path) -> None:
        """Load local Hugging Face base model or PEFT LoRA adapter for live stochastic sampling."""
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self._hf_tokenizer = AutoTokenizer.from_pretrained(str(model_path), trust_remote_code=True)
        if self._hf_tokenizer.pad_token is None:
            self._hf_tokenizer.pad_token = self._hf_tokenizer.eos_token

        self._hf_model = AutoModelForCausalLM.from_pretrained(
            str(model_path),
            device_map="auto" if torch.cuda.is_available() else None,
            trust_remote_code=True,
        )
        self._hf_model.eval()

    def sample_completion(
        self,
        prompt: str,
        override_config: ProbabilisticSamplingConfig | None = None,
    ) -> str:
        """Generate a single non-deterministic completion using nucleus (top-p) & temperature sampling."""
        cfg = override_config or self.config

        if self._generator_fn is not None:
            return self._generator_fn(prompt, cfg)

        if self._hf_model is not None and self._hf_tokenizer is not None:
            import torch

            inputs = self._hf_tokenizer(prompt, return_tensors="pt").to(self._hf_model.device)
            # Filter token_type_ids if present for causal LM
            inputs.pop("token_type_ids", None)
            with torch.no_grad():
                output_ids = self._hf_model.generate(
                    **inputs,
                    do_sample=cfg.do_sample,
                    temperature=cfg.temperature if cfg.do_sample else 1.0,
                    top_p=cfg.top_p if cfg.do_sample else 1.0,
                    top_k=cfg.top_k if cfg.do_sample else 50,
                    max_new_tokens=cfg.max_new_tokens,
                    repetition_penalty=cfg.repetition_penalty,
                    pad_token_id=self._hf_tokenizer.pad_token_id,
                )
            generated_tokens = output_ids[0][inputs["input_ids"].shape[1] :]
            return self._hf_tokenizer.decode(generated_tokens, skip_special_tokens=True).strip()

        # Offline stochastic fallback generator (varies phrasing probabilistically by temperature)
        return self._stochastic_offline_synthesizer(prompt, cfg)

    def _stochastic_offline_synthesizer(
        self,
        prompt: str,
        cfg: ProbabilisticSamplingConfig,
    ) -> str:
        """Probabilistic fallback synthesizer that varies pedagogical phrasing while preserving citations."""
        lead_ins = [
            "Based on the retrieved Civil Service textbook evidence,",
            "According to the official legal provision in the excerpt,",
            "Drawing directly from the verified reference material,",
            "Following the constitutional and civil service standard cited,",
        ]
        reasoning_connectors = [
            "this directly proves the official answer because",
            "the requirement is satisfied since",
            "we can verify the canonical choice because",
        ]
        distractor_closings = [
            "The other options are eliminated as they fall outside the statutory mandate.",
            "Alternative choices do not align with the specific provision cited above.",
            "Distractor options contradict the explicit text of the law.",
        ]

        # Higher temperature increases phrase diversity
        if cfg.do_sample and cfg.temperature > 0.1:
            lead = random.choice(lead_ins)
            conn = random.choice(reasoning_connectors)
            closing = random.choice(distractor_closings)
        else:
            lead = lead_ins[0]
            conn = reasoning_connectors[0]
            closing = distractor_closings[0]

        page_tag = "[Page 1]"
        for line in prompt.splitlines():
            if "Page " in line and "[" in line:
                start = line.find("Page ")
                end = line.find("]", start)
                if start != -1:
                    page_num = line[start:].split("|")[0].split("]")[0].strip()
                    page_tag = f"[{page_num}]"
                    break

        return f"{lead} ({page_tag}), {conn} the excerpt explicitly establishes this rule. {closing}"

    def explain_iteratively_probabilistic(
        self,
        question_id: str,
        follow_up_query: str | None = None,
        distractor_choice_key: str | None = None,
        temperature: float | None = None,
    ) -> JustificationResult:
        """Run 3-tier iterative retrieval + non-deterministic LLM explanation generation."""
        active_cfg = ProbabilisticSamplingConfig(
            do_sample=self.config.do_sample,
            temperature=temperature if temperature is not None else self.config.temperature,
            top_p=self.config.top_p,
            top_k=self.config.top_k,
            max_new_tokens=self.config.max_new_tokens,
        )

        return self.justifier.justify_answer(
            question_id=question_id,
            follow_up_query=follow_up_query,
            distractor_choice_key=distractor_choice_key,
            llm_inference_fn=lambda prompt: self.sample_completion(prompt, active_cfg),
        )

    def evaluate_free_answer_with_consensus(
        self,
        question_id: str,
        user_answer: str,
        schema_path: Path | str | None = None,
        num_samples: int | None = None,
    ) -> ConsensusEvaluationResult:
        """Grade a free-text answer using Best-of-N probabilistic self-consistency voting.

        Samples `num_samples` stochastic LLM JSON verdicts, validates each through the
        4 deterministic guardrails, and selects the majority verdict.
        """
        q_data, evidence, _ = self.justifier.retrieve_evidence_iteratively(question_id=question_id)
        passage_dicts = [
            {
                "passage_id": ev.passage_id,
                "text": ev.text,
                "start_page": ev.start_page,
            }
            for ev in evidence
        ]
        supplied_ids = [ev.passage_id for ev in evidence]

        prompt = build_free_answer_prompt(
            stem=q_data["stem"],
            canonical_answer=str(q_data["canonical_answer"]),
            user_answer=user_answer,
            passages=passage_dicts,
        )

        n = num_samples or self.config.num_consensus_samples
        runs: list[EvaluationResult] = []
        verdict_counts: Counter[str] = Counter()
        confidences: list[float] = []

        for _ in range(max(1, n)):
            raw_json_str = self.sample_completion(prompt, self.config)
            validated = validate_and_score_free_answer(
                raw_llm_output=raw_json_str,
                supplied_passage_ids=supplied_ids,
                schema_path=schema_path,
            )
            runs.append(validated)
            verdict_counts[validated.verdict] += 1
            confidences.append(validated.confidence)

        # Compute empirical probability distribution across verdicts
        total_runs = len(runs)
        distribution = {v: round(cnt / total_runs, 4) for v, cnt in verdict_counts.items()}
        majority_verdict = verdict_counts.most_common(1)[0][0]
        avg_conf = round(sum(confidences) / total_runs, 4) if confidences else 0.0

        # Pick the representative run matching the majority verdict
        winning_run = next(r for r in runs if r.verdict == majority_verdict)

        return ConsensusEvaluationResult(
            final_result=winning_run,
            num_samples=total_runs,
            verdict_distribution=distribution,
            average_confidence=avg_conf,
            individual_runs=runs,
        )

