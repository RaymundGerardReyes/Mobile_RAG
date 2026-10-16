"""Unit tests for the automated release packager (scripts/package_release.py)."""

from __future__ import annotations

import json
import sqlite3
import sys
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure repo root and scripts/ are importable
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from package_release import (
    compute_sha256,
    package_release,
    run_content_pack_gate,
    run_contract_gate,
    run_model_gate,
    run_test_suites_gate,
)


@pytest.fixture
def artifacts_dir(tmp_path: Path) -> Path:
    prod_artifacts = REPO_ROOT / "training" / "artifacts"
    if (
        (prod_artifacts / "content_pack.db").exists()
        and (prod_artifacts / "passages.jsonl").exists()
        and (prod_artifacts / "extracted_pages.jsonl").exists()
        and (prod_artifacts / "linked_questions.jsonl").exists()
    ):
        return prod_artifacts

    # Fallback for clean clones/CI: synthesize minimal valid artifacts in tmp_path
    synth_dir = tmp_path / "synthetic_artifacts"
    synth_dir.mkdir(parents=True, exist_ok=True)
    fixtures_dir = REPO_ROOT / "training" / "tests" / "fixtures"

    import shutil
    shutil.copy(fixtures_dir / "sample_pages.jsonl", synth_dir / "extracted_pages.jsonl")
    shutil.copy(fixtures_dir / "sample_linked_questions.jsonl", synth_dir / "linked_questions.jsonl")
    shutil.copy(fixtures_dir / "sample_passages.jsonl", synth_dir / "passages.jsonl")

    import hashlib
    for fname, st_name in [
        ("extracted_pages.jsonl", "extract_manifest.json"),
        ("linked_questions.jsonl", "qa_manifest.json"),
        ("passages.jsonl", "passages_manifest.json"),
    ]:
        data = (synth_dir / fname).read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        manifest_payload = {
            "stage": st_name.replace("_manifest.json", ""),
            "timestamp": "2026-10-16T00:00:00Z",
            "output_files": [fname],
            "checksums": {fname: f"sha256:{sha}"},
            "parameters": {},
            "metrics": {"record_count": 6},
        }
        (synth_dir / st_name).write_text(json.dumps(manifest_payload), encoding="utf-8")

    from ai_tutor_training.content_pack import build_content_pack
    build_content_pack(
        questions_path=synth_dir / "linked_questions.jsonl",
        passages_path=synth_dir / "passages.jsonl",
        output_db_path=synth_dir / "content_pack.db",
        version="2026.10.1",
    )
    return synth_dir


@pytest.fixture
def contracts_dir() -> Path:
    return REPO_ROOT / "contracts"


@pytest.fixture
def models_dir() -> Path:
    return REPO_ROOT / "training" / "models"


# ------------------------------------------------------------------------------
# Gate 1: Contract Validation Tests
# ------------------------------------------------------------------------------


def test_contract_gate_success(artifacts_dir: Path, contracts_dir: Path) -> None:
    """Gate 1 succeeds against valid production artifacts."""
    result = run_contract_gate(artifacts_dir, contracts_dir)
    assert result["passed"] is True, f"Contract gate failed: {result['errors']}"
    assert len(result["errors"]) == 0
    assert "extracted_pages.jsonl" in result["files_checked"]
    assert "linked_questions.jsonl" in result["files_checked"]
    assert "passages.jsonl" in result["files_checked"]


def test_contract_gate_fails_on_corrupt_artifact(
    tmp_path: Path, contracts_dir: Path
) -> None:
    """Gate 1 fails when an artifact violates its contract schema."""
    corrupt_artifacts = tmp_path / "artifacts"
    corrupt_artifacts.mkdir()

    # Create invalid linked_questions with missing required field 'question_type'
    bad_q = corrupt_artifacts / "linked_questions.jsonl"
    bad_q.write_text(
        json.dumps({"question_id": "q0001", "stem": "Bad question", "source_page": 1})
        + "\n",
        encoding="utf-8",
    )

    # Valid dummy pages and passages
    (corrupt_artifacts / "extracted_pages.jsonl").write_text(
        json.dumps({"page_number": 1, "text": "Valid text", "source_id": "doc1"}) + "\n",
        encoding="utf-8",
    )
    (corrupt_artifacts / "passages.jsonl").write_text(
        json.dumps({
            "passage_id": "p001",
            "chapter": "General",
            "start_page": 1,
            "end_page": 1,
            "text": "Valid passage text",
            "content_hash": "a" * 64,
        }) + "\n",
        encoding="utf-8",
    )

    result = run_contract_gate(corrupt_artifacts, contracts_dir)
    assert result["passed"] is False
    assert len(result["errors"]) > 0
    assert any("linked_questions.jsonl" in err for err in result["errors"])


