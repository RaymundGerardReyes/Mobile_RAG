"""Regression tests defending against historical bugs and hardening edge cases.

Covers:
1. Multi-page answer key state persistence across page boundaries.
2. Ambiguous cross-chapter fallback confidence downgrade to 'unresolved'.
3. Atomic file replacement with os.replace under Windows file access conditions.

Marked with @pytest.mark.regression.
"""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any

import pytest

from ai_tutor_training.content_pack import build_content_pack
from ai_tutor_training.provenance import save_stage_manifest
from ai_tutor_training.stages.build_passages import build_passages
from ai_tutor_training.stages.extract_textbook import extract_textbook
from ai_tutor_training.stages.link_qa_pairs import link_qa_pairs, parse_answer_keys


# ---------------------------------------------------------------------------
# 1. Multi-Page Answer Key Continuation Regression Tests
# ---------------------------------------------------------------------------

@pytest.mark.regression
class TestMultiPageAnswerKeyContinuation:
    """Verify answer key state persists across page transitions until explicitly closed."""

    def test_parse_answer_keys_persists_across_pages(self) -> None:
        """Answer key starting on page 10 continues onto page 11 & 12, closed on page 13."""
        pages = [
            {
                "page_number": 10,
                "chapter": "Chapter 1",
                "text": "Answer Key\n1 - A\n2 - B\n3 - C",
            },
            {
                "page_number": 11,
                "chapter": "Chapter 1",
                # Note: No "Answer Key" header on this continuation page
                "text": "4 - D\n5 - A\n6 - B",
            },
            {
                "page_number": 12,
                "chapter": "Chapter 1",
                # Note: Still in answer key
                "text": "7 - C\n8 - D",
            },
            {
                "page_number": 13,
                "chapter": "Chapter 2",
                # Heading closes answer key section
                "text": "CHAPTER 2: Public Accountability\n1. What is public trust?\nA. Duty\nB. Honor\nC. Pride\nD. Power",
            },
        ]

        header_patterns = [r"(?i)(?:answer\s+key|susi\s+sa\s+pagwawasto)"]
        item_patterns = [r"(\d{1,4})\s*[-–—:]\s*([A-Da-d])\b"]

        chapter_keys, global_keys = parse_answer_keys(pages, header_patterns, item_patterns)

        # All 8 answer keys from Chapter 1 must be captured across pages 10, 11, 12
        assert len(chapter_keys) == 8
        assert chapter_keys[("Chapter 1", 1)] == ("A", 10)
        assert chapter_keys[("Chapter 1", 2)] == ("B", 10)
        assert chapter_keys[("Chapter 1", 3)] == ("C", 10)
        assert chapter_keys[("Chapter 1", 4)] == ("D", 11)
        assert chapter_keys[("Chapter 1", 5)] == ("A", 11)
        assert chapter_keys[("Chapter 1", 6)] == ("B", 11)
        assert chapter_keys[("Chapter 1", 7)] == ("C", 12)
        assert chapter_keys[("Chapter 1", 8)] == ("D", 12)

    def test_link_qa_pairs_multi_page_answers_linked_completely(self, tmp_path: Path) -> None:
        """Full link_qa_pairs execution verifying questions match continuation answers."""
        pages = [
            {
                "page_number": 1,
                "chapter": "Chapter 1",
                "text": (
                    "1. First question?\nA. Ans 1\nB. Ans 2\nC. Ans 3\nD. Ans 4\n"
                    "2. Second question?\nA. Ans 1\nB. Ans 2\nC. Ans 3\nD. Ans 4\n"
                    "3. Third question?\nA. Ans 1\nB. Ans 2\nC. Ans 3\nD. Ans 4\n"
                    "4. Fourth question?\nA. Ans 1\nB. Ans 2\nC. Ans 3\nD. Ans 4\n"
                ),
            },
            {
                "page_number": 2,
                "chapter": "Chapter 1",
                "text": "Answer Key\n1 - A\n2 - B",
            },
            {
                "page_number": 3,
                "chapter": "Chapter 1",
                # Multi-page continuation of answer key without header
                "text": "3 - C\n4 - D",
            },
            {
                "page_number": 4,
                "chapter": "Chapter 2",
                # New chapter restarts regular parsing
                "text": "CHAPTER 2: Ethics\n1. Question in chapter 2?\nA. Ans 1\nB. Ans 2\nC. Ans 3\nD. Ans 4",
            },
        ]

        out_f = tmp_path / "linked.jsonl"
        records = link_qa_pairs(pages, output_path=out_f)

        # 4 questions in Chapter 1 + 1 question in Chapter 2 = 5 questions
        assert len(records) == 5

        # Verify all 4 questions in Chapter 1 are verified with no dropped answers
        q1 = next(r for r in records if r["stem"] == "First question?")
        assert q1["canonical_choice_key"] == "A"
        assert q1["link_confidence"] == "verified"
        assert q1["answer_key_page"] == 2

        q2 = next(r for r in records if r["stem"] == "Second question?")
        assert q2["canonical_choice_key"] == "B"
        assert q2["link_confidence"] == "verified"
        assert q2["answer_key_page"] == 2

        q3 = next(r for r in records if r["stem"] == "Third question?")
        assert q3["canonical_choice_key"] == "C"
        assert q3["link_confidence"] == "verified"
        assert q3["answer_key_page"] == 3  # From continuation page 3!

        q4 = next(r for r in records if r["stem"] == "Fourth question?")
        assert q4["canonical_choice_key"] == "D"
        assert q4["link_confidence"] == "verified"
        assert q4["answer_key_page"] == 3  # From continuation page 3!

    def test_answer_key_with_period_formatting_not_parsed_as_questions(self, tmp_path: Path) -> None:
        """Period-delimited answer keys ('1. A') must not terminate the section or produce phantom questions."""
        pages = [
            {
                "page_number": 1,
                "chapter": "Chapter 1",
                "text": "1. What is the fundamental charter?\nA. Constitution\nB. Civil Code\nC. Penal Code\nD. Rules",
            },
            {
                "page_number": 2,
                "chapter": "Chapter 1",
                "text": "Answer Key\n1. A\n2. B\n3. C",
            },
        ]
        out_f = tmp_path / "linked.jsonl"
        records = link_qa_pairs(pages, output_path=out_f)
        # Exactly 1 question; 2. B and 3. C must NOT be parsed as questions
        assert len(records) == 1
        assert records[0]["stem"] == "What is the fundamental charter?"
        assert records[0]["canonical_choice_key"] == "A"
        assert records[0]["link_confidence"] == "verified"

    def test_chapter_heading_with_letter_ad_closes_answer_key(self, tmp_path: Path) -> None:
        """Chapter heading like 'CHAPTER 2: Administrative Ethics' must close answer key without being parsed as item 2=A."""
        pages = [
            {
                "page_number": 1,
                "chapter": "Chapter 1",
                "text": "Answer Key\n1 - C",
            },
            {
                "page_number": 2,
                "chapter": "Chapter 2",
                "text": "CHAPTER 2: Administrative Ethics\n1. What is administrative ethics?\nA. Code\nB. Law\nC. Custom\nD. Rule\nAnswer: A",
            },
        ]
        out_f = tmp_path / "linked.jsonl"
        records = link_qa_pairs(pages, output_path=out_f)
        assert len(records) == 1
        # Item 1 in Chapter 2 must not be bound to Chapter 1's answer key (which had 1 - C)
        assert records[0]["stem"] == "What is administrative ethics?"
        assert records[0]["canonical_choice_key"] == "A"

    def test_direct_question_closes_continuation_without_chapter_heading(self, tmp_path: Path) -> None:
        """A new question stem appearing directly after an answer key closes the answer key section."""
        pages = [
            {
                "page_number": 1,
                "chapter": "Review",
                "text": "Answer Key\n1 - A\n2 - B",
            },
            {
                "page_number": 2,
                "chapter": "Review",
                # Question starts directly without repeated chapter header
                "text": "1. What is honesty?\nA. Virtue\nB. Vice\nC. Crime\nD. Flaw\nAnswer: A",
            },
        ]
        out_f = tmp_path / "linked.jsonl"
        records = link_qa_pairs(pages, output_path=out_f)
        assert len(records) == 1
        assert records[0]["stem"] == "What is honesty?"
        assert records[0]["canonical_choice_key"] == "A"


