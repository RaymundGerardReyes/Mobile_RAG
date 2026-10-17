"""Basis Path Testing (White-Box) for all stages in the AI Tutor training pipeline.

Tests linearly independent paths through the control flow graphs (CFG) of:
1. Stage 1: extract_textbook
2. Stage 2: link_qa_pairs
3. Stage 3: build_passages
4. Content Pack: build_content_pack

Marked with @pytest.mark.path.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from ai_tutor_training.content_pack import build_content_pack
from ai_tutor_training.stages.build_passages import build_passages
from ai_tutor_training.stages.extract_textbook import extract_page_headings, extract_textbook
from ai_tutor_training.stages.link_qa_pairs import link_qa_pairs


# ---------------------------------------------------------------------------
# 1. extract_textbook Basis Paths
# ---------------------------------------------------------------------------

@pytest.mark.path
class TestExtractTextbookPaths:
    """Linearly independent execution paths for extract_textbook."""

    def test_path_1_missing_pdf_raises_filenotfound(self, tmp_path: Path) -> None:
        missing_pdf = tmp_path / "non_existent.pdf"
        with pytest.raises(FileNotFoundError, match="Source PDF does not exist"):
            extract_textbook(missing_pdf)

    def test_path_2_3_normal_pdf_headings_detection(self, sample_pdf: Path, tmp_path: Path) -> None:
        out_f = tmp_path / "extracted_pages.jsonl"
        man_f = tmp_path / "extract_manifest.json"

        pages = extract_textbook(sample_pdf, output_path=out_f, manifest_path=man_f)
        assert len(pages) > 0
        assert out_f.exists()
        assert man_f.exists()

        # Path 2: At least one page has chapter detected
        has_chap = any(p["chapter"] is not None for p in pages)
        assert has_chap

        # Path 3: At least one page has section detected
        has_sec = any(p["section"] is not None for p in pages)
        assert has_sec

    def test_path_4_empty_text_page(self, tmp_path: Path) -> None:
        # Test extract_page_headings on empty/whitespace page
        chap, sec, detected = extract_page_headings("", [], [])
        assert chap is None
        assert sec is None
        assert detected == []

    def test_path_5_chapter_context_carried_forward(self, sample_pdf: Path, tmp_path: Path) -> None:
        pages = extract_textbook(sample_pdf, output_path=tmp_path / "out.jsonl")
        # Check that subsequent pages after page 1 inherit chapter context if not redefined
        assert pages[0]["chapter"] is not None
        # Page 2 should carry forward Chapter 1
        assert pages[1]["chapter"] is not None

    def test_path_6_custom_regex_config(self, sample_pdf: Path, tmp_path: Path) -> None:
        custom_cfg = {
            "extract_textbook": {
                "chapter_heading_patterns": [r"^(?:CUSTOM_CHAP)\s*(.*)"],
                "section_heading_patterns": [r"^(?:CUSTOM_SEC)\s*(.*)"],
            }
        }
        pages = extract_textbook(
            sample_pdf, config=custom_cfg, output_path=tmp_path / "custom_out.jsonl"
        )
        assert len(pages) > 0
        # Custom pattern won't match standard headings in synthetic PDF
        assert pages[0]["chapter"] is None

    def test_path_7_custom_output_and_manifest_paths(self, sample_pdf: Path, tmp_path: Path) -> None:
        custom_out = tmp_path / "nested" / "pages.jsonl"
        custom_man = tmp_path / "nested" / "manifest.json"
        pages = extract_textbook(sample_pdf, output_path=custom_out, manifest_path=custom_man)
        assert custom_out.exists()
        assert custom_man.exists()
        assert len(pages) > 0

    def test_path_8_write_failure_cleans_temp_file(self, sample_pdf: Path, tmp_path: Path) -> None:
        out_f = tmp_path / "pages.jsonl"
        with patch("json.dumps", side_effect=RuntimeError("Simulated JSON serialization crash")):
            with pytest.raises(RuntimeError, match="Simulated JSON serialization crash"):
                extract_textbook(sample_pdf, output_path=out_f)
        # Verify no orphaned temp files remained
        tmp_files = list(tmp_path.glob("*.tmp.*"))
        assert len(tmp_files) == 0


# ---------------------------------------------------------------------------
# 2. link_qa_pairs Basis Paths
# ---------------------------------------------------------------------------

@pytest.mark.path
class TestLinkQAPairsPaths:
    """Linearly independent execution paths for link_qa_pairs."""

    def test_path_1_empty_pages_input(self, tmp_path: Path) -> None:
        out_f = tmp_path / "linked.jsonl"
        records = link_qa_pairs([], output_path=out_f)
        assert records == []
        assert out_f.exists()

    def test_path_2_exact_chapter_match(self, tmp_path: Path) -> None:
        pages = [
            {
                "page_number": 1,
                "chapter": "Chapter 1",
                "text": "1. What is the supreme law?\nA. Constitution\nB. Civil Code\nC. Penal Code\nD. Labor Code",
            },
            {
                "page_number": 2,
                "chapter": "Chapter 1",
                "text": "Answer Key\n1 - A",
            },
        ]
        records = link_qa_pairs(pages, output_path=tmp_path / "out.jsonl")
        assert len(records) == 1
        assert records[0]["canonical_choice_key"] == "A"
        assert records[0]["canonical_answer"] == "Constitution"
        assert records[0]["link_confidence"] == "verified"

    def test_path_3_normalized_chapter_match(self, tmp_path: Path) -> None:
        pages = [
            {
                "page_number": 1,
                "chapter": "Chapter 1: The Philippine Constitution",
                "text": "1. What is the supreme law?\nA. Constitution\nB. Civil Code\nC. Penal Code\nD. Labor Code",
            },
            {
                "page_number": 2,
                "chapter": "The Philippine Constitution",
                "text": "Answer Key\n1 - A",
            },
        ]
        records = link_qa_pairs(pages, output_path=tmp_path / "out.jsonl")
        assert len(records) == 1
        assert records[0]["canonical_choice_key"] == "A"
        assert records[0]["link_confidence"] == "verified"

    def test_path_4_global_fallback_unique(self, tmp_path: Path) -> None:
        # Question has chapter "Unknown Chapter", Answer key has chapter "Chapter 1"
        pages = [
            {
                "page_number": 1,
                "chapter": "Unknown Chapter",
                "text": "99. Unique test item?\nA. Opt 1\nB. Opt 2\nC. Opt 3\nD. Opt 4",
            },
            {
                "page_number": 2,
                "chapter": "Chapter 1",
                "text": "Answer Key\n99 - C",
            },
        ]
        records = link_qa_pairs(pages, output_path=tmp_path / "out.jsonl")
        assert len(records) == 1
        assert records[0]["canonical_choice_key"] == "C"
        assert records[0]["canonical_answer"] == "Opt 3"
        assert records[0]["link_confidence"] == "verified"

    def test_path_5_global_fallback_ambiguous_downgrade(self, tmp_path: Path) -> None:
        # Question has chapter "Miscellaneous"
        # Two different chapters have answer key for item 5!
        pages = [
            {
                "page_number": 1,
                "chapter": "Chapter A",
                "text": "Answer Key\n5 - A",
            },
            {
                "page_number": 2,
                "chapter": "Chapter B",
                "text": "Answer Key\n5 - D",
            },
            {
                "page_number": 3,
                "chapter": "Miscellaneous",
                "text": "5. Ambiguous question?\nA. One\nB. Two\nC. Three\nD. Four",
            },
        ]
        records = link_qa_pairs(pages, output_path=tmp_path / "out.jsonl")
        assert len(records) == 1
        q = records[0]
        # Ambiguous match across multiple chapters must be downgraded to 'unresolved'
        assert q["link_confidence"] == "unresolved"
        assert q["canonical_choice_key"] is None
        assert any("Ambiguous answer key match" in w for w in q["link_warnings"])

    def test_path_6_inline_answer(self, tmp_path: Path) -> None:
        pages = [
            {
                "page_number": 1,
                "chapter": "Chapter 1",
                "text": (
                    "1. What is the fundamental law?\n"
                    "A. Constitution\n"
                    "B. Statute\n"
                    "C. Ordinance\n"
                    "D. Decree\n"
                    "Answer: A"
                ),
            }
        ]
        records = link_qa_pairs(pages, output_path=tmp_path / "out.jsonl")
        assert len(records) == 1
        assert records[0]["canonical_choice_key"] == "A"
        assert records[0]["link_confidence"] == "high"

    def test_path_7_non_four_choices_emits_warning(self, tmp_path: Path) -> None:
        pages = [
            {
                "page_number": 1,
                "chapter": "Chapter 1",
                "text": (
                    "1. Question with three choices?\n"
                    "A. First\n"
                    "B. Second\n"
                    "C. Third\n"
                    "Answer: B"
                ),
            }
        ]
        records = link_qa_pairs(pages, output_path=tmp_path / "out.jsonl")
        assert len(records) == 1
        assert any("has 3 choices (expected 4)" in w for w in records[0]["link_warnings"])

    def test_path_8_identification_with_answer_key(self, tmp_path: Path) -> None:
        pages = [
            {
                "page_number": 1,
                "chapter": "Civil Service Law",
                "text": "4. Republic Act number of the Code of Conduct.",
            },
            {
                "page_number": 2,
                "chapter": "Civil Service Law",
                "text": "Answer Key\n4 - Republic Act 6713",
            },
        ]
        records = link_qa_pairs(pages, output_path=tmp_path / "out.jsonl")
        assert len(records) == 1
        assert records[0]["question_type"] == "identification"
        assert records[0]["canonical_answer"] == "Republic Act 6713"
        assert records[0]["link_confidence"] == "high"

    def test_path_9_identification_without_answer_key(self, tmp_path: Path) -> None:
        pages = [
            {
                "page_number": 1,
                "chapter": "Civil Service Law",
                "text": "10. Identify the government office in charge of civil servants.",
            }
        ]
        records = link_qa_pairs(pages, output_path=tmp_path / "out.jsonl")
        assert len(records) == 1
        assert records[0]["question_type"] == "identification"
        assert records[0]["canonical_answer"] is None
        assert records[0]["link_confidence"] == "unresolved"
        assert any("Identification item has no answer" in w for w in records[0]["link_warnings"])

    def test_path_10_essay_question(self, tmp_path: Path) -> None:
        pages = [
            {
                "page_number": 1,
                "chapter": "Constitutional Law",
                "text": "5. Explain the constitutional doctrine of separation of powers.",
            }
        ]
        records = link_qa_pairs(pages, output_path=tmp_path / "out.jsonl")
        assert len(records) == 1
        assert records[0]["question_type"] == "essay"
        assert records[0]["link_confidence"] == "low"
        assert "discussion" in records[0]["canonical_answer"].lower()

    def test_path_11_orphan_answer_key_emits_warning(self, tmp_path: Path) -> None:
        pages = [
            {
                "page_number": 1,
                "chapter": "Chapter 1",
                "text": "Answer Key\n1 - A\n99 - D",
            },
            {
                "page_number": 2,
                "chapter": "Chapter 1",
                "text": "1. What is X?\nA. Yes\nB. No\nC. Maybe\nD. Never",
            },
        ]
        out_f = tmp_path / "out.jsonl"
        man_f = tmp_path / "man.json"
        records = link_qa_pairs(pages, output_path=out_f, manifest_path=man_f)
        assert len(records) == 1
        with man_f.open("r", encoding="utf-8") as f:
            manifest = json.load(f)
        assert any("Orphan answer key" in w and "99" in w for w in manifest["warnings"])

    def test_path_12_answer_key_formatting_variants(self, tmp_path: Path) -> None:
        pages = [
            {
                "page_number": 1,
                "chapter": "Formats",
                "text": (
                    "1. Item 1?\nA. 1\nB. 2\nC. 3\nD. 4\n"
                    "2. Item 2?\nA. 1\nB. 2\nC. 3\nD. 4\n"
                    "3. Item 3?\nA. 1\nB. 2\nC. 3\nD. 4\n"
                ),
            },
            {
                "page_number": 2,
                "chapter": "Formats",
                "text": "Answer Key\n1 - A\n2. B\n3 C",
            },
        ]
        records = link_qa_pairs(pages, output_path=tmp_path / "out.jsonl")
        assert len(records) == 3
        assert records[0]["canonical_choice_key"] == "A"
        assert records[1]["canonical_choice_key"] == "B"
        assert records[2]["canonical_choice_key"] == "C"


# ---------------------------------------------------------------------------
# 3. build_passages Basis Paths
# ---------------------------------------------------------------------------

@pytest.mark.path
class TestBuildPassagesPaths:
    """Linearly independent execution paths for build_passages."""

    def test_path_1_empty_pages_input(self, tmp_path: Path) -> None:
        out_f = tmp_path / "passages.jsonl"
        passages = build_passages([], output_path=out_f)
        assert passages == []
        assert out_f.exists()

    def test_path_2_short_text_single_passage(self, tmp_path: Path) -> None:
        pages = [
            {
                "page_number": 1,
                "chapter": "Chapter 1",
                "section": "Section 1",
                "text": "This is a short paragraph. It contains only two sentences.",
            }
        ]
        passages = build_passages(pages, output_path=tmp_path / "out.jsonl")
        assert len(passages) == 1
        assert passages[0]["start_page"] == 1
        assert passages[0]["end_page"] == 1
        assert passages[0]["passage_id"] == "p0001"
        assert len(passages[0]["content_hash"]) == 64

    def test_path_3_4_long_text_split_and_overlap(self, tmp_path: Path) -> None:
        # Create text with 10 sentences, each ~20 words = 200 words total
        sentences = [
            f"Sentence number {i} provides detailed information regarding public administration and accountability in governance."
            for i in range(1, 11)
        ]
        pages = [
            {
                "page_number": 1,
                "chapter": "Gov",
                "section": "Admin",
                "text": " ".join(sentences),
            }
        ]
        cfg = {"build_passages": {"max_passage_words": 60, "overlap_words": 20}}
        passages = build_passages(pages, config=cfg, output_path=tmp_path / "out.jsonl")
        assert len(passages) >= 2

        # Verify overlap: trailing sentences of passage 0 appear at start of passage 1
        p0_text = passages[0]["text"]
        p1_text = passages[1]["text"]
        assert len(p0_text) > 0 and len(p1_text) > 0
        # Overlap words verification
        common_words = set(p0_text.split()).intersection(set(p1_text.split()))
        assert len(common_words) > 5

    def test_path_5_giant_sentence_exceeding_max_words(self, tmp_path: Path) -> None:
        giant_sentence = "Word " * 150 + "."
        pages = [
            {
                "page_number": 1,
                "chapter": "Stress",
                "section": "Long",
                "text": giant_sentence,
            }
        ]
        cfg = {"build_passages": {"max_passage_words": 50, "overlap_words": 10}}
        passages = build_passages(pages, config=cfg, output_path=tmp_path / "out.jsonl")
        # Must not crash, should create at least 1 passage
        assert len(passages) >= 1
        assert passages[0]["word_count"] >= 150

    def test_path_6_multi_page_spanning_passage(self, tmp_path: Path) -> None:
        pages = [
            {
                "page_number": 1,
                "chapter": "Constitution",
                "section": "Preamble",
                "text": "We, the sovereign Filipino people, imploring the aid of Almighty God.",
            },
            {
                "page_number": 2,
                "chapter": "Constitution",
                "section": "Preamble",
                "text": "In order to build a just and humane society, do ordain and promulgate this Constitution.",
            },
        ]
        cfg = {"build_passages": {"max_passage_words": 200, "overlap_words": 20}}
        passages = build_passages(pages, config=cfg, output_path=tmp_path / "out.jsonl")
        assert len(passages) == 1
        assert passages[0]["start_page"] == 1
        assert passages[0]["end_page"] == 2

    def test_path_7_chapter_transition_breaks_passages(self, tmp_path: Path) -> None:
        pages = [
            {
                "page_number": 1,
                "chapter": "Chapter 1",
                "section": "Sec A",
                "text": "Content of chapter one.",
            },
            {
                "page_number": 2,
                "chapter": "Chapter 2",
                "section": "Sec A",
                "text": "Content of chapter two.",
            },
        ]
        passages = build_passages(pages, output_path=tmp_path / "out.jsonl")
        assert len(passages) == 2
        assert passages[0]["chapter"] == "Chapter 1"
        assert passages[1]["chapter"] == "Chapter 2"


# ---------------------------------------------------------------------------
# 4. content_pack Basis Paths
# ---------------------------------------------------------------------------

@pytest.mark.path
class TestContentPackPaths:
    """Linearly independent execution paths for build_content_pack."""

    def test_path_1_clean_build_and_fts5(self, tmp_path: Path) -> None:
        q_path = tmp_path / "questions.jsonl"
        p_path = tmp_path / "passages.jsonl"
        db_path = tmp_path / "content_pack.db"

        questions = [
            {
                "question_id": "q0001",
                "topic": "Ethics",
                "question_type": "multiple_choice",
                "stem": "Which law governs ethical standards?",
                "choices": [
                    {"key": "A", "text": "R.A. 6713"},
                    {"key": "B", "text": "R.A. 7160"},
                ],
                "canonical_answer": "R.A. 6713",
                "canonical_choice_key": "A",
                "source_page": 1,
                "link_confidence": "verified",
            }
        ]
        passages = [
            {
                "passage_id": "p0001",
                "chapter": "Ethics",
                "section": "Code",
                "start_page": 1,
                "end_page": 1,
                "text": "Republic Act 6713 establishes the Code of Conduct and Ethical Standards for Public Officials.",
                "content_hash": "a" * 64,
                "word_count": 15,
            }
        ]

        q_path.write_text("\n".join(json.dumps(q) for q in questions), encoding="utf-8")
        p_path.write_text("\n".join(json.dumps(p) for p in passages), encoding="utf-8")

        build_content_pack(q_path, p_path, output_db_path=db_path)
        assert db_path.exists()

        # Check DB integrity & FTS5 search
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()
        assert cursor.execute("PRAGMA foreign_key_check;").fetchall() == []
        assert cursor.execute("PRAGMA integrity_check;").fetchone() == ("ok",)

        # FTS5 search
        fts_res = cursor.execute(
            "SELECT passage_id FROM passages_fts WHERE passages_fts MATCH 'Ethical Standards';"
        ).fetchall()
        assert len(fts_res) == 1
        assert fts_res[0][0] == "p0001"

        # Check question_passages link
        links = cursor.execute("SELECT question_id, passage_id FROM question_passages;").fetchall()
        assert len(links) == 1
        assert links[0] == ("q0001", "p0001")
        conn.close()

    def test_path_2_foreign_key_violation_raises(self, tmp_path: Path) -> None:
        """Simulate foreign key constraint violation and verify RuntimeError is raised."""
        q_path = tmp_path / "questions.jsonl"
        p_path = tmp_path / "passages.jsonl"
        db_path = tmp_path / "corrupt.db"

        questions = [
            {
                "question_id": "q0001",
                "topic": "Ethics",
                "question_type": "multiple_choice",
                "stem": "Which law?",
                "choices": [{"key": "A", "text": "Choice A"}],
                "source_page": 1,
            }
        ]
        q_path.write_text("\n".join(json.dumps(q) for q in questions), encoding="utf-8")
        p_path.write_text("", encoding="utf-8")

        orig_connect = sqlite3.connect

        class MockCursorProxy:
            def __init__(self, real_cur: Any, trigger_fk: bool = False, trigger_integrity: bool = False) -> None:
                self._cur = real_cur
                self._trigger_fk = trigger_fk
                self._trigger_integrity = trigger_integrity

            def execute(self, sql: str, *args: Any, **kwargs: Any) -> Any:
                res = self._cur.execute(sql, *args, **kwargs)
                if self._trigger_fk and "PRAGMA foreign_key_check" in sql:
                    class FakeResFK:
                        def fetchall(self) -> list[Any]:
                            return [("choices", 1, "questions", 0)]
                    return FakeResFK()
                if self._trigger_integrity and "PRAGMA integrity_check" in sql:
                    class FakeResIntegrity:
                        def fetchone(self) -> tuple[str]:
                            return ("corrupt",)
                    return FakeResIntegrity()
                return res

            def __getattr__(self, name: str) -> Any:
                return getattr(self._cur, name)

        class MockConnectionProxy:
            def __init__(self, real_conn: Any, trigger_fk: bool = False, trigger_integrity: bool = False) -> None:
                self._real = real_conn
                self._trigger_fk = trigger_fk
                self._trigger_integrity = trigger_integrity

            def cursor(self, *args: Any, **kwargs: Any) -> Any:
                cur = self._real.cursor(*args, **kwargs)
                return MockCursorProxy(cur, trigger_fk=self._trigger_fk, trigger_integrity=self._trigger_integrity)

            def execute(self, sql: str, *args: Any, **kwargs: Any) -> Any:
                return self._real.execute(sql, *args, **kwargs)

            def commit(self) -> None:
                self._real.commit()

            def close(self) -> None:
                self._real.close()

            def __getattr__(self, name: str) -> Any:
                return getattr(self._real, name)

        with patch("sqlite3.connect", side_effect=lambda *a, **k: MockConnectionProxy(orig_connect(*a, **k), trigger_fk=True)):
            with pytest.raises(RuntimeError, match="Foreign key constraint violation"):
                build_content_pack(q_path, p_path, output_db_path=db_path)

        with patch("sqlite3.connect", side_effect=lambda *a, **k: MockConnectionProxy(orig_connect(*a, **k), trigger_integrity=True)):
            with pytest.raises(RuntimeError, match="Database integrity check failed"):
                build_content_pack(q_path, p_path, output_db_path=db_path)

    def test_path_3_multiple_topics_sorting(self, tmp_path: Path) -> None:
        q_path = tmp_path / "questions.jsonl"
        p_path = tmp_path / "passages.jsonl"
        db_path = tmp_path / "topics.db"

        questions = [
            {"question_id": "q1", "topic": "Verbal", "question_type": "identification", "stem": "Word?", "source_page": 1},
            {"question_id": "q2", "topic": "Math", "question_type": "identification", "stem": "Number?", "source_page": 2},
            {"question_id": "q3", "topic": "General", "question_type": "identification", "stem": "Constitution?", "source_page": 3},
        ]
        q_path.write_text("\n".join(json.dumps(q) for q in questions), encoding="utf-8")
        p_path.write_text("", encoding="utf-8")

        build_content_pack(q_path, p_path, output_db_path=db_path)
        conn = sqlite3.connect(str(db_path))
        topics = conn.cursor().execute("SELECT id, title, sort_order FROM topics ORDER BY sort_order;").fetchall()
        assert len(topics) == 3
        # Ensure sequential sort_order 1, 2, 3
        assert [t[2] for t in topics] == [1, 2, 3]
        conn.close()

    def test_path_4_atomic_replace_overwrites_existing_db(self, tmp_path: Path) -> None:
        q_path = tmp_path / "questions.jsonl"
        p_path = tmp_path / "passages.jsonl"
        db_path = tmp_path / "existing.db"

        # Pre-create existing file
        db_path.write_text("pre-existing dummy content", encoding="utf-8")

        q_path.write_text("", encoding="utf-8")
        p_path.write_text("", encoding="utf-8")

        build_content_pack(q_path, p_path, output_db_path=db_path)
        assert db_path.exists()
        # Should be a valid SQLite database now
        conn = sqlite3.connect(str(db_path))
        res = conn.cursor().execute("PRAGMA integrity_check;").fetchone()
        assert res == ("ok",)
        conn.close()
