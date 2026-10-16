#!/usr/bin/env python3
"""Verify SHA-256 hashes of pipeline artifacts against their stage manifests.

Usage:
    python scripts/verify_artifacts.py <artifacts_dir>
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


def compute_sha256(file_path: Path) -> str:
    """Compute the SHA-256 hex digest of a file."""
    sha = hashlib.sha256()
    with file_path.open("rb") as f:
        while chunk := f.read(65536):
            sha.update(chunk)
    return sha.hexdigest()


def verify_manifest(manifest_path: Path) -> list[str]:
    """Verify all output hashes in a manifest file.

    Returns a list of error strings (empty if all verified).
    """
    errors: list[str] = []
    try:
        with manifest_path.open("r", encoding="utf-8") as f:
            manifest = json.load(f)
    except Exception as e:
        return [f"Failed to read manifest {manifest_path}: {e}"]

    output_hashes = manifest.get("output_hashes", {})
    if not output_hashes:
        return [f"Manifest {manifest_path} contains no output_hashes"]

    for rel_or_abs_path, expected_hash in output_hashes.items():
        # Check relative to manifest parent or repo or absolute
        candidate = Path(rel_or_abs_path)
        if not candidate.is_absolute():
            candidate = manifest_path.parent / candidate
            if not candidate.exists():
                # Try relative to cwd
                candidate = Path.cwd() / rel_or_abs_path

        if not candidate.exists():
            errors.append(f"Missing artifact: {rel_or_abs_path} (from {manifest_path.name})")
            continue

        actual_hash = compute_sha256(candidate)
        if actual_hash != expected_hash:
            errors.append(
                f"Hash mismatch for {candidate.name}: expected {expected_hash}, got {actual_hash}"
            )

    return errors


def main() -> int:
    artifacts_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("training/artifacts")
    if not artifacts_dir.exists():
        print(f"Artifacts directory not found: {artifacts_dir}")
        return 1

    manifest_files = list(artifacts_dir.glob("*manifest*.json"))
    if not manifest_files:
        print(f"No manifest files found in {artifacts_dir}")
        return 0

    print(f"Found {len(manifest_files)} manifest(s) in {artifacts_dir}:")
    total_errors: list[str] = []

    for manifest_path in manifest_files:
        print(f"  Verifying {manifest_path.name}...")
        errs = verify_manifest(manifest_path)
        if errs:
            total_errors.extend(errs)
            for err in errs:
                print(f"    [FAIL] {err}")
        else:
            print("    [OK] All output hashes verified.")

    if total_errors:
        print(f"\nVerification failed with {len(total_errors)} error(s).")
        return 1

    print("\nAll artifacts verified successfully against manifests.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
