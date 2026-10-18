"""Iterative RAG Evidence Search & Deep Justification Engine.

Searches `content_pack.db` across 3 progressive retrieval tiers:
- Tier 1: Exact Provenance Direct Link (`question_passages`)
- Tier 2: Strict FTS5 BM25 Search (`AND`-joined canonical answer + stem terms)
- Tier 3: Broad FTS5 BM25 Fallback (`OR`-joined terms & distractor-aware keyword search)

Formats grounded, sanitized prompts for on-device and local LLM inference
enforcing exact page citations, step-by-step proof, distractor elimination,
and zero-hallucination fallback.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from ai_tutor_training.prompting import sanitize_data_content

# Common English and Filipino stop words to ignore in FTS5 search queries
STOP_WORDS: set[str] = {
    # English stop words
    "the", "is", "in", "at", "of", "on", "and", "a", "an", "to", "for", "with", "under",
    "which", "what", "who", "whom", "how", "many", "following", "all", "are", "be", "by",
    "from", "have", "been", "does", "were", "will", "would", "should", "could", "this",
    "that", "these", "those", "into", "onto", "upon", "about", "above", "below",
    # Filipino stop words
    "ang", "mga", "sa", "ng", "nang", "ay", "at", "na", "ito", "ni", "kay", "para",
    "alin", "ano", "sino", "paano", "kailan", "bakit", "saan", "piliin", "tamang",
    "salita", "salitang", "lahat", "bilang", "ayon", "dahil", "kung", "kapag", "upang",
    "noon", "ngayon", "iba", "ibang", "nasa", "may", "mayroon", "wala", "walang",
}


@dataclass
class RetrievedEvidence:
    """Represents a single textbook passage retrieved as proof."""

    passage_id: str
    chapter: str
    section: str | None
    start_page: int
    end_page: int
    text: str
    retrieval_tier: str  # e.g., "Tier 1: Direct Page Link", "Tier 2: Strict FTS5 BM25", "Tier 3: Broad FTS5 BM25"
    bm25_score: float = 0.0


@dataclass
class JustificationResult:
    """Holds the complete trace of the iterative search and the final LLM justification prompt/output."""

    question_id: str
    stem: str
    canonical_answer: str
    iterations_run: list[str] = field(default_factory=list)
    evidence_found: list[RetrievedEvidence] = field(default_factory=list)
    final_prompt: str = ""
    llm_explanation: str | None = None


def extract_search_keywords(text: str, max_keywords: int = 6) -> list[str]:
    """Extract clean alphanumeric keywords from text for FTS5 search."""
    if not text:
        return []
    words = re.findall(r"[\w]+", text.lower(), flags=re.UNICODE)
    keywords: list[str] = []
    for w in words:
        if len(w) >= 3 and w not in STOP_WORDS and w not in keywords:
            keywords.append(w)
        if len(keywords) >= max_keywords:
            break
    return keywords


class IterativeRAGJustifier:
    """Iteratively searches `content_pack.db` across 3 progressive tiers to justify an answer."""

    def __init__(self, db_path: Path | str, max_evidence_passages: int = 2) -> None:
        self.db_path = Path(db_path)
        if not self.db_path.exists():
            raise FileNotFoundError(f"Content pack database not found: {self.db_path}")
        self.max_evidence_passages = max_evidence_passages

    def _get_question_record(self, conn: sqlite3.Connection, question_id: str) -> dict[str, Any]:
        """Load question, choices, and canonical answer from SQLite."""
        cursor = conn.cursor()
        row = cursor.execute(
            """
            SELECT q.id, q.stem, q.canonical_explanation, q.source_page,
                   qa.canonical_answer, c.choice_key
            FROM questions q
            LEFT JOIN question_answers qa ON qa.question_id = q.id
            LEFT JOIN choices c ON c.id = qa.canonical_choice_id
            WHERE q.id = ?;
            """,
            (question_id,),
        ).fetchone()

        if not row:
            raise ValueError(f"Question ID '{question_id}' not found in {self.db_path}")

        choices_rows = cursor.execute(
            "SELECT choice_key, text FROM choices WHERE question_id = ? ORDER BY sort_order ASC;",
            (question_id,),
        ).fetchall()

        return {
            "question_id": row[0],
            "stem": row[1],
            "canonical_explanation": row[2],
            "source_page": row[3],
            "canonical_answer": row[4] or "Unknown",
            "canonical_choice_key": row[5],
            "choices": [{"key": r[0], "text": r[1]} for r in choices_rows],
        }

    def extract_distractor_keywords(
        self,
        question_data: dict[str, Any],
        target_choice_key: str,
        max_keywords: int = 4,
    ) -> list[str]:
        """Extract search keywords from a specific distractor choice text."""
        norm_key = target_choice_key.strip().upper()
        for c in question_data.get("choices", []):
            if c["key"].strip().upper() == norm_key:
                return extract_search_keywords(c["text"], max_keywords=max_keywords)
        return []

    def retrieve_evidence_iteratively(
        self,
        question_id: str,
        follow_up_query: str | None = None,
        distractor_choice_key: str | None = None,
    ) -> tuple[dict[str, Any], list[RetrievedEvidence], list[str]]:
        """Run up to 3 iterative search passes to gather the best supporting textbook passages.

        Returns:
            (question_data, evidence_list, iterations_log)
        """
        conn = sqlite3.connect(str(self.db_path))
        try:
            q_data = self._get_question_record(conn, question_id)
            cursor = conn.cursor()

            evidence_list: list[RetrievedEvidence] = []
            seen_ids: set[str] = set()
            iterations_log: list[str] = []

            # -----------------------------------------------------------------
            # Iteration 1: Tier 1 Direct Question-Passage Provenance Link
            # -----------------------------------------------------------------
            iterations_log.append("Iteration 1: Checking Tier 1 direct `question_passages` link.")
            tier1_rows = cursor.execute(
                """
                SELECT p.id, p.chapter, p.section, p.start_page, p.end_page, p.text, qp.confidence
                FROM question_passages qp
                JOIN passages p ON p.id = qp.passage_id
                WHERE qp.question_id = ?
                ORDER BY CASE qp.confidence
                    WHEN 'verified' THEN 1
                    WHEN 'high' THEN 2
                    WHEN 'low' THEN 3
                    ELSE 4
                END ASC
                LIMIT ?;
                """,
                (question_id, self.max_evidence_passages),
            ).fetchall()

            for r in tier1_rows:
                if r[0] not in seen_ids and len(evidence_list) < self.max_evidence_passages:
                    seen_ids.add(r[0])
                    evidence_list.append(
                        RetrievedEvidence(
                            passage_id=r[0],
                            chapter=r[1],
                            section=r[2],
                            start_page=r[3],
                            end_page=r[4],
                            text=r[5],
                            retrieval_tier="Tier 1: Direct Page Link",
                            bm25_score=0.0,
                        )
                    )

            # -----------------------------------------------------------------
            # Iteration 2: Tier 2 Strict FTS5 BM25 Search (AND Keywords)
            # -----------------------------------------------------------------
            # Triggered if more passages are needed or if a specific follow-up query was submitted
            if len(evidence_list) < self.max_evidence_passages or follow_up_query:
                search_source = follow_up_query or f"{q_data['canonical_answer']} {q_data['stem']}"
                keywords = extract_search_keywords(search_source, max_keywords=4)

                if keywords:
                    strict_fts_query = " AND ".join(f'"{kw}"' for kw in keywords[:3])
                    iterations_log.append(
                        f"Iteration 2: Running Strict FTS5 BM25 search with query: {strict_fts_query}"
                    )
                    try:
                        tier2_rows = cursor.execute(
                            """
                            SELECT p.id, p.chapter, p.section, p.start_page, p.end_page, p.text,
                                   bm25(passages_fts) as rank
                            FROM passages_fts fts
                            JOIN passages p ON p.rowid = fts.rowid
                            WHERE passages_fts MATCH ?
                            ORDER BY rank ASC
                            LIMIT ?;
                            """,
                            (strict_fts_query, self.max_evidence_passages + len(seen_ids)),
                        ).fetchall()

                        for r in tier2_rows:
                            if r[0] not in seen_ids and len(evidence_list) < self.max_evidence_passages:
                                seen_ids.add(r[0])
                                evidence_list.append(
                                    RetrievedEvidence(
                                        passage_id=r[0],
                                        chapter=r[1],
                                        section=r[2],
                                        start_page=r[3],
                                        end_page=r[4],
                                        text=r[5],
                                        retrieval_tier="Tier 2: Strict FTS5 BM25",
                                        bm25_score=float(r[6]),
                                    )
                                )
                    except sqlite3.OperationalError as e:
                        iterations_log.append(f"Iteration 2 note: FTS5 query degraded: {e}")

            # -----------------------------------------------------------------
            # Iteration 3: Tier 3 Broad FTS5 BM25 Fallback & Distractor-Aware Search
            # -----------------------------------------------------------------
            if len(evidence_list) < self.max_evidence_passages:
                # Detect distractor from argument or follow-up query text (e.g. "Choice B" or "option c")
                target_choice = distractor_choice_key
                if not target_choice and follow_up_query:
                    match = re.search(r"\b(?:choice|option)\s+([A-Da-d])\b", follow_up_query, re.IGNORECASE)
                    if match:
                        target_choice = match.group(1).upper()

                distractor_keywords: list[str] = []
                if target_choice:
                    distractor_keywords = self.extract_distractor_keywords(q_data, target_choice, max_keywords=3)

                search_source = follow_up_query or f"{q_data['canonical_answer']} {q_data['stem']}"
                general_keywords = extract_search_keywords(search_source, max_keywords=6)

                combined_keywords = distractor_keywords + [k for k in general_keywords if k not in distractor_keywords]

                if combined_keywords:
                    broad_fts_query = " OR ".join(f'"{kw}"' for kw in combined_keywords[:6])
                    iterations_log.append(
                        f"Iteration 3: Running Broad FTS5 BM25 fallback with query: {broad_fts_query}"
                    )
                    try:
                        tier3_rows = cursor.execute(
                            """
                            SELECT p.id, p.chapter, p.section, p.start_page, p.end_page, p.text,
                                   bm25(passages_fts) as rank
                            FROM passages_fts fts
                            JOIN passages p ON p.rowid = fts.rowid
                            WHERE passages_fts MATCH ?
                            ORDER BY rank ASC
                            LIMIT ?;
                            """,
                            (broad_fts_query, self.max_evidence_passages + len(seen_ids)),
                        ).fetchall()

                        for r in tier3_rows:
                            if r[0] not in seen_ids and len(evidence_list) < self.max_evidence_passages:
                                seen_ids.add(r[0])
                                evidence_list.append(
                                    RetrievedEvidence(
                                        passage_id=r[0],
                                        chapter=r[1],
                                        section=r[2],
                                        start_page=r[3],
                                        end_page=r[4],
                                        text=r[5],
                                        retrieval_tier="Tier 3: Broad FTS5 BM25",
                                        bm25_score=float(r[6]),
                                    )
                                )
                    except sqlite3.OperationalError as e:
                        iterations_log.append(f"Iteration 3 note: FTS5 query degraded: {e}")

            return q_data, evidence_list, iterations_log
        finally:
            conn.close()

    def build_deep_justification_prompt(
        self,
        q_data: dict[str, Any],
        evidence_list: list[RetrievedEvidence],
        follow_up_query: str | None = None,
        distractor_choice_key: str | None = None,
    ) -> str:
        """Build a grounded prompt instructing the local LLM to prove the answer from the retrieved passages."""
        clean_stem = sanitize_data_content(q_data["stem"])
        clean_answer = sanitize_data_content(str(q_data["canonical_answer"]))
        clean_expl = sanitize_data_content(str(q_data.get("canonical_explanation") or "None provided."))

        choices_formatted = ""
        if q_data.get("choices"):
            choices_formatted = "\n".join(
                f"  {c['key']}. {sanitize_data_content(c['text'])}" for c in q_data["choices"]
            )

        if evidence_list:
            excerpts_blocks = []
            for ev in evidence_list:
                clean_p_text = sanitize_data_content(ev.text)
                excerpts_blocks.append(
                    f"[EXCERPT: {ev.passage_id} | {ev.chapter} | Page {ev.start_page} | {ev.retrieval_tier}]:\n"
                    f"{clean_p_text}"
                )
            context_section = "\n\n".join(excerpts_blocks)
        else:
            context_section = "[NO MATCHING TEXTBOOK PASSAGES FOUND IN DATABASE]"

        follow_up_block = ""
        if follow_up_query:
            clean_follow_up = sanitize_data_content(follow_up_query)
            follow_up_block = f"\nLearner Follow-Up Question: {clean_follow_up}\n"

        distractor_directive = ""
        if distractor_choice_key:
            clean_dk = sanitize_data_content(distractor_choice_key.upper())
            distractor_directive = f" Specifically clarify why Choice [{clean_dk}] is not the correct answer."

        prompt = (
            "<system>\n"
            "You are an expert tutor for the Philippine Civil Service Examination.\n"
            "Your task is to provide a grounded, step-by-step justification proving WHY the Official Answer "
            "is correct, strictly using the provided textbook excerpts in <context>.\n"
            "Rules:\n"
            "1. [DIRECT PROOF]: Quote or cite the exact rule, constitutional provision, or law from the excerpt and include [Page X].\n"
            "2. [STEP-BY-STEP REASONING]: Explain how the rule directly proves the Official Answer.\n"
            "3. [DISTRACTOR ELIMINATION]: Briefly clarify why the other choices do not fit."
            f"{distractor_directive}\n"
            "4. If the excerpt lacks sufficient detail to prove the answer, state clearly: "
            '"Ang ibinigay na sanggunian ay walang sapat na detalye upang ipaliwanag ito nang buo."\n'
            "5. Keep your explanation concise (under 150 words), pedagogical, and clear in English or Filipino as appropriate.\n"
            "</system>\n\n"
            "<context>\n"
            f"{context_section}\n"
            "</context>\n\n"
            "<task>\n"
            f"Question: {clean_stem}\n"
            f"{choices_formatted}\n"
            f"Official Answer: {clean_answer}\n"
            f"Official Note: {clean_expl}\n"
            f"{follow_up_block}"
            "Provide the step-by-step proof and justification:\n"
            "</task>"
        )
        return prompt

    def justify_answer(
        self,
        question_id: str,
        follow_up_query: str | None = None,
        distractor_choice_key: str | None = None,
        llm_inference_fn: Callable[[str], str] | None = None,
    ) -> JustificationResult:
        """Execute the full 3-tier iterative retrieval and optional LLM inference."""
        q_data, evidence, iterations = self.retrieve_evidence_iteratively(
            question_id=question_id,
            follow_up_query=follow_up_query,
            distractor_choice_key=distractor_choice_key,
        )
        prompt = self.build_deep_justification_prompt(
            q_data=q_data,
            evidence_list=evidence,
            follow_up_query=follow_up_query,
            distractor_choice_key=distractor_choice_key,
        )

        llm_output = llm_inference_fn(prompt) if llm_inference_fn is not None else None

        return JustificationResult(
            question_id=question_id,
            stem=q_data["stem"],
            canonical_answer=q_data["canonical_answer"],
            iterations_run=iterations,
            evidence_found=evidence,
            final_prompt=prompt,
            llm_explanation=llm_output,
        )