def test_contract_gate_fails_on_empty_artifact(
    tmp_path: Path, contracts_dir: Path
) -> None:
    """Gate 1 fails when an artifact file is empty (0 records)."""
    empty_artifacts = tmp_path / "empty_artifacts"
    empty_artifacts.mkdir()

    # 0-byte extracted_pages.jsonl
    (empty_artifacts / "extracted_pages.jsonl").write_text("", encoding="utf-8")
    (empty_artifacts / "linked_questions.jsonl").write_text(
        json.dumps({
            "question_id": "q1",
            "topic": "General",
            "question_type": "multiple_choice",
            "stem": "Question stem",
            "source_page": 1,
            "content_version": "2026.10.1",
        }) + "\n",
        encoding="utf-8",
    )
    (empty_artifacts / "passages.jsonl").write_text(
        json.dumps({
            "passage_id": "p1",
            "chapter": "General",
            "start_page": 1,
            "end_page": 1,
            "text": "Passage text",
            "content_hash": "a" * 64,
        }) + "\n",
        encoding="utf-8",
    )

    result = run_contract_gate(empty_artifacts, contracts_dir)
    assert result["passed"] is False
    assert any("0 records" in err for err in result["errors"])


def test_contract_gate_fails_on_missing_artifact(
    tmp_path: Path, contracts_dir: Path
) -> None:
    """Gate 1 fails when required artifact files do not exist."""
    empty_dir = tmp_path / "empty_artifacts"
    empty_dir.mkdir()

    result = run_contract_gate(empty_dir, contracts_dir)
    assert result["passed"] is False
    assert any("Missing required artifact" in err for err in result["errors"])


def test_contract_gate_fails_on_manifest_hash_mismatch(
    tmp_path: Path, contracts_dir: Path, artifacts_dir: Path
) -> None:
    """Gate 1 fails when an artifact on disk has been modified and mismatches stage manifest."""
    test_artifacts = tmp_path / "tampered_artifacts"
    test_artifacts.mkdir()

    # Copy real artifacts
    for f in artifacts_dir.glob("*"):
        if f.is_file():
            (test_artifacts / f.name).write_bytes(f.read_bytes())

    # Tamper with passages.jsonl without updating passages_manifest.json
    passages_file = test_artifacts / "passages.jsonl"
    passages_file.write_text(
        passages_file.read_text(encoding="utf-8") + "\n# Tampered line\n",
        encoding="utf-8",
    )

    result = run_contract_gate(test_artifacts, contracts_dir)
    assert result["passed"] is False
    assert any("hash mismatch" in err for err in result["errors"])


# ------------------------------------------------------------------------------
# Gate 2: Test Suites Gate Tests
# ------------------------------------------------------------------------------


def test_test_suites_gate_skip_tests() -> None:
    """Gate 2 correctly bypasses tests when skip_tests=True."""
    result = run_test_suites_gate(REPO_ROOT, skip_tests=True)
    assert result["passed"] is True
    assert result["skipped"] is True
    assert len(result["errors"]) == 0


def test_test_suites_gate_success_mocked() -> None:
    """Gate 2 reports success when both Python and Mobile test suites pass."""
    with patch("subprocess.run") as mock_run:
        mock_proc = MagicMock()
        mock_proc.returncode = 0
        mock_proc.stdout = "All tests passed"
        mock_proc.stderr = ""
        mock_run.return_value = mock_proc

        result = run_test_suites_gate(REPO_ROOT, skip_tests=False)
        assert result["passed"] is True
        assert result["python"]["passed"] is True
        assert result["mobile"]["passed"] is True
        assert len(result["errors"]) == 0


def test_test_suites_gate_aborts_on_failure() -> None:
    """Gate 2 flags failure when a test suite subprocess exits with non-zero."""
    with patch("subprocess.run") as mock_run:
        # Simulate pytest failure
        mock_proc = MagicMock()
        mock_proc.returncode = 1
        mock_proc.stdout = "FAILED training/tests/test_something.py::test_fail"
        mock_proc.stderr = "AssertionError"
        mock_run.return_value = mock_proc

        result = run_test_suites_gate(REPO_ROOT, skip_tests=False)
        assert result["passed"] is False
        assert result["python"]["passed"] is False
        assert len(result["errors"]) > 0


