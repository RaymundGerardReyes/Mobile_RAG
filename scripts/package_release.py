#!/usr/bin/env python3
"""Production-Grade Automated Release Packager with Zero-Defect Gates.

Implements ARCHITECTURE.md §4, §14 and RELEASE_CHECKLIST.md:
- Gate 1: Contract Schema Validation (contracts/*.schema.json against artifacts and stage manifests)
- Gate 2: Full Test Suite Execution (Python pytest + Mobile TypeScript node --test)
- Gate 3: Content Pack SQLite Integrity & Data Quality Audit
- Gate 4: Model Manifest & GGUF Artifact Audit
- Generates cryptographically verifiable release-manifest.json
- Packages standalone .zip distribution archive under release/builds/<version>/
- Supports --copy-to-mobile to distribute verified release assets to mobile/assets/ for offline iOS bundling
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import platform
import shutil
import sqlite3
import subprocess
import sys
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import jsonschema
except ImportError:
    jsonschema = None

try:
    import yaml
except ImportError:
    yaml = None


def compute_sha256(file_path: Path) -> str:
    """Compute the SHA-256 hex digest of a file in 64 KB chunks."""
    sha = hashlib.sha256()
    with file_path.open("rb") as f:
        while chunk := f.read(65536):
            sha.update(chunk)
    return sha.hexdigest()


def get_git_revision(repo_root: Path) -> str | None:
    """Retrieve current git HEAD commit SHA-1."""
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode == 0:
            return proc.stdout.strip()
    except Exception:
        pass
    return None


def get_node_version() -> str | None:
    """Retrieve installed Node.js version."""
    try:
        proc = subprocess.run(
            ["node", "--version"],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode == 0:
            return proc.stdout.strip()
    except Exception:
        pass
    return None


def get_gpu_info() -> str | None:
    """Retrieve GPU information via nvidia-smi or torch."""
    try:
        proc = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            return proc.stdout.strip().replace("\n", "; ")
    except Exception:
        pass

    try:
        import torch

        if torch.cuda.is_available():
            return f"{torch.cuda.get_device_name(0)} (CUDA {torch.version.cuda})"
    except Exception:
        pass
    return "No NVIDIA CUDA GPU detected"


# ==============================================================================
# Gate 1: Contract Validation
# ==============================================================================


def validate_single_json_against_schema(
    json_path: Path, schema_path: Path
) -> list[str]:
    """Validate a single JSON file against a schema."""
    if not json_path.exists():
        return [f"File not found: {json_path}"]
    if not schema_path.exists():
        return [f"Schema not found: {schema_path}"]

    if jsonschema is None:
        return ["The 'jsonschema' package is required. Install via: pip install jsonschema"]

    try:
        with json_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        with schema_path.open("r", encoding="utf-8") as f:
            schema = json.load(f)
    except Exception as e:
        return [f"Failed to read/parse {json_path.name} or {schema_path.name}: {e}"]

    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)

    errors = []
    for err in validator.iter_errors(data):
        path_str = " -> ".join(str(p) for p in err.absolute_path) or "root"
        errors.append(f"[{path_str}]: {err.message}")
    return errors


def validate_jsonl_against_schema(
    jsonl_path: Path, schema_path: Path
) -> tuple[int, list[str]]:
    """Validate each record of a JSONL file against a schema."""
    if not jsonl_path.exists():
        return 0, [f"JSONL file not found: {jsonl_path}"]
    if not schema_path.exists():
        return 0, [f"Schema not found: {schema_path}"]

    if jsonschema is None:
        return 0, ["The 'jsonschema' package is required. Install via: pip install jsonschema"]

    try:
        with schema_path.open("r", encoding="utf-8") as f:
            schema = json.load(f)
    except Exception as e:
        return 0, [f"Failed to load schema {schema_path}: {e}"]

    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)

    valid_count = 0
    errors: list[str] = []

    with jsonl_path.open("r", encoding="utf-8") as f:
        for line_no, raw_line in enumerate(f, start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError as e:
                errors.append(f"Line {line_no}: Invalid JSON syntax ({e})")
                continue

            item_errors = list(validator.iter_errors(data))
            if item_errors:
                for err in item_errors:
                    path_str = " -> ".join(str(p) for p in err.absolute_path) or "root"
                    errors.append(f"Line {line_no} [{path_str}]: {err.message}")
            else:
                valid_count += 1

    return valid_count, errors


def run_contract_gate(
    artifacts_dir: Path, contracts_dir: Path
) -> dict[str, Any]:
    """Execute Gate 1: Contract schema validation on artifacts and stage manifests."""
    results: dict[str, Any] = {
        "passed": True,
        "files_checked": {},
        "errors": [],
    }

    # 1. Validate meta-schemas of all schema contracts
    if jsonschema is not None and contracts_dir.exists():
        for sf in sorted(contracts_dir.glob("*.schema.json")):
            try:
                with sf.open("r", encoding="utf-8") as f:
                    sdata = json.load(f)
                vcls = jsonschema.validators.validator_for(sdata)
                vcls.check_schema(sdata)
                results["files_checked"][sf.name] = {"status": "valid_schema"}
            except Exception as e:
                msg = f"Invalid schema contract {sf.name}: {e}"
                results["passed"] = False
                results["errors"].append(msg)
                results["files_checked"][sf.name] = {"status": "invalid_schema", "error": msg}

    # 2. Core required artifacts and their schemas
    contract_mappings = [
        ("extracted_pages.jsonl", "extracted-page.schema.json", "jsonl"),
        ("linked_questions.jsonl", "linked-question.schema.json", "jsonl"),
        ("passages.jsonl", "passage.schema.json", "jsonl"),
    ]

    for filename, schema_name, file_type in contract_mappings:
        file_path = artifacts_dir / filename
        schema_path = contracts_dir / schema_name

        if not file_path.exists():
            msg = f"Missing required artifact: {file_path}"
            results["passed"] = False
            results["errors"].append(msg)
            results["files_checked"][filename] = {"status": "missing", "error": msg}
            continue

        if not schema_path.exists():
            msg = f"Missing schema contract: {schema_path}"
            results["passed"] = False
            results["errors"].append(msg)
            results["files_checked"][filename] = {"status": "missing_schema", "error": msg}
            continue

        if file_type == "jsonl":
            count, errs = validate_jsonl_against_schema(file_path, schema_path)
            # Strict Zero-Defect Rule: 0 records in a required artifact is a fatal error
            if count == 0 and not errs:
                errs.append(f"{filename} contains 0 records (empty artifact)")

            if errs:
                results["passed"] = False
                results["errors"].extend([f"{filename}: {e}" for e in errs])
                results["files_checked"][filename] = {
                    "status": "failed",
                    "valid_count": count,
                    "errors": errs,
                }
            else:
                results["files_checked"][filename] = {
                    "status": "passed",
                    "valid_count": count,
                }

    # 3. Stage manifests validation and provenance hash verification
    stage_manifest_schema = contracts_dir / "stage-manifest.schema.json"
    required_manifests = [
        "extract_manifest.json",
        "link_manifest.json",
        "passages_manifest.json",
        "content_pack_manifest.json",
    ]

    for req_mf in required_manifests:
        mf_path = artifacts_dir / req_mf
        if not mf_path.exists():
            # If the artifacts directory is a custom subset, only check present manifests
            continue

        if stage_manifest_schema.exists():
            errs = validate_single_json_against_schema(mf_path, stage_manifest_schema)
            if errs:
                results["passed"] = False
                results["errors"].extend([f"{req_mf}: {e}" for e in errs])
                results["files_checked"][req_mf] = {"status": "failed", "errors": errs}
                continue

        # Verify output hashes recorded in manifest match files on disk
        try:
            with mf_path.open("r", encoding="utf-8") as f:
                mf_data = json.load(f)
            output_hashes = mf_data.get("output_hashes", {})
            for rel_or_name, expected_hash in output_hashes.items():
                target_cand = artifacts_dir / Path(rel_or_name).name
                if target_cand.exists():
                    actual_hash = compute_sha256(target_cand)
                    if actual_hash != expected_hash:
                        h_err = (
                            f"{req_mf}: output hash mismatch for {target_cand.name} "
                            f"(expected {expected_hash}, got {actual_hash})"
                        )
                        results["passed"] = False
                        results["errors"].append(h_err)
                        results["files_checked"][req_mf] = {
                            "status": "hash_mismatch",
                            "error": h_err,
                        }
                        break
            else:
                results["files_checked"][req_mf] = {"status": "passed"}
        except Exception as e:
            results["passed"] = False
            results["errors"].append(f"{req_mf}: read error ({e})")

    return results


# ==============================================================================
# Gate 2: Test Suite Execution
# ==============================================================================


def run_test_suites_gate(
    repo_root: Path, skip_tests: bool = False
) -> dict[str, Any]:
    """Execute Gate 2: Python (pytest) and Mobile TypeScript test suites."""
    results: dict[str, Any] = {
        "passed": True,
        "skipped": skip_tests,
        "python": {"passed": False, "output": ""},
        "mobile": {"passed": False, "output": ""},
        "errors": [],
    }

    if skip_tests:
        results["python"] = {"passed": True, "output": "Skipped via --skip-tests"}
        results["mobile"] = {"passed": True, "output": "Skipped via --skip-tests"}
        return results

    # 1. Run Python pytest suite
    py_proc = subprocess.run(
        [sys.executable, "-m", "pytest", "training/tests"],
        cwd=str(repo_root),
        capture_output=True,
        text=True,
        check=False,
    )
    results["python"]["output"] = py_proc.stdout.strip()
    if py_proc.returncode == 0:
        results["python"]["passed"] = True
    else:
        results["python"]["passed"] = False
        results["passed"] = False
        err_msg = f"Python pytest suite failed (exit code {py_proc.returncode}):\n{py_proc.stderr or py_proc.stdout}"
        results["errors"].append(err_msg)

    # 2. Run Mobile TypeScript test suite
    # Directly invokes node --test with compiled test files for cross-platform reliability
    mobile_dir = repo_root / "mobile"
    dist_tests_dir = mobile_dir / "dist" / "tests"

    test_files = sorted(dist_tests_dir.rglob("*.test.js")) if dist_tests_dir.exists() else []

    if not test_files:
        # Check if mobile TypeScript has been compiled
        results["mobile"]["passed"] = False
        results["passed"] = False
        err_msg = (
            "Mobile TypeScript test suite failed: no compiled test files found in "
            f"{dist_tests_dir}. Please run 'npm run build' in mobile/ first."
        )
        results["errors"].append(err_msg)
        return results

    rel_test_files = [str(p.relative_to(mobile_dir)) for p in test_files]
    mobile_cmd = ["node", "--test"] + rel_test_files

    try:
        mob_proc = subprocess.run(
            mobile_cmd,
            cwd=str(mobile_dir),
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        # Fallback to npm test if node binary path is not directly discoverable
        if platform.system() == "Windows":
            npm_cmd = ["cmd.exe", "/c", "npm", "test"]
        else:
            npm_cmd = ["npm", "test"]
        mob_proc = subprocess.run(
            npm_cmd,
            cwd=str(mobile_dir),
            capture_output=True,
            text=True,
            check=False,
        )

    results["mobile"]["output"] = mob_proc.stdout.strip()
    if mob_proc.returncode == 0:
        results["mobile"]["passed"] = True
    else:
        results["mobile"]["passed"] = False
        results["passed"] = False
        err_msg = f"Mobile TypeScript test suite failed (exit code {mob_proc.returncode}):\n{mob_proc.stderr or mob_proc.stdout}"
        results["errors"].append(err_msg)

    return results


# ==============================================================================
# Gate 3: Content Pack SQLite Integrity & Data Quality Audit
# ==============================================================================


def run_content_pack_gate(
    db_path: Path, expected_version: str | None = None
) -> dict[str, Any]:
    """Execute Gate 3: Audit SQLite content pack integrity, schemas, and consistency."""
    results: dict[str, Any] = {
        "passed": True,
        "db_path": str(db_path),
        "table_counts": {},
        "integrity": None,
        "foreign_keys": None,
        "metadata": {},
        "errors": [],
    }

    if not db_path.exists():
        msg = f"Content pack SQLite database not found: {db_path}"
        results["passed"] = False
        results["errors"].append(msg)
        return results

    if db_path.stat().st_size == 0:
        msg = f"Content pack SQLite database is empty (0 bytes): {db_path}"
        results["passed"] = False
        results["errors"].append(msg)
        return results

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        # 1. PRAGMA integrity_check
        integrity_res = cursor.execute("PRAGMA integrity_check;").fetchall()
        if not integrity_res or integrity_res[0][0] != "ok":
            msg = f"SQLite PRAGMA integrity_check failed: {integrity_res}"
            results["passed"] = False
            results["errors"].append(msg)
            results["integrity"] = "failed"
        else:
            results["integrity"] = "ok"

        # 2. PRAGMA foreign_key_check
        fk_res = cursor.execute("PRAGMA foreign_key_check;").fetchall()
        if fk_res:
            msg = f"SQLite PRAGMA foreign_key_check violations: {fk_res}"
            results["passed"] = False
            results["errors"].append(msg)
            results["foreign_keys"] = f"failed ({len(fk_res)} violations)"
        else:
            results["foreign_keys"] = "ok"

        # 3. Check essential tables exist
        required_tables = [
            "schema_migrations",
            "content_pack_metadata",
            "topics",
            "passages",
            "questions",
            "choices",
            "question_answers",
            "question_passages",
            "passages_fts",
        ]
        existing_tables = [
            r[0]
            for r in cursor.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table', 'view');"
            ).fetchall()
        ]

        for req in required_tables:
            if req not in existing_tables:
                msg = f"Missing required table in content pack: {req}"
                results["passed"] = False
                results["errors"].append(msg)

        # 4. Table counts and non-empty assertions
        for tbl in ["topics", "passages", "questions", "choices", "passages_fts", "question_answers", "question_passages"]:
            if tbl in existing_tables:
                cnt = cursor.execute(f"SELECT COUNT(*) FROM {tbl};").fetchone()[0]
                results["table_counts"][tbl] = cnt
                if tbl in ["topics", "passages", "questions", "choices", "passages_fts"] and cnt == 0:
                    msg = f"Critical table '{tbl}' has 0 records"
                    results["passed"] = False
                    results["errors"].append(msg)

        # 5. Question/Answer consistency audit
        # Multiple choice questions missing choices
        if "questions" in existing_tables and "choices" in existing_tables:
            orphan_q_query = """
                SELECT q.id FROM questions q
                WHERE q.question_type = 'multiple_choice'
                AND (SELECT COUNT(*) FROM choices c WHERE c.question_id = q.id) = 0;
            """
            orphan_qs = cursor.execute(orphan_q_query).fetchall()
            if orphan_qs:
                msg = f"{len(orphan_qs)} multiple_choice question(s) have no choices"
                results["passed"] = False
                results["errors"].append(msg)

        # Questions without answers
        if "questions" in existing_tables and "question_answers" in existing_tables:
            unanswered_query = """
                SELECT q.id FROM questions q
                LEFT JOIN question_answers a ON q.id = a.question_id
                WHERE a.canonical_choice_id IS NULL AND (a.canonical_answer IS NULL OR a.canonical_answer = '');
            """
            unanswered_qs = cursor.execute(unanswered_query).fetchall()
            if unanswered_qs:
                msg = f"{len(unanswered_qs)} question(s) have no canonical choice or answer defined"
                results["passed"] = False
                results["errors"].append(msg)

        # Canonical choice belonging to another question
        if "question_answers" in existing_tables and "choices" in existing_tables:
            mismatched_choice_query = """
                SELECT qa.question_id, qa.canonical_choice_id, c.question_id
                FROM question_answers qa
                JOIN choices c ON qa.canonical_choice_id = c.id
                WHERE qa.canonical_choice_id IS NOT NULL AND c.question_id != qa.question_id;
            """
            mismatched = cursor.execute(mismatched_choice_query).fetchall()
            if mismatched:
                msg = f"{len(mismatched)} canonical choice(s) belong to a different question"
                results["passed"] = False
                results["errors"].append(msg)

        # Passages data quality check
        if "passages" in existing_tables:
            invalid_p_query = """
                SELECT id FROM passages
                WHERE text IS NULL OR TRIM(text) = '' OR start_page > end_page;
            """
            invalid_ps = cursor.execute(invalid_p_query).fetchall()
            if invalid_ps:
                msg = f"{len(invalid_ps)} passage(s) have empty text or inverted start_page > end_page"
                results["passed"] = False
                results["errors"].append(msg)

        # Read content pack metadata
        if "content_pack_metadata" in existing_tables:
            meta = cursor.execute(
                "SELECT pack_id, version, source_revision, content_hash FROM content_pack_metadata LIMIT 1;"
            ).fetchone()
            if meta:
                results["metadata"] = {
                    "pack_id": meta[0],
                    "version": meta[1],
                    "source_revision": meta[2],
                    "content_hash": meta[3],
                }
                if expected_version and meta[1] != expected_version:
                    msg = f"Content pack version '{meta[1]}' does not match release version '{expected_version}'"
                    results["passed"] = False
                    results["errors"].append(msg)
            else:
                msg = "content_pack_metadata table has 0 records"
                results["passed"] = False
                results["errors"].append(msg)

        conn.close()
    except Exception as e:
        results["passed"] = False
        results["errors"].append(f"Content pack SQLite audit exception: {e}")

    return results


# ==============================================================================
# Gate 4: Model Manifest & GGUF Artifact Audit
# ==============================================================================


def run_model_gate(
    models_dir: Path, contracts_dir: Path
) -> dict[str, Any]:
    """Execute Gate 4: Audit model manifest schema and GGUF checksums."""
    results: dict[str, Any] = {
        "passed": True,
        "present": False,
        "manifest_path": None,
        "model_file": None,
        "status": "unbundled",
        "errors": [],
    }

    manifest_candidates = [
        models_dir / "model-manifest.json",
        models_dir / "model_manifest.json",
    ]
    manifest_file = next((f for f in manifest_candidates if f.exists()), None)

    if not manifest_file:
        # Per Architecture §1 & §9: model is optional for M0-M2 offline quiz reviewer
        results["present"] = False
        results["status"] = "optional_unbundled"
        results["note"] = "Model GGUF is unbundled in this release. Core offline review and FTS5 search are active."
        return results

    results["present"] = True
    results["manifest_path"] = str(manifest_file)

    schema_file = contracts_dir / "model-manifest.schema.json"
    if schema_file.exists():
        errs = validate_single_json_against_schema(manifest_file, schema_file)
        if errs:
            results["passed"] = False
            results["errors"].extend([f"model-manifest schema: {e}" for e in errs])
            return results

    try:
        with manifest_file.open("r", encoding="utf-8") as f:
            manifest = json.load(f)

        expected_hash = manifest.get("file_sha256")
        expected_size = manifest.get("file_size_bytes")

        # Locate GGUF files in models_dir
        gguf_candidates = list(models_dir.glob("*.gguf"))
        if not gguf_candidates:
            msg = f"Model manifest declared but no .gguf file found in {models_dir}"
            results["passed"] = False
            results["errors"].append(msg)
            return results

        # Find matching GGUF by hash or take first candidate
        matching_gguf = None
        for cand in gguf_candidates:
            if expected_hash and compute_sha256(cand) == expected_hash:
                matching_gguf = cand
                break
        if matching_gguf is None:
            matching_gguf = gguf_candidates[0]

        results["model_file"] = str(matching_gguf)

        actual_size = matching_gguf.stat().st_size
        if expected_size and actual_size != expected_size:
            msg = f"Model size mismatch: expected {expected_size} bytes, got {actual_size}"
            results["passed"] = False
            results["errors"].append(msg)

        actual_hash = compute_sha256(matching_gguf)
        if expected_hash and actual_hash != expected_hash:
            msg = f"Model SHA-256 hash mismatch: expected {expected_hash}, got {actual_hash}"
            results["passed"] = False
            results["errors"].append(msg)

        if results["passed"]:
            results["status"] = "verified"
    except Exception as e:
        results["passed"] = False
        results["errors"].append(f"Model audit error: {e}")

    return results


# ==============================================================================
# Release Bundler & Manifest Writer
# ==============================================================================


@dataclass
class ReleasePackage:
    version: str
    output_dir: Path
    zip_path: Path
    manifest_path: Path
    assets: dict[str, dict[str, Any]]
    all_gates_passed: bool
    summary: dict[str, Any]


def package_release(
    repo_root: Path,
    version: str,
    output_dir: Path,
    artifacts_dir: Path,
    contracts_dir: Path,
    models_dir: Path,
    skip_tests: bool = False,
    copy_to_mobile: bool = False,
) -> ReleasePackage:
    """Execute all zero-defect release gates and create the distribution bundle."""
    print(f"\n=======================================================")
    print(f" AI TUTOR AUTOMATED RELEASE PACKAGER — v{version}")
    print(f"=======================================================\n")

    # 1. Gate 1: Contract Validation
    print(">> [Gate 1/4] Validating Contract Schemas (contracts/*.schema.json)...")
    contract_results = run_contract_gate(artifacts_dir, contracts_dir)
    if not contract_results["passed"]:
        print("   [FAIL] Contract Schema Validation failed:")
        for err in contract_results["errors"][:10]:
            print(f"     - {err}")
    else:
        print(f"   [OK] All schema contracts validated successfully ({len(contract_results['files_checked'])} files checked).")

    # 2. Gate 2: Test Suites
    print("\n>> [Gate 2/4] Executing Test Suites (Python pytest + Mobile TypeScript)...")
    test_results = run_test_suites_gate(repo_root, skip_tests=skip_tests)
    if skip_tests:
        print("   [INFO] Tests bypassed via --skip-tests flag.")
    elif not test_results["passed"]:
        print("   [FAIL] One or more test suites failed:")
        for err in test_results["errors"]:
            print(f"     - {err}")
    else:
        print("   [OK] Both Python (pytest) and Mobile TypeScript test suites passed.")

    # 3. Gate 3: Content Pack SQLite Integrity
    print("\n>> [Gate 3/4] Auditing Content Pack SQLite Database...")
    db_path = artifacts_dir / "content_pack.db"
    content_pack_results = run_content_pack_gate(db_path, expected_version=version)
    if not content_pack_results["passed"]:
        print("   [FAIL] Content Pack audit failed:")
        for err in content_pack_results["errors"]:
            print(f"     - {err}")
    else:
        counts = content_pack_results["table_counts"]
        print(
            f"   [OK] Database integrity verified: {counts.get('questions', 0)} questions, "
            f"{counts.get('choices', 0)} choices, {counts.get('passages', 0)} passages with FTS5."
        )

    # 4. Gate 4: Model Manifest & GGUF
    print("\n>> [Gate 4/4] Auditing Model Manifest and GGUF Checksums...")
    model_results = run_model_gate(models_dir, contracts_dir)
    if not model_results["passed"]:
        print("   [FAIL] Model audit failed:")
        for err in model_results["errors"]:
            print(f"     - {err}")
    else:
        if model_results["present"]:
            print("   [OK] GGUF model manifest and cryptographic hash verified.")
        else:
            print(f"   [OK] Model status: {model_results['status']} ({model_results.get('note', '')})")

    # Check Zero-Defect Rule
    all_passed = (
        contract_results["passed"]
        and test_results["passed"]
        and content_pack_results["passed"]
        and model_results["passed"]
    )

    if not all_passed:
        print("\n=======================================================")
        print(" [FATAL] RELEASE ABORTED: ZERO-DEFECT QUALITY GATE FAILED")
        print("=======================================================\n")
        raise RuntimeError("Release packaging aborted due to quality gate failure.")

    # Prepare release output folder
    target_dir = output_dir / version
    target_dir.mkdir(parents=True, exist_ok=True)

    # Package Assets
    assets_manifest: dict[str, dict[str, Any]] = {}

    # Copy content_pack.db
    dest_db = target_dir / "content_pack.db"
    shutil.copy2(db_path, dest_db)
    assets_manifest["content_pack.db"] = {
        "sha256": compute_sha256(dest_db),
        "size_bytes": dest_db.stat().st_size,
    }

    # Copy content_pack_manifest.json if present
    src_cp_manifest = artifacts_dir / "content_pack_manifest.json"
    if src_cp_manifest.exists():
        dest_cp_manifest = target_dir / "content_pack_manifest.json"
        shutil.copy2(src_cp_manifest, dest_cp_manifest)
        assets_manifest["content_pack_manifest.json"] = {
            "sha256": compute_sha256(dest_cp_manifest),
            "size_bytes": dest_cp_manifest.stat().st_size,
        }

    # Copy model if present
    if model_results["present"] and model_results.get("manifest_path"):
        src_mf = Path(model_results["manifest_path"])
        dest_mf = target_dir / src_mf.name
        shutil.copy2(src_mf, dest_mf)
        assets_manifest[src_mf.name] = {
            "sha256": compute_sha256(dest_mf),
            "size_bytes": dest_mf.stat().st_size,
        }
        if model_results.get("model_file"):
            src_gguf = Path(model_results["model_file"])
            dest_gguf = target_dir / src_gguf.name
            shutil.copy2(src_gguf, dest_gguf)
            assets_manifest[src_gguf.name] = {
                "sha256": compute_sha256(dest_gguf),
                "size_bytes": dest_gguf.stat().st_size,
            }

    # Build release-manifest.json
    now = datetime.datetime.now(datetime.timezone.utc)
    release_manifest_data: dict[str, Any] = {
        "release_id": f"rel-{version}-{uuid.uuid4().hex[:8]}",
        "version": version,
        "created_at": now.isoformat(),
        "git_revision": get_git_revision(repo_root),
        "system_info": {
            "platform": platform.platform(),
            "python_version": platform.python_version(),
            "node_version": get_node_version(),
            "gpu": get_gpu_info(),
        },
        "gates": {
            "contract_validation": contract_results,
            "test_suites": {
                "passed": test_results["passed"],
                "skipped": test_results["skipped"],
                "python_passed": test_results["python"]["passed"],
                "mobile_passed": test_results["mobile"]["passed"],
            },
            "content_pack_audit": {
                "passed": content_pack_results["passed"],
                "table_counts": content_pack_results["table_counts"],
                "integrity": content_pack_results["integrity"],
                "foreign_keys": content_pack_results["foreign_keys"],
            },
            "model_audit": {
                "passed": model_results["passed"],
                "status": model_results["status"],
            },
        },
        "assets": assets_manifest,
    }

    manifest_path = target_dir / "release-manifest.json"
    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(release_manifest_data, f, indent=2)

    # Record release-manifest.json in archive catalog
    assets_manifest["release-manifest.json"] = {
        "sha256": compute_sha256(manifest_path),
        "size_bytes": manifest_path.stat().st_size,
    }

    # Create Zip Archive
    zip_filename = f"ai-tutor-release-{version}.zip"
    zip_path = target_dir / zip_filename
    if zip_path.exists():
        zip_path.unlink()

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for asset_name in assets_manifest.keys():
            file_to_pack = target_dir / asset_name
            if file_to_pack.exists() and file_to_pack != zip_path:
                zf.write(file_to_pack, arcname=asset_name)

    print(f"\n>> Generated Release Bundle:")
    print(f"   Directory: {target_dir}")
    print(f"   Manifest:  {manifest_path.name} ({manifest_path.stat().st_size} bytes)")
    print(f"   Archive:   {zip_path.name} ({zip_path.stat().st_size} bytes)")

    # Copy to Mobile Assets if requested (--copy-to-mobile)
    if copy_to_mobile:
        mobile_assets_dir = repo_root / "mobile" / "assets"
        mobile_assets_dir.mkdir(parents=True, exist_ok=True)
        print("\n>> Copying verified release assets to mobile/assets/ for iOS offline bundling:")
        # Copy release database, manifest, and model manifest (if present)
        mobile_copy_candidates = [
            "content_pack.db",
            "release-manifest.json",
            "content_pack_manifest.json",
            "model-manifest.json",
        ]
        for item in mobile_copy_candidates:
            src = target_dir / item
            if src.exists():
                dst = mobile_assets_dir / item
                shutil.copy2(src, dst)
                print(f"   Copied -> {dst} ({dst.stat().st_size} bytes)")

    return ReleasePackage(
        version=version,
        output_dir=target_dir,
        zip_path=zip_path,
        manifest_path=manifest_path,
        assets=assets_manifest,
        all_gates_passed=True,
        summary=release_manifest_data,
    )


def determine_default_version(repo_root: Path) -> str:
    """Read version from pipeline.yaml or pyproject.toml."""
    yaml_path = repo_root / "training" / "configs" / "pipeline.yaml"
    if yaml_path.exists() and yaml is not None:
        try:
            with yaml_path.open("r", encoding="utf-8") as f:
                cfg = yaml.safe_load(f)
                v = cfg.get("content_pack", {}).get("version")
                if v:
                    return str(v)
        except Exception:
            pass
    return "2026.10.1"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Automated Release Packager with Zero-Defect Quality Gates for Offline AI Tutor"
    )
    parser.add_argument(
        "--version",
        help="Semantic release version (defaults to version from pipeline.yaml)",
    )
    parser.add_argument(
        "--skip-tests",
        action="store_true",
        help="Bypass Python and Mobile test suites for rapid dev iteration",
    )
    parser.add_argument(
        "--output-dir",
        default="release/builds",
        help="Base release output directory (default: release/builds)",
    )
    parser.add_argument(
        "--artifacts-dir",
        default="training/artifacts",
        help="Artifacts directory (default: training/artifacts)",
    )
    parser.add_argument(
        "--contracts-dir",
        default="contracts",
        help="Contracts directory containing *.schema.json (default: contracts)",
    )
    parser.add_argument(
        "--models-dir",
        default="training/models",
        help="Directory containing model manifests and GGUF files (default: training/models)",
    )
    parser.add_argument(
        "--copy-to-mobile",
        action="store_true",
        help="Automatically copy verified content_pack.db and release manifest to mobile/assets/",
    )

    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parent.parent

    version = args.version or determine_default_version(repo_root)
    output_dir = repo_root / args.output_dir
    artifacts_dir = repo_root / args.artifacts_dir
    contracts_dir = repo_root / args.contracts_dir
    models_dir = repo_root / args.models_dir

    try:
        package_release(
            repo_root=repo_root,
            version=version,
            output_dir=output_dir,
            artifacts_dir=artifacts_dir,
            contracts_dir=contracts_dir,
            models_dir=models_dir,
            skip_tests=args.skip_tests,
            copy_to_mobile=args.copy_to_mobile,
        )
        print("\n[SUCCESS] Release packaging completed successfully.\n")
        return 0
    except Exception as e:
        print(f"\n[ERROR] {e}\n", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
