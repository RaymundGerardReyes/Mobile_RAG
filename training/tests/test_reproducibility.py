"""Reproducibility, determinism, and artifact provenance verification tests.

Verifies:
1. Passage chunking IDs and SHA-256 hashes are strictly deterministic.
2. Content Pack content_hash is strictly deterministic across runs and detects tampering.
3. scripts/verify_artifacts.py succeeds on valid production/synthetic artifacts,
   and reliably exits with code 1 on tampered or missing artifacts.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

import pytest

# Ensure scripts/ directory is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from ai_tutor_training.content_pack import build_content_pack
from ai_tutor_training.provenance import create_stage_manifest, save_stage_manifest
from ai_tutor_training.stages.build_passages import build_passages
from verify_artifacts import main as verify_main, verify_manifest


def test_passage_generation_determinism(sample_pages_path: Path, tmp_path: Path, pipeline_config: dict[str, Any]) -> None:
    """Repeated executions on identical inputs generate identical passage IDs, texts, and hashes."""
    out1 = tmp_path / "passages_run1.jsonl"
    out2 = tmp_path / "passages_run2.jsonl"

    passages1 = build_passages(sample_pages_path, config=pipeline_config, output_path=out1)
    passages2 = build_passages(sample_pages_path, config=pipeline_config, output_path=out2)

    assert len(passages1) == len(passages2)
    for p1, p2 in zip(passages1, passages2):
        assert p1["passage_id"] == p2["passage_id"]
        assert p1["text"] == p2["text"]
        assert p1["content_hash"] == p2["content_hash"]
        assert p1["start_page"] == p2["start_page"]
        assert p1["end_page"] == p2["end_page"]
        assert p1["word_count"] == p2["word_count"]


def test_content_pack_hash_determinism_and_tamper_detection(
    sample_linked_questions_path: Path,
    sample_passages_path: Path,
    tmp_path: Path,
    pipeline_config: dict[str, Any],
) -> None:
    """content_pack_metadata.content_hash is deterministic and changes upon input modification."""
    db1_path = tmp_path / "cp1.db"
    db2_path = tmp_path / "cp2.db"

    build_content_pack(
        linked_questions_path=sample_linked_questions_path,
        passages_path=sample_passages_path,
        output_db_path=db1_path,
        version="2026.10.1",
        config=pipeline_config,
    )
    build_content_pack(
        linked_questions_path=sample_linked_questions_path,
        passages_path=sample_passages_path,
        output_db_path=db2_path,
        version="2026.10.1",
        config=pipeline_config,
    )

    conn1 = sqlite3.connect(str(db1_path))
    hash1 = conn1.execute("SELECT content_hash FROM content_pack_metadata;").fetchone()[0]
    conn1.close()

    conn2 = sqlite3.connect(str(db2_path))
    hash2 = conn2.execute("SELECT content_hash FROM content_pack_metadata;").fetchone()[0]
    conn2.close()

    assert hash1 == hash2, "Identical content pack inputs must yield identical content_hash"

    # Now tamper with one question stem
    tampered_q_path = tmp_path / "tampered_questions.jsonl"
    with sample_linked_questions_path.open("r", encoding="utf-8") as f:
        records = [json.loads(line) for line in f if line.strip()]

    records[0]["stem"] = records[0]["stem"] + " [TAMPERED]"
    with tampered_q_path.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")

    db3_path = tmp_path / "cp3_tampered.db"
    build_content_pack(
        linked_questions_path=tampered_q_path,
        passages_path=sample_passages_path,
        output_db_path=db3_path,
        version="2026.10.1",
        config=pipeline_config,
    )

    conn3 = sqlite3.connect(str(db3_path))
    hash3 = conn3.execute("SELECT content_hash FROM content_pack_metadata;").fetchone()[0]
    conn3.close()

    assert hash3 != hash1, "Tampered questions must yield a different content_hash"

    # Now tamper with one passage content_hash
    tampered_p_path = tmp_path / "tampered_passages.jsonl"
    with sample_passages_path.open("r", encoding="utf-8") as f:
        p_records = [json.loads(line) for line in f if line.strip()]

    p_records[0]["content_hash"] = "0" * 64
    with tampered_p_path.open("w", encoding="utf-8") as f:
        for r in p_records:
            f.write(json.dumps(r) + "\n")

    db4_path = tmp_path / "cp4_tampered_passages.db"
    build_content_pack(
        linked_questions_path=sample_linked_questions_path,
        passages_path=tampered_p_path,
        output_db_path=db4_path,
        version="2026.10.1",
        config=pipeline_config,
    )

    conn4 = sqlite3.connect(str(db4_path))
    hash4 = conn4.execute("SELECT content_hash FROM content_pack_metadata;").fetchone()[0]
    conn4.close()

    assert hash4 != hash1, "Tampered passages must yield a different content_hash"


def test_verify_artifacts_script_success_and_tamper_detection(
    sample_pages_path: Path,
    sample_linked_questions_path: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """scripts/verify_artifacts.py verifies valid manifests and flags tampered files."""
    artifacts_dir = tmp_path / "audit_artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    test_file = artifacts_dir / "extracted_pages.jsonl"
    test_file.write_text(sample_pages_path.read_text(encoding="utf-8"), encoding="utf-8")

    import datetime
    now = datetime.datetime.now(datetime.timezone.utc)
    manifest = create_stage_manifest(
        stage="extract_textbook",
        started_at=now,
        ended_at=now,
        status="success",
        input_files={},
        output_files={"extracted_pages.jsonl": test_file},
        record_count=10,
    )
    manifest_file = artifacts_dir / "extract_manifest.json"
    save_stage_manifest(manifest, manifest_file)

    # 1. Verification succeeds on untampered artifact
    errs = verify_manifest(manifest_file)
    assert len(errs) == 0, f"Expected clean verification, got: {errs}"

    monkeypatch.setattr(sys, "argv", ["verify_artifacts.py", str(artifacts_dir)])
    exit_code = verify_main()
    assert exit_code == 0

    # 2. Tampering test: append a byte to the artifact
    with test_file.open("a", encoding="utf-8") as f:
        f.write("\n")

    errs_tampered = verify_manifest(manifest_file)
    assert len(errs_tampered) > 0
    assert any("Hash mismatch" in e for e in errs_tampered)

    exit_code_tampered = verify_main()
    assert exit_code_tampered == 1

    # 3. Missing artifact test
    test_file.unlink()
    errs_missing = verify_manifest(manifest_file)
    assert len(errs_missing) > 0
    assert any("Missing artifact" in e for e in errs_missing)

    exit_code_missing = verify_main()
    assert exit_code_missing == 1

    # 4. Corrupted / Malformed manifest JSON test
    bad_manifest = artifacts_dir / "corrupt_manifest.json"
    bad_manifest.write_text("{ invalid json payload", encoding="utf-8")
    errs_bad = verify_manifest(bad_manifest)
    assert len(errs_bad) > 0
    assert any("Failed to read manifest" in e for e in errs_bad)

    exit_code_corrupt = verify_main()
    assert exit_code_corrupt == 1

