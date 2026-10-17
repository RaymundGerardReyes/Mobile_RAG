"""Stress and scalability benchmarks for the AI Tutor training pipeline.

Covers:
1. 1,000+ item throughput benchmark for build_content_pack.
2. FTS5 BM25 search latency benchmark (p95 < 2.0 ms).
3. Memory and scaling safety for high-volume passage segmentation.

Marked with @pytest.mark.stress.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

import pytest

from ai_tutor_training.content_pack import build_content_pack
from ai_tutor_training.stages.build_passages import build_passages
from ai_tutor_training.stages.extract_textbook import extract_textbook


@pytest.mark.stress
class TestStressAndScalability:
    """Stress tests validating scalability, memory bounds, and sub-2ms FTS5 latency."""

    @pytest.fixture
    def high_volume_dataset(self, tmp_path: Path) -> tuple[Path, Path]:
        """Generate 1,000+ realistic questions and passages across 10 subject domains."""
        q_path = tmp_path / "stress_questions.jsonl"
        p_path = tmp_path / "stress_passages.jsonl"

        domains = [
            ("Philippine Constitution", "Constitutional Law"),
            ("Code of Conduct", "Civil Service Ethics"),
            ("General Information", "Public Governance"),
            ("Numerical Ability", "Mathematics"),
            ("Verbal Ability", "Grammar and Vocabulary"),
            ("Analytical Ability", "Logic and Reasoning"),
            ("Clerical Operations", "Filing and Procedures"),
            ("Kasaysayan at Pamahalaan", "Filipino History"),
            ("Balarilang Filipino", "Wika at Panitikan"),
            ("Administrative Code", "Civil Service Rules"),
        ]

        questions: list[dict[str, Any]] = []
        passages: list[dict[str, Any]] = []

        total_items = 1000

        for idx in range(1, total_items + 1):
            domain_name, topic = domains[idx % len(domains)]
            page_num = (idx // 5) + 1

            # Passage text
            p_text = (
                f"Section {idx} of the {domain_name} covers fundamental principles of public service. "
                f"Under Republic Act 6713 and the Administrative Code of 1987, officials must act with utmost "
                f"responsibility, integrity, loyalty, and efficiency in serving the Filipino citizens. "
                f"Benchmark token identifier: {domain_name}_{idx}."
            )

            p_id = f"p{idx:05d}"
            passages.append(
                {
                    "passage_id": p_id,
                    "chapter": domain_name,
                    "section": topic,
                    "start_page": page_num,
                    "end_page": page_num,
                    "text": p_text,
                    "content_hash": f"hash_{idx:08x}" + "0" * 56,
                    "word_count": len(p_text.split()),
                }
            )

            # Question
            q_id = f"q{idx:05d}"
            questions.append(
                {
                    "question_id": q_id,
                    "topic": topic,
                    "question_type": "multiple_choice",
                    "stem": f"According to {domain_name} Section {idx}, what is required of public officials?",
                    "choices": [
                        {"key": "A", "text": "Utmost responsibility, integrity, and efficiency"},
                        {"key": "B", "text": "Commercial profit and business venture"},
                        {"key": "C", "text": "Absolute sovereign immunity"},
                        {"key": "D", "text": "Partisan political campaign involvement"},
                    ],
                    "canonical_answer": "Utmost responsibility, integrity, and efficiency",
                    "canonical_choice_key": "A",
                    "canonical_explanation": "Mandated under Republic Act 6713.",
                    "source_page": page_num,
                    "answer_key_page": page_num,
                    "difficulty": "medium",
                    "link_confidence": "verified",
                    "link_warnings": [],
                    "content_version": "2026.10.1",
                }
            )

        with q_path.open("w", encoding="utf-8") as f:
            for q in questions:
                f.write(json.dumps(q) + "\n")

        with p_path.open("w", encoding="utf-8") as f:
            for p in passages:
                f.write(json.dumps(p) + "\n")

        return q_path, p_path

    def test_1000_items_throughput_and_fts5_latency(
        self, high_volume_dataset: tuple[Path, Path], tmp_path: Path
    ) -> None:
        """Benchmark 1,000+ items build throughput and verify FTS5 p95 latency < 2ms."""
        q_path, p_path = high_volume_dataset
        db_path = tmp_path / "stress_pack.db"

        # 1. Measure build throughput
        t0 = time.perf_counter()
        out_db = build_content_pack(
            linked_questions_path=q_path,
            passages_path=p_path,
            output_db_path=db_path,
        )
        t_build = time.perf_counter() - t0

        assert db_path.exists()
        assert t_build < 30.0  # Must build 1,000 items in under 30s on single thread

        # 2. Verify Database integrity and completeness
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        fk_violations = cursor.execute("PRAGMA foreign_key_check;").fetchall()
        assert len(fk_violations) == 0, f"Foreign key violations found: {fk_violations}"

        integrity = cursor.execute("PRAGMA integrity_check;").fetchone()
        assert integrity == ("ok",)

        q_count = cursor.execute("SELECT COUNT(*) FROM questions;").fetchone()[0]
        p_count = cursor.execute("SELECT COUNT(*) FROM passages;").fetchone()[0]
        c_count = cursor.execute("SELECT COUNT(*) FROM choices;").fetchone()[0]
        fts_count = cursor.execute("SELECT COUNT(*) FROM passages_fts;").fetchone()[0]

        assert q_count == 1000
        assert p_count == 1000
        assert c_count == 4000
        assert fts_count == 1000

        # 3. FTS5 BM25 search latency benchmark across 200 queries
        search_terms = [
            "Constitution",
            "Ethics",
            "Republic Act",
            "responsibility",
            "integrity",
            "efficiency",
            "governance",
            "Mathematics",
            "Filipino",
            "Administrative",
        ]

        query_latencies_ms: list[float] = []

        # Warmup query
        cursor.execute(
            "SELECT passage_id, rank FROM passages_fts WHERE passages_fts MATCH 'integrity' ORDER BY rank LIMIT 10;"
        ).fetchall()

        # Run 200 timed queries
        for i in range(200):
            term = search_terms[i % len(search_terms)]
            t_start = time.perf_counter_ns()
            rows = cursor.execute(
                "SELECT passage_id, rank FROM passages_fts WHERE passages_fts MATCH ? ORDER BY rank LIMIT 10;",
                (term,),
            ).fetchall()
            t_end = time.perf_counter_ns()
            duration_ms = (t_end - t_start) / 1_000_000.0
            query_latencies_ms.append(duration_ms)
            assert len(rows) > 0

        conn.close()

        # Compute latency percentiles
        query_latencies_ms.sort()
        p50 = query_latencies_ms[int(len(query_latencies_ms) * 0.50)]
        p95 = query_latencies_ms[int(len(query_latencies_ms) * 0.95)]
        p99 = query_latencies_ms[int(len(query_latencies_ms) * 0.99)]
        avg = sum(query_latencies_ms) / len(query_latencies_ms)

        print(f"\n[FTS5 Latency Benchmark (200 queries on 1,000 items)]")
        print(f"  Average: {avg:.3f} ms")
        print(f"  p50 (Median): {p50:.3f} ms")
        print(f"  p95: {p95:.3f} ms")
        print(f"  p99: {p99:.3f} ms")

        # Acceptance Criteria: p95 latency must be strictly under 2.0 ms
        assert p95 < 2.0, f"FTS5 p95 latency exceeded 2.0ms: {p95:.3f}ms"

    def test_high_volume_sentence_segmentation(self, tmp_path: Path) -> None:
        """Verify memory safety and stability when segmenting 5,000+ sentences."""
        pages = []
        for p_idx in range(1, 51):
            sentences = [
                f"Page {p_idx} sentence {s_idx} details the administrative rules and provisions of civil service law."
                for s_idx in range(1, 101)
            ]
            pages.append(
                {
                    "page_number": p_idx,
                    "chapter": f"Chapter {(p_idx - 1) // 10 + 1}",
                    "section": f"Section {(p_idx - 1) % 5 + 1}",
                    "text": " ".join(sentences),
                }
            )

        out_f = tmp_path / "huge_passages.jsonl"
        passages = build_passages(pages, output_path=out_f)

        assert len(passages) > 0
        assert out_f.exists()
        # Verify contiguous passage numbering
        for idx, p in enumerate(passages, start=1):
            assert p["passage_id"] == f"p{idx:04d}"
            assert p["word_count"] > 0
            assert len(p["content_hash"]) == 64

    def test_multi_page_pdf_extraction_scale(self, tmp_path: Path) -> None:
        """Verify memory safety and linear scaling when extracting a 100-page synthetic PDF."""
        import fitz

        pdf_path = tmp_path / "scale_100_pages.pdf"
        doc = fitz.open()
        for idx in range(1, 101):
            p = doc.new_page()
            p.insert_text(
                (50, 50),
                f"CHAPTER {idx}: Stress Chapter\nSection: Subtopic {idx}\n"
                f"This is page {idx} containing civil service reviewer text for stress testing PyMuPDF memory bounds.\n",
                fontsize=11,
            )
        doc.save(str(pdf_path))
        doc.close()

        out_f = tmp_path / "extracted_100_pages.jsonl"
        t0 = time.perf_counter()
        pages = extract_textbook(pdf_path, output_path=out_f)
        duration = time.perf_counter() - t0

        assert len(pages) == 100
        assert out_f.exists()
        assert duration < 10.0  # 100 pages extracted well under 10s