# ---------------------------------------------------------------------------
# 2. Ambiguous Cross-Chapter Fallback Regression Tests
# ---------------------------------------------------------------------------

@pytest.mark.regression
class TestAmbiguousCrossChapterFallback:
    """Verify collision detection and confidence downgrade during global question matching."""

    def test_ambiguous_question_match_downgraded_to_unresolved(self, tmp_path: Path) -> None:
        """When an unassociated question number matches multiple candidate chapters in global fallback."""
        pages = [
            {
                "page_number": 1,
                "chapter": "History",
                "text": "Answer Key\n10 - A",
            },
            {
                "page_number": 2,
                "chapter": "Economics",
                "text": "Answer Key\n10 - C",
            },
            {
                "page_number": 3,
                "chapter": "General Review",  # Doesn't match History or Economics
                "text": "10. Which policy is implemented?\nA. Policy 1\nB. Policy 2\nC. Policy 3\nD. Policy 4",
            },
        ]

        out_f = tmp_path / "linked.jsonl"
        records = link_qa_pairs(pages, output_path=out_f)

        assert len(records) == 1
        q = records[0]
        # Must be downgraded to unresolved due to ambiguity between History and Economics
        assert q["link_confidence"] == "unresolved"
        assert q["canonical_choice_key"] is None
        assert q["canonical_answer"] is None
        assert any("Ambiguous answer key match across multiple chapters" in w for w in q["link_warnings"])

    def test_unambiguous_global_fallback_succeeds(self, tmp_path: Path) -> None:
        """When an unassociated question number matches exactly one chapter globally."""
        pages = [
            {
                "page_number": 1,
                "chapter": "History",
                "text": "Answer Key\n10 - A",
            },
            {
                "page_number": 2,
                "chapter": "Economics",
                "text": "Answer Key\n20 - C",
            },
            {
                "page_number": 3,
                "chapter": "General Review",
                "text": "10. Question ten?\nA. Alpha\nB. Beta\nC. Gamma\nD. Delta",
            },
        ]

        out_f = tmp_path / "linked.jsonl"
        records = link_qa_pairs(pages, output_path=out_f)

        assert len(records) == 1
        q = records[0]
        # Only History has item 10, so unambiguous match succeeds
        assert q["canonical_choice_key"] == "A"
        assert q["canonical_answer"] == "Alpha"
        assert q["link_confidence"] == "verified"