# ------------------------------------------------------------------------------
# Gate 3: Content Pack SQLite Integrity & Data Quality Tests
# ------------------------------------------------------------------------------


def test_content_pack_gate_success(artifacts_dir: Path) -> None:
    """Gate 3 passes on valid production SQLite content pack."""
    db_path = artifacts_dir / "content_pack.db"
    assert db_path.exists()

    result = run_content_pack_gate(db_path, expected_version="2026.10.1")
    assert result["passed"] is True, f"Content pack audit failed: {result['errors']}"
    assert result["integrity"] == "ok"
    assert result["foreign_keys"] == "ok"
    assert result["table_counts"]["questions"] > 0
    assert result["table_counts"]["choices"] > 0
    assert result["table_counts"]["passages"] > 0
    assert result["table_counts"]["passages_fts"] > 0


def test_content_pack_gate_aborts_on_version_mismatch(artifacts_dir: Path) -> None:
    """Gate 3 strictly fails when content pack metadata version mismatches release version."""
    db_path = artifacts_dir / "content_pack.db"
    assert db_path.exists()

    result = run_content_pack_gate(db_path, expected_version="999.999.999")
    assert result["passed"] is False
    assert any("does not match release version" in err for err in result["errors"])


def test_content_pack_gate_aborts_on_corrupt_db(tmp_path: Path) -> None:
    """Gate 3 aborts when SQLite database is corrupted or empty."""
    # 1. Non-existent file
    missing_res = run_content_pack_gate(tmp_path / "nonexistent.db")
    assert missing_res["passed"] is False
    assert any("not found" in err for err in missing_res["errors"])

    # 2. 0-byte file
    empty_db = tmp_path / "empty.db"
    empty_db.write_bytes(b"")
    empty_res = run_content_pack_gate(empty_db)
    assert empty_res["passed"] is False
    assert any("empty" in err for err in empty_res["errors"])

    # 3. Garbage text file masquerading as DB
    garbage_db = tmp_path / "garbage.db"
    garbage_db.write_text("NOT A SQLITE DATABASE", encoding="utf-8")
    garbage_res = run_content_pack_gate(garbage_db)
    assert garbage_res["passed"] is False


def test_content_pack_gate_aborts_on_foreign_key_violation(tmp_path: Path) -> None:
    """Gate 3 aborts when a foreign key constraint is violated in the DB."""
    db_path = tmp_path / "fk_bad.db"
    conn = sqlite3.connect(str(db_path))
    conn.executescript(
        """
        CREATE TABLE topics (id TEXT PRIMARY KEY, title TEXT NOT NULL, sort_order INTEGER);
        CREATE TABLE questions (
            id TEXT PRIMARY KEY,
            topic_id TEXT REFERENCES topics(id),
            question_type TEXT,
            stem TEXT,
            source_page INTEGER
        );
        CREATE TABLE choices (id TEXT PRIMARY KEY, question_id TEXT REFERENCES questions(id), choice_key TEXT, text TEXT);
        CREATE TABLE question_answers (question_id TEXT REFERENCES questions(id), canonical_choice_id TEXT REFERENCES choices(id), canonical_answer TEXT);
        CREATE TABLE passages (id TEXT PRIMARY KEY, text TEXT, start_page INTEGER, end_page INTEGER);
        CREATE TABLE question_passages (question_id TEXT, passage_id TEXT);
        CREATE TABLE passages_fts (passage_id TEXT);
        CREATE TABLE schema_migrations (version INTEGER);
        CREATE TABLE content_pack_metadata (pack_id TEXT, version TEXT, source_revision TEXT, imported_at TEXT, content_hash TEXT);
        
        -- Insert question referencing non-existent topic
        INSERT INTO questions (id, topic_id, question_type, stem, source_page)
        VALUES ('q0001', 'non_existent_topic', 'multiple_choice', 'Sample question', 1);
        """
    )
    conn.commit()
    conn.close()

    result = run_content_pack_gate(db_path)
    assert result["passed"] is False
    assert any("foreign_key_check" in err for err in result["errors"])


# ------------------------------------------------------------------------------
# Gate 4: Model Manifest & GGUF Artifact Tests
# ------------------------------------------------------------------------------


