"""True End-to-End (E2E) pipeline tests for the entire AI Tutor training backend.

Covers the full progression:
Stage 1 (extract_textbook) -> Stage 2 (link_qa_pairs) -> Stage 3 (build_passages) -> build_content_pack
Validates intermediate contracts, database foreign keys & integrity, FTS5 BM25 search
in English & Filipino, full provenance chain, and CLI 'run-all' execution.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import pytest
from click.testing import CliRunner
import yaml

from ai_tutor_training.cli import cli
from ai_tutor_training.content_pack import build_content_pack
from ai_tutor_training.contracts import load_schema, validate_jsonl_against_schema, validate_record_against_schema
from ai_tutor_training.provenance import compute_sha256
from ai_tutor_training.stages.build_passages import build_passages
from ai_tutor_training.stages.extract_textbook import extract_textbook
from ai_tutor_training.stages.link_qa_pairs import link_qa_pairs


def test_full_pipeline_e2e_live_run(
    sample_pdf: Path,
    tmp_path: Path,
    pipeline_config: dict[str, Any],
    contracts_dir: Path,
) -> None:
    """Execute live Stage 1 -> Stage 2 -> Stage 3 -> build_content_pack."""
    artifacts_dir = tmp_path / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    extracted_pages_file = artifacts_dir / "extracted_pages.jsonl"
    extract_manifest_file = artifacts_dir / "extract_manifest.json"
    linked_questions_file = artifacts_dir / "linked_questions.jsonl"
    link_manifest_file = artifacts_dir / "link_manifest.json"
    passages_file = artifacts_dir / "passages.jsonl"
    passages_manifest_file = artifacts_dir / "passages_manifest.json"
    content_pack_db_file = artifacts_dir / "content_pack.db"
    content_pack_manifest_file = artifacts_dir / "content_pack_manifest.json"

    # -------------------------------------------------------------------------
    # Step 1: Extract textbook from synthetic PDF
    # -------------------------------------------------------------------------
    pages = extract_textbook(
        pdf_path=sample_pdf,
        config=pipeline_config,
        output_path=extracted_pages_file,
        manifest_path=extract_manifest_file,
    )
    assert len(pages) == 6
    assert extracted_pages_file.exists()
    assert extract_manifest_file.exists()

    # Contract verification on Step 1 output
    p_schema = contracts_dir / "extracted-page.schema.json"
    rep1 = validate_jsonl_against_schema(extracted_pages_file, p_schema)
    assert rep1.is_valid, f"Extracted pages contract failure: {rep1.errors}"
    assert rep1.valid_count == 6

    # -------------------------------------------------------------------------
    # Step 2: Link QA pairs from extracted pages
    # -------------------------------------------------------------------------
    questions = link_qa_pairs(
        extracted_pages=extracted_pages_file,
        config=pipeline_config,
        output_path=linked_questions_file,
        manifest_path=link_manifest_file,
    )
    assert len(questions) >= 6
    assert linked_questions_file.exists()
    assert link_manifest_file.exists()

    # Contract verification on Step 2 output
    q_schema = contracts_dir / "linked-question.schema.json"
    rep2 = validate_jsonl_against_schema(linked_questions_file, q_schema)
    assert rep2.is_valid, f"Linked questions contract failure: {rep2.errors}"
    assert rep2.valid_count == len(questions)

    # -------------------------------------------------------------------------
    # Step 3: Build bounded, sentence-aware passages
    # -------------------------------------------------------------------------
    passages = build_passages(
        extracted_pages=extracted_pages_file,
        config=pipeline_config,
        output_path=passages_file,
        manifest_path=passages_manifest_file,
    )
    assert len(passages) >= 2
    assert passages_file.exists()
    assert passages_manifest_file.exists()

    # Contract verification on Step 3 output
    pass_schema = contracts_dir / "passage.schema.json"
    rep3 = validate_jsonl_against_schema(passages_file, pass_schema)
    assert rep3.is_valid, f"Passages contract failure: {rep3.errors}"
    assert rep3.valid_count == len(passages)

    # -------------------------------------------------------------------------
    # Step 4: Build Content Pack SQLite database
    # -------------------------------------------------------------------------
    db_path = build_content_pack(
        linked_questions_path=linked_questions_file,
        passages_path=passages_file,
        output_db_path=content_pack_db_file,
        version="2026.10.1",
        config=pipeline_config,
        manifest_path=content_pack_manifest_file,
    )
    assert db_path.exists()
    assert content_pack_manifest_file.exists()

    # -------------------------------------------------------------------------
    # Inspect SQLite database: Foreign Keys & Integrity
    # -------------------------------------------------------------------------
    conn = sqlite3.connect(str(content_pack_db_file))
    conn.execute("PRAGMA foreign_keys = ON;")
    cur = conn.cursor()

    fk_violations = cur.execute("PRAGMA foreign_key_check;").fetchall()
    assert len(fk_violations) == 0, f"PRAGMA foreign_key_check failed: {fk_violations}"

    integrity_result = cur.execute("PRAGMA integrity_check;").fetchone()
    assert integrity_result is not None
    assert integrity_result[0] == "ok", f"PRAGMA integrity_check failed: {integrity_result}"

    # Verify tables and row counts
    q_count = cur.execute("SELECT COUNT(*) FROM questions;").fetchone()[0]
    p_count = cur.execute("SELECT COUNT(*) FROM passages;").fetchone()[0]
    c_count = cur.execute("SELECT COUNT(*) FROM choices;").fetchone()[0]
    qa_count = cur.execute("SELECT COUNT(*) FROM question_answers;").fetchone()[0]
    qp_count = cur.execute("SELECT COUNT(*) FROM question_passages;").fetchone()[0]

    assert q_count == len(questions)
    assert p_count == len(passages)
    assert c_count > 0
    assert qa_count > 0
    assert qp_count > 0

    # -------------------------------------------------------------------------
    # FTS5 BM25 Lexical Search Queries: English & Filipino
    # -------------------------------------------------------------------------
    # English search
    en_results = cur.execute(
        """
        SELECT p.id, p.text, bm25(passages_fts) as score
        FROM passages_fts fts
        JOIN passages p ON p.rowid = fts.rowid
        WHERE passages_fts MATCH 'Constitution'
        ORDER BY score ASC;
        """
    ).fetchall()
    assert len(en_results) > 0, "FTS5 query for English 'Constitution' returned 0 results"
    assert "Constitution" in en_results[0][1]

    # Filipino search
    fil_results = cur.execute(
        """
        SELECT p.id, p.text, bm25(passages_fts) as score
        FROM passages_fts fts
        JOIN passages p ON p.rowid = fts.rowid
        WHERE passages_fts MATCH 'marikit'
        ORDER BY score ASC;
        """
    ).fetchall()
    assert len(fil_results) > 0, "FTS5 query for Filipino 'marikit' returned 0 results"
    assert "marikit" in fil_results[0][1]

    # Verify UNINDEXED passage_id direct join
    join_results = cur.execute(
        """
        SELECT p.id, p.chapter
        FROM passages_fts fts
        JOIN passages p ON p.id = fts.passage_id
        WHERE passages_fts MATCH 'marikit'
        LIMIT 1;
        """
    ).fetchall()
    assert len(join_results) > 0
    assert join_results[0][0].startswith("p")

    conn.close()

    # -------------------------------------------------------------------------
    # Verify Manifest Provenance Chain and Schema Compliance
    # -------------------------------------------------------------------------
    manifest_schema = load_schema(contracts_dir / "stage-manifest.schema.json")
    manifests = [
        ("extract", extract_manifest_file),
        ("link", link_manifest_file),
        ("passages", passages_manifest_file),
        ("content_pack", content_pack_manifest_file),
    ]

    manifest_data: dict[str, dict[str, Any]] = {}
    for stage_tag, mf_p in manifests:
        assert mf_p.exists(), f"Manifest {mf_p} missing"
        with mf_p.open("r", encoding="utf-8") as f:
            data = json.load(f)
        manifest_data[stage_tag] = data

        errs = validate_record_against_schema(data, manifest_schema)
        assert len(errs) == 0, f"Manifest {mf_p.name} violates schema: {errs}"
        assert data["status"] == "success"

    # Cross-stage provenance hash linkage:
    # 1. Output hash of extracted_pages in extract stage matches input hash in link stage
    extract_out_hash = manifest_data["extract"]["output_hashes"]["extracted_pages.jsonl"]
    link_in_hash = manifest_data["link"]["input_hashes"]["extracted_pages.jsonl"]
    assert extract_out_hash == link_in_hash, "Provenance break between extract and link stages"

    # 2. Output hash of extracted_pages in extract stage matches input hash in passages stage
    passages_in_hash = manifest_data["passages"]["input_hashes"]["extracted_pages.jsonl"]
    assert extract_out_hash == passages_in_hash, "Provenance break between extract and passages stages"

    # 3. Output hash of linked_questions and passages match content_pack inputs
    link_out_hash = manifest_data["link"]["output_hashes"]["linked_questions.jsonl"]
    cp_q_in_hash = manifest_data["content_pack"]["input_hashes"]["linked_questions.jsonl"]
    assert link_out_hash == cp_q_in_hash, "Provenance break between link and content_pack stages"

    pass_out_hash = manifest_data["passages"]["output_hashes"]["passages.jsonl"]
    cp_p_in_hash = manifest_data["content_pack"]["input_hashes"]["passages.jsonl"]
    assert pass_out_hash == cp_p_in_hash, "Provenance break between passages and content_pack stages"


def test_cli_run_all_e2e(sample_pdf: Path, tmp_path: Path, contracts_dir: Path) -> None:
    """End-to-End verification of 'run-all' CLI command generating a valid pipeline."""
    cfg_file = tmp_path / "pipeline.yaml"
    out_dir = tmp_path / "cli_artifacts"
    out_dir.mkdir(parents=True, exist_ok=True)

    cfg_dict = {
        "source": {"pdf_path": str(sample_pdf).replace("\\", "/")},
        "extract_textbook": {
            "output_path": str(out_dir / "extracted_pages.jsonl").replace("\\", "/"),
            "manifest_path": str(out_dir / "extract_manifest.json").replace("\\", "/"),
            "chapter_heading_patterns": [
                r"^(?:CHAPTER|Chapter|KABANATA|Kabanata)\s+[\dIVXLCDM]+[.:]?\s*(.*)",
            ],
            "section_heading_patterns": [
                r"^(?:Section|Seksyon)\s+[\dIVXLCDM]+[.:]?\s*(.*)",
            ],
        },
        "link_qa_pairs": {
            "content_version": "2026.10.1",
            "output_path": str(out_dir / "linked_questions.jsonl").replace("\\", "/"),
            "manifest_path": str(out_dir / "link_manifest.json").replace("\\", "/"),
            "question_patterns": [r"^\s*(\d{1,4})[.)]\s+(.*)"],
            "choice_patterns": [r"^\s*([A-Da-d])[.)]\s+(.*)"],
            "answer_key_header_patterns": [r"(?i)(?:answer\s+key|susi\s+sa\s+pagwawasto)"],
            "answer_key_item_patterns": [r"(\d{1,4})\s*[-–—:]\s*([A-Da-d])\b"],
        },
        "build_passages": {
            "output_path": str(out_dir / "passages.jsonl").replace("\\", "/"),
            "manifest_path": str(out_dir / "passages_manifest.json").replace("\\", "/"),
            "max_passage_words": 300,
            "overlap_words": 50,
        },
        "content_pack": {
            "output_path": str(out_dir / "content_pack.db").replace("\\", "/"),
            "manifest_path": str(out_dir / "content_pack_manifest.json").replace("\\", "/"),
            "version": "2026.10.1",
        },
    }
    with cfg_file.open("w", encoding="utf-8") as f:
        yaml.safe_dump(cfg_dict, f)

    runner = CliRunner()
    result = runner.invoke(cli, ["run-all", "--config", str(cfg_file)])
    assert result.exit_code == 0, f"run-all failed: {result.output}"
    assert "Pipeline completed successfully!" in result.output

    # Verify all artifacts and manifests generated
    assert (out_dir / "extracted_pages.jsonl").exists()
    assert (out_dir / "linked_questions.jsonl").exists()
    assert (out_dir / "passages.jsonl").exists()
    assert (out_dir / "extract_manifest.json").exists()
    assert (out_dir / "link_manifest.json").exists()
    assert (out_dir / "passages_manifest.json").exists()
    assert (out_dir / "content_pack_manifest.json").exists()

    db_path = out_dir / "content_pack.db"
    assert db_path.exists()
    conn = sqlite3.connect(str(db_path))
    assert conn.execute("PRAGMA integrity_check;").fetchone()[0] == "ok"
    assert len(conn.execute("PRAGMA foreign_key_check;").fetchall()) == 0

    # Verify tables have content
    q_cnt = conn.execute("SELECT COUNT(*) FROM questions;").fetchone()[0]
    p_cnt = conn.execute("SELECT COUNT(*) FROM passages;").fetchone()[0]
    fts_cnt = conn.execute("SELECT COUNT(*) FROM passages_fts;").fetchone()[0]
    assert q_cnt >= 6
    assert p_cnt >= 2
    assert fts_cnt >= 2

    # Verify FTS5 query on CLI generated database
    fts_match = conn.execute(
        "SELECT p.id, p.text FROM passages_fts fts JOIN passages p ON p.rowid = fts.rowid WHERE passages_fts MATCH 'Constitution' LIMIT 1;"
    ).fetchone()
    assert fts_match is not None

    conn.close()
