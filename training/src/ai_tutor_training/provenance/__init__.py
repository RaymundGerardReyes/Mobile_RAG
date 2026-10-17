"""Provenance and stage manifest generation for auditable reproducibility."""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import platform
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any


def compute_sha256(path: Path | str) -> str:
    """Compute SHA-256 hex digest for a file."""
    p = Path(path)
    if not p.exists() or not p.is_file():
        raise FileNotFoundError(f"File not found for hashing: {p}")
    sha = hashlib.sha256()
    with p.open("rb") as f:
        while chunk := f.read(65536):
            sha.update(chunk)
    return sha.hexdigest()


def compute_dict_hash(data: dict[str, Any]) -> str:
    """Compute SHA-256 for a serializable dictionary."""
    raw = json.dumps(data, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def get_git_revision() -> str | None:
    """Attempt to retrieve the current git commit SHA, if available."""
    try:
        res = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )
        return res.stdout.strip()
    except Exception:
        return None


def get_gpu_name() -> str | None:
    """Detect NVIDIA GPU name via torch or nvidia-smi if available."""
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            return str(torch.cuda.get_device_name(0))
    except Exception:
        pass

    try:
        res = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )
        lines = [line.strip() for line in res.stdout.splitlines() if line.strip()]
        if lines:
            return lines[0]
    except Exception:
        pass
    return None


def get_key_packages() -> dict[str, str]:
    """Capture versions of core libraries."""
    import importlib.metadata

    pkgs = ["pymupdf", "fitz", "jsonschema", "pyyaml", "click", "pytest", "torch"]
    out: dict[str, str] = {}
    for pkg in pkgs:
        try:
            out[pkg] = importlib.metadata.version(pkg)
        except importlib.metadata.PackageNotFoundError:
            try:
                mod = __import__(pkg)
                v = getattr(mod, "__version__", None)
                if v:
                    out[pkg] = str(v)
            except Exception:
                pass
    return out


def create_stage_manifest(
    stage: str,
    started_at: datetime.datetime,
    ended_at: datetime.datetime,
    status: str,
    input_files: dict[str, Path | str],
    output_files: dict[str, Path | str],
    config: dict[str, Any] | None = None,
    record_count: int | None = None,
    warnings: list[str] | None = None,
    error_code: str | None = None,
    error_summary: str | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    """Build a manifest conforming to stage-manifest.schema.json."""
    duration_ms = int((ended_at - started_at).total_seconds() * 1000)

    input_hashes: dict[str, str] = {}
    for name, path in input_files.items():
        p = Path(path)
        if p.exists() and p.is_file():
            input_hashes[str(p.name)] = compute_sha256(p)
        else:
            input_hashes[str(name)] = "NOT_FOUND"

    output_hashes: dict[str, str] = {}
    for name, path in output_files.items():
        p = Path(path)
        if p.exists() and p.is_file():
            output_hashes[str(p.name)] = compute_sha256(p)
        else:
            output_hashes[str(name)] = "NOT_FOUND"

    manifest: dict[str, Any] = {
        "run_id": run_id or str(uuid.uuid4()),
        "stage": stage,
        "started_at": started_at.isoformat(),
        "ended_at": ended_at.isoformat(),
        "duration_ms": max(0, duration_ms),
        "status": status,
        "input_hashes": input_hashes,
        "output_hashes": output_hashes,
        "config_hash": compute_dict_hash(config) if config is not None else None,
        "git_revision": get_git_revision(),
        "python_version": sys.version.split()[0],
        "package_versions": get_key_packages(),
        "gpu_name": get_gpu_name(),
        "record_count": record_count,
        "warnings": warnings or [],
        "error_code": error_code,
        "error_summary": error_summary,
    }
    return manifest


def save_stage_manifest(manifest: dict[str, Any], output_path: Path | str) -> None:
    """Save stage manifest to JSON file atomically."""
    p = Path(output_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    temp_p = p.parent / f"{p.name}.tmp.{uuid.uuid4().hex}"
    try:
        with temp_p.open("w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        os.replace(temp_p, p)
    except Exception:
        if temp_p.exists():
            try:
                temp_p.unlink()
            except Exception:
                pass
        raise