def test_model_gate_optional_unbundled(models_dir: Path, contracts_dir: Path) -> None:
    """Gate 4 passes when GGUF model is unbundled for M0-M2 offline quiz."""
    result = run_model_gate(models_dir, contracts_dir)
    assert result["passed"] is True
    assert result["present"] is False
    assert result["status"] == "optional_unbundled"


def test_model_gate_validates_manifest_and_gguf_hash(
    tmp_path: Path, contracts_dir: Path
) -> None:
    """Gate 4 validates model-manifest.schema.json and checks GGUF SHA-256."""
    models_tmp = tmp_path / "models"
    models_tmp.mkdir()

    gguf_content = b"DUMMY_GGUF_MODEL_BINARY_CONTENT"
    gguf_file = models_tmp / "qwen3-1.7b-instruct-q4_k_m.gguf"
    gguf_file.write_bytes(gguf_content)
    true_hash = compute_sha256(gguf_file)
    file_size = len(gguf_content)

    manifest_data = {
        "manifest_id": "model_qwen3_1.7b_q4_k_m",
        "model_name": "Qwen3-1.7B-Instruct",
        "model_revision": "2026.10",
        "base_model_repo": "Qwen/Qwen3-1.7B-Instruct",
        "quantization": "Q4_K_M",
        "file_sha256": true_hash,
        "file_size_bytes": file_size,
        "license": "Apache-2.0",
        "runtime": "llama.rn",
        "context_length": 2048,
        "created_at": "2026-10-15T00:00:00Z",
    }
    manifest_file = models_tmp / "model-manifest.json"
    manifest_file.write_text(json.dumps(manifest_data, indent=2), encoding="utf-8")

    # Positive test: Valid manifest and matching hash
    pos_res = run_model_gate(models_tmp, contracts_dir)
    assert pos_res["passed"] is True
    assert pos_res["present"] is True
    assert pos_res["status"] == "verified"

    # Negative test: Hash mismatch
    manifest_data["file_sha256"] = "f" * 64
    manifest_file.write_text(json.dumps(manifest_data, indent=2), encoding="utf-8")
    neg_res = run_model_gate(models_tmp, contracts_dir)
    assert neg_res["passed"] is False
    assert any("hash mismatch" in err for err in neg_res["errors"])


# ------------------------------------------------------------------------------
# End-to-End Release Packaging Tests
# ------------------------------------------------------------------------------


def test_package_release_end_to_end(
    tmp_path: Path,
    artifacts_dir: Path,
    contracts_dir: Path,
    models_dir: Path,
) -> None:
    """Full end-to-end release packaging creates manifest, zip, and verified bundle."""
    release_output = tmp_path / "release"
    version = "2026.10.1"

    pkg = package_release(
        repo_root=REPO_ROOT,
        version=version,
        output_dir=release_output,
        artifacts_dir=artifacts_dir,
        contracts_dir=contracts_dir,
        models_dir=models_dir,
        skip_tests=True,
        copy_to_mobile=False,
    )

    assert pkg.all_gates_passed is True
    assert pkg.output_dir.exists()
    assert pkg.manifest_path.exists()
    assert pkg.zip_path.exists()

    # 1. Inspect release-manifest.json
    with pkg.manifest_path.open("r", encoding="utf-8") as f:
        manifest_data = json.load(f)

    assert manifest_data["version"] == version
    assert manifest_data["release_id"].startswith(f"rel-{version}-")
    assert manifest_data["gates"]["contract_validation"]["passed"] is True
    assert manifest_data["gates"]["content_pack_audit"]["passed"] is True
    assert manifest_data["gates"]["test_suites"]["skipped"] is True
    assert "content_pack.db" in manifest_data["assets"]

    # 2. Inspect self-contained .zip archive
    with zipfile.ZipFile(pkg.zip_path, "r") as zf:
        namelist = zf.namelist()
        assert "content_pack.db" in namelist
        assert "release-manifest.json" in namelist
        extracted_db = zf.read("content_pack.db")
        from hashlib import sha256

        assert (
            sha256(extracted_db).hexdigest()
            == manifest_data["assets"]["content_pack.db"]["sha256"]
        )


