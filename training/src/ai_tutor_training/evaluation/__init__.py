"""Evaluation guardrails and semantic response verification for FreeAnswer scoring."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ai_tutor_training.contracts import load_schema, validate_record_against_schema

CONFIDENCE_THRESHOLD = 0.75


@dataclass
class EvaluationResult:
    """Deterministic score and audit record produced by evaluating model output."""

    verdict: str  # "equivalent" | "partially_equivalent" | "incorrect" | "ambiguous" | "uncertain"
    score: float  # 1.0, 0.5, 0.0
    is_uncertain: bool
    status: str  # "accepted" | "partial" | "rejected" | "uncertain"
    reason: str
    parsed_data: dict[str, Any] | None = None
    matched_concepts: list[str] = field(default_factory=list)
    missing_concepts: list[str] = field(default_factory=list)
    evidence_passage_ids: list[str] = field(default_factory=list)
    confidence: float = 0.0


def extract_json_from_text(raw_text: str) -> dict[str, Any] | None:
    """Safely parse JSON from raw LLM output, handling markdown blocks if present."""
    if not raw_text or not raw_text.strip():
        return None

    cleaned = raw_text.strip()

    # Strip markdown code fence if the model included it despite instructions
    if cleaned.startswith("```"):
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
        if match:
            cleaned = match.group(1).strip()

    # Try direct parse
    try:
        data = json.loads(cleaned)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    # Fallback: find first outer brace pair
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end > start:
        snippet = cleaned[start : end + 1]
        try:
            data = json.loads(snippet)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass

    return None


def validate_and_score_free_answer(
    raw_llm_output: str,
    supplied_passage_ids: list[str] | set[str] | None = None,
    schema_path: Path | str | None = None,
    confidence_threshold: float = CONFIDENCE_THRESHOLD,
) -> EvaluationResult:
    """Apply the 4 guardrail scoring rules from logic_and_implementation_guide.md §3.

    Guardrail Rules:
    1. Schema Validation: If output is not valid JSON or violates schema -> return uncertain.
    2. Evidence Validation: If evidence_passage_ids contains IDs not in supplied prompt -> return uncertain.
    3. Confidence Threshold: If confidence < 0.75 -> return uncertain.
    4. Final Verdict:
       - equivalent -> Mark full score (1.0).
       - partially_equivalent -> Mark half score (0.5).
       - incorrect -> Mark incorrect (0.0).
       - ambiguous -> Prompt learner to compare with official answer (uncertain).
    """
    valid_ids: set[str] = set(supplied_passage_ids or [])

    # Rule 1a: Parse JSON
    parsed = extract_json_from_text(raw_llm_output)
    if parsed is None:
        return EvaluationResult(
            verdict="uncertain",
            score=0.0,
            is_uncertain=True,
            status="uncertain",
            reason="Model output could not be parsed as valid JSON.",
        )

    # Rule 1b: Schema Validation
    if schema_path is not None:
        schema = load_schema(schema_path)
    else:
        # Default path relative to repository
        default_schema = (
            Path(__file__).resolve().parent.parent.parent.parent
            / "contracts"
            / "free-answer-verdict.schema.json"
        )
        if default_schema.exists():
            schema = load_schema(default_schema)
        else:
            schema = None

    if schema is not None:
        schema_errors = validate_record_against_schema(parsed, schema)
        if schema_errors:
            return EvaluationResult(
                verdict="uncertain",
                score=0.0,
                is_uncertain=True,
                status="uncertain",
                reason=f"Model output violated JSON schema: {schema_errors[0]}",
                parsed_data=parsed,
            )
    else:
        # Minimal sanity check if schema file unavailable
        required_fields = ["verdict", "matched_concepts", "missing_concepts", "evidence_passage_ids", "confidence"]
        for rf in required_fields:
            if rf not in parsed:
                return EvaluationResult(
                    verdict="uncertain",
                    score=0.0,
                    is_uncertain=True,
                    status="uncertain",
                    reason=f"Missing required field '{rf}' in model response.",
                    parsed_data=parsed,
                )

    verdict = parsed.get("verdict")
    matched_concepts = parsed.get("matched_concepts", [])
    missing_concepts = parsed.get("missing_concepts", [])
    evidence_ids = parsed.get("evidence_passage_ids", [])
    confidence = float(parsed.get("confidence", 0.0))

    # Rule 2: Evidence Validation (Hallucination check)
    if evidence_ids:
        hallucinated_ids = [eid for eid in evidence_ids if eid not in valid_ids]
        if hallucinated_ids:
            return EvaluationResult(
                verdict="uncertain",
                score=0.0,
                is_uncertain=True,
                status="uncertain",
                reason=f"Model cited unverified passage IDs not in prompt context: {hallucinated_ids}",
                parsed_data=parsed,
                matched_concepts=matched_concepts,
                missing_concepts=missing_concepts,
                evidence_passage_ids=evidence_ids,
                confidence=confidence,
            )

    # Rule 3: Confidence Threshold
    if confidence < confidence_threshold:
        return EvaluationResult(
            verdict="uncertain",
            score=0.0,
            is_uncertain=True,
            status="uncertain",
            reason=f"Model confidence ({confidence:.2f}) is below threshold ({confidence_threshold:.2f}).",
            parsed_data=parsed,
            matched_concepts=matched_concepts,
            missing_concepts=missing_concepts,
            evidence_passage_ids=evidence_ids,
            confidence=confidence,
        )

    # Rule 4: Verdict Mapping to deterministic score
    if verdict == "equivalent":
        return EvaluationResult(
            verdict="equivalent",
            score=1.0,
            is_uncertain=False,
            status="accepted",
            reason="Learner answer is semantically equivalent to canonical answer.",
            parsed_data=parsed,
            matched_concepts=matched_concepts,
            missing_concepts=missing_concepts,
            evidence_passage_ids=evidence_ids,
            confidence=confidence,
        )
    elif verdict == "partially_equivalent":
        return EvaluationResult(
            verdict="partially_equivalent",
            score=0.5,
            is_uncertain=False,
            status="partial",
            reason="Learner answer captured part of the required concepts.",
            parsed_data=parsed,
            matched_concepts=matched_concepts,
            missing_concepts=missing_concepts,
            evidence_passage_ids=evidence_ids,
            confidence=confidence,
        )
    elif verdict == "incorrect":
        return EvaluationResult(
            verdict="incorrect",
            score=0.0,
            is_uncertain=False,
            status="rejected",
            reason="Learner answer does not match required concepts.",
            parsed_data=parsed,
            matched_concepts=matched_concepts,
            missing_concepts=missing_concepts,
            evidence_passage_ids=evidence_ids,
            confidence=confidence,
        )
    elif verdict == "ambiguous":
        return EvaluationResult(
            verdict="ambiguous",
            score=0.0,
            is_uncertain=True,
            status="uncertain",
            reason="Answer is ambiguous; prompt learner to review official canonical answer.",
            parsed_data=parsed,
            matched_concepts=matched_concepts,
            missing_concepts=missing_concepts,
            evidence_passage_ids=evidence_ids,
            confidence=confidence,
        )
    else:
        return EvaluationResult(
            verdict="uncertain",
            score=0.0,
            is_uncertain=True,
            status="uncertain",
            reason=f"Unrecognized verdict value: '{verdict}'.",
            parsed_data=parsed,
            matched_concepts=matched_concepts,
            missing_concepts=missing_concepts,
            evidence_passage_ids=evidence_ids,
            confidence=confidence,
        )