# ---------------------------------------------------------------------------
# 3. Concurrent File Locking & Atomic Replacement Regression Tests
# ---------------------------------------------------------------------------

@pytest.mark.regression
class TestAtomicFileReplacement:
    """Verify atomic file replacement using os.replace under Windows filesystem conditions."""

    def test_os_replace_overwrites_existing_file(self, tmp_path: Path) -> None:
        target_file = tmp_path / "target.jsonl"
        target_file.write_text("original content\n", encoding="utf-8")

        temp_file = tmp_path / "target.jsonl.tmp.12345"
        temp_file.write_text("new atomic content\n", encoding="utf-8")

        # Built-in os.replace atomically replaces target_file
        os.replace(temp_file, target_file)

        assert target_file.read_text(encoding="utf-8") == "new atomic content\n"
        assert not temp_file.exists()

    def test_stage_manifest_atomic_save_under_existing(self, tmp_path: Path) -> None:
        man_path = tmp_path / "stage_manifest.json"
        man_path.write_text('{"old": true}', encoding="utf-8")

        manifest = {"stage": "test", "status": "success", "record_count": 100}
        save_stage_manifest(manifest, man_path)

        with man_path.open("r", encoding="utf-8") as f:
            loaded = json.load(f)
        assert loaded["status"] == "success"
        assert loaded["record_count"] == 100

    def test_content_pack_atomic_replace_existing_db(self, tmp_path: Path) -> None:
        q_path = tmp_path / "q.jsonl"
        p_path = tmp_path / "p.jsonl"
        db_path = tmp_path / "pack.db"

        # Pre-seed DB
        conn = sqlite3.connect(str(db_path))
        conn.execute("CREATE TABLE dummy (id INT);")
        conn.commit()
        conn.close()

        q_path.write_text("", encoding="utf-8")
        p_path.write_text("", encoding="utf-8")

        # Overwrite with build_content_pack
        build_content_pack(q_path, p_path, output_db_path=db_path)
        assert db_path.exists()

        # Check that dummy table is gone and proper schema is in place
        conn2 = sqlite3.connect(str(db_path))
        tables = [r[0] for r in conn2.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()]
        conn2.close()
        assert "dummy" not in tables
        assert "passages" in tables
        assert "questions" in tables