def test_package_release_copy_to_mobile(
    tmp_path: Path,
    artifacts_dir: Path,
    contracts_dir: Path,
    models_dir: Path,
) -> None:
    """--copy-to-mobile copies verified assets to mobile/assets/ without polluting workspace."""
    fake_repo = tmp_path / "fake_repo"
    fake_repo.mkdir()
    fake_mobile_assets = fake_repo / "mobile" / "assets"
    fake_mobile_assets.mkdir(parents=True)
    release_output = tmp_path / "release"

    pkg = package_release(
        repo_root=fake_repo,
        version="2026.10.1",
        output_dir=release_output,
        artifacts_dir=artifacts_dir,
        contracts_dir=contracts_dir,
        models_dir=models_dir,
        skip_tests=True,
        copy_to_mobile=True,
    )

    assert pkg.all_gates_passed is True
    assert fake_mobile_assets.exists()
    assert (fake_mobile_assets / "content_pack.db").exists()
    assert (fake_mobile_assets / "release-manifest.json").exists()

    copied_hash = compute_sha256(fake_mobile_assets / "content_pack.db")
    assert copied_hash == pkg.assets["content_pack.db"]["sha256"]


def test_package_release_with_bundled_model(
    tmp_path: Path,
    artifacts_dir: Path,
    contracts_dir: Path,
) -> None:
    """Release packager packages GGUF model and manifest when present."""
    models_tmp = tmp_path / "models"
    models_tmp.mkdir()

    gguf_content = b"TEST_GGUF_MODEL_DATA"
    gguf_file = models_tmp / "qwen3-1.7b.gguf"
    gguf_file.write_bytes(gguf_content)
    true_hash = compute_sha256(gguf_file)

    manifest_data = {
        "manifest_id": "model_test",
        "model_name": "Qwen3-1.7B-Instruct",
        "model_revision": "2026.10",
        "base_model_repo": "Qwen/Qwen3-1.7B-Instruct",
        "quantization": "Q4_K_M",
        "file_sha256": true_hash,
        "file_size_bytes": len(gguf_content),
        "license": "Apache-2.0",
        "runtime": "llama.rn",
        "created_at": "2026-10-15T00:00:00Z",
    }
    (models_tmp / "model-manifest.json").write_text(json.dumps(manifest_data), encoding="utf-8")

    release_output = tmp_path / "release"
    fake_repo = tmp_path / "repo"
    fake_repo.mkdir()

    pkg = package_release(
        repo_root=fake_repo,
        version="2026.10.1",
        output_dir=release_output,
        artifacts_dir=artifacts_dir,
        contracts_dir=contracts_dir,
        models_dir=models_tmp,
        skip_tests=True,
        copy_to_mobile=False,
    )

    assert pkg.all_gates_passed is True
    assert (pkg.output_dir / "qwen3-1.7b.gguf").exists()
    assert (pkg.output_dir / "model-manifest.json").exists()

    # Check zip includes model files
    with zipfile.ZipFile(pkg.zip_path, "r") as zf:
        namelist = zf.namelist()
        assert "qwen3-1.7b.gguf" in namelist
        assert "model-manifest.json" in namelist


def test_package_release_zero_defect_gate_aborts_on_failure(
    tmp_path: Path,
    contracts_dir: Path,
    models_dir: Path,
) -> None:
    """Zero-defect gate raises RuntimeError and generates no bundle on failure."""
    empty_artifacts = tmp_path / "bad_artifacts"
    empty_artifacts.mkdir()
    release_output = tmp_path / "release"

    with pytest.raises(RuntimeError, match="quality gate failure"):
        package_release(
            repo_root=REPO_ROOT,
            version="2026.10.1",
            output_dir=release_output,
            artifacts_dir=empty_artifacts,
            contracts_dir=contracts_dir,
            models_dir=models_dir,
            skip_tests=True,
        )

    zip_path = release_output / "2026.10.1" / "ai-tutor-release-2026.10.1.zip"
    assert not zip_path.exists()


def test_setup_scripts_exist_and_non_empty() -> None:
    """Setup scripts exist, are non-empty, and contain required setup stages."""
    ps1_script = SCRIPTS_DIR / "setup_all.ps1"
    sh_script = SCRIPTS_DIR / "setup_all.sh"

    assert ps1_script.exists() and ps1_script.stat().st_size > 1000
    assert sh_script.exists() and sh_script.stat().st_size > 1000

    ps1_content = ps1_script.read_text(encoding="utf-8")
    assert "training\\.venv" in ps1_content
    assert "validate_contracts.py" in ps1_content
    assert "PRAGMA integrity_check" in ps1_content

    sh_content = sh_script.read_text(encoding="utf-8")
    assert "training/.venv" in sh_content
    assert "validate_contracts.py" in sh_content
    assert "PRAGMA integrity_check" in sh_content
