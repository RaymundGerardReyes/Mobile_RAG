"""Prompt engineering and template builders for on-device LLM features."""

from __future__ import annotations

import re
from typing import Any

EXPLAIN_SYSTEM_PROMPT = (
    "You are an expert tutor for the Philippine Civil Service Examination.\n"
    "Your task is to explain why the official answer is correct, strictly using the provided textbook excerpt.\n"
    "Rules:\n"
    "1. Rely ONLY on facts stated in the [EXCERPT]. Do NOT invent facts or cite external knowledge.\n"
    '2. If the excerpt does not contain enough evidence, state clearly: "Ang ibinigay na sanggunian ay walang sapat na detalye upang ipaliwanag ito nang buo."\n'
    "3. Keep your explanation concise (under 120 words), pedagogical, and clear in English or Filipino as appropriate.\n"
    "4. Reference the provided page number."
)

FREE_ANSWER_SYSTEM_PROMPT = (
    "You are an expert evaluator for the Philippine Civil Service Examination.\n"
    "Your task is to interpret a learner's free-text response against the official answer and textbook rubrics.\n"
    "Evaluate whether the learner's answer expresses semantic equivalence to the official answer.\n"
    "You MUST respond ONLY with a single, valid JSON object matching the required schema.\n"
    "Do NOT include markdown formatting (like ```json), explanations, or preamble."
)


def sanitize_data_content(text: str) -> str:
    """Sanitize user or passage content injected into prompts to prevent prompt injection."""
    if not text:
        return ""
    # Strip dangerous XML-like delimiter tags that could break out of context boundaries
    sanitized = re.sub(r"<\/?(?:system|context|task|excerpt|prompt)>", "", text, flags=re.IGNORECASE)
    return sanitized.strip()


def build_explain_prompt(
    stem: str,
    canonical_answer: str,
    canonical_explanation: str | None = None,
    source_page: int = 1,
    passage_text: str = "",
    max_passage_words: int = 250,
) -> str:
    """Build grounded ExplainMore prompt adhering to logic_and_implementation_guide.md §2.

    Budget: prompt text capped to remain well within 1,024 prompt tokens.
    Source text is treated strictly as DATA, not instruction.
    """
    clean_stem = sanitize_data_content(stem)
    clean_answer = sanitize_data_content(canonical_answer)
    clean_note = sanitize_data_content(canonical_explanation or "None provided.")
    clean_passage = sanitize_data_content(passage_text)

    # Word budget clamp on passage text to prevent context overflow
    words = clean_passage.split()
    if len(words) > max_passage_words:
        clean_passage = " ".join(words[:max_passage_words]) + "..."

    prompt = (
        f"<system>\n"
        f"{EXPLAIN_SYSTEM_PROMPT}\n"
        f"</system>\n\n"
        f"<context>\n"
        f"[EXCERPT (Page {source_page})]:\n"
        f"{clean_passage}\n"
        f"</context>\n\n"
        f"<task>\n"
        f"Question: {clean_stem}\n"
        f"Official Answer: {clean_answer}\n"
        f"Official Note: {clean_note}\n\n"
        f"Explain why this answer is correct based on the excerpt:\n"
        f"</task>"
    )
    return prompt


def build_free_answer_prompt(
    stem: str,
    canonical_answer: str,
    user_answer: str,
    passages: list[dict[str, Any]] | None = None,
) -> str:
    """Build structured FreeAnswer evaluation prompt adhering to logic_and_implementation_guide.md §3."""
    clean_stem = sanitize_data_content(stem)
    clean_canonical = sanitize_data_content(canonical_answer)
    clean_user = sanitize_data_content(user_answer)

    passages_block = ""
    if passages:
        passages_lines = []
        for p in passages:
            p_id = p.get("id") or p.get("passage_id", "p0000")
            p_text = sanitize_data_content(p.get("text", ""))
            p_page = p.get("start_page", 1)
            passages_lines.append(f"- Passage ID [{p_id}] (Page {p_page}): {p_text}")
        passages_block = "\n".join(passages_lines)
    else:
        passages_block = "No direct passage excerpts available."

    schema_instruction = (
        '{\n'
        '  "verdict": "equivalent" | "partially_equivalent" | "incorrect" | "ambiguous",\n'
        '  "matched_concepts": ["concept1", ...],\n'
        '  "missing_concepts": ["concept2", ...],\n'
        '  "evidence_passage_ids": ["passage_id", ...],\n'
        '  "confidence": 0.0 to 1.0\n'
        '}'
    )

    prompt = (
        f"<system>\n"
        f"{FREE_ANSWER_SYSTEM_PROMPT}\n"
        f"</system>\n\n"
        f"<context>\n"
        f"[REFERENCE PASSAGES]:\n"
        f"{passages_block}\n"
        f"</context>\n\n"
        f"<task>\n"
        f"Question: {clean_stem}\n"
        f"Canonical Official Answer: {clean_canonical}\n"
        f"Learner Response: {clean_user}\n\n"
        f"Required JSON Output format:\n"
        f"{schema_instruction}\n"
        f"</task>"
    )
    return prompt
