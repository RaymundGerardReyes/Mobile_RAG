"""Tests for automated Semantic Versioning 2.0.0 tool (scripts/bump_version.py)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Ensure scripts directory is on sys.path for testing
repo_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(repo_root / "scripts"))

from bump_version import (
    SemVer,
    bump_app,
    bump_content_pack,
    detect_bump_from_git_commits,
    update_file_regex,
)

pytestmark = [pytest.mark.unit, pytest.mark.regression]


def test_semver_parse_valid() -> None:
    v = SemVer.parse("1.4.2")
    assert v.major == 1
    assert v.minor == 4
    assert v.patch == 2
    assert v.prerelease is None
    assert str(v) == "1.4.2"

    v_pre = SemVer.parse("2.0.0-alpha.1+build.123")
    assert v_pre.major == 2
    assert v_pre.minor == 0
    assert v_pre.patch == 0
    assert v_pre.prerelease == "alpha.1"
    assert v_pre.buildmetadata == "build.123"
    assert str(v_pre) == "2.0.0-alpha.1+build.123"


def test_semver_reject_invalid_leading_zeros() -> None:
    with pytest.raises(ValueError, match="Invalid SemVer 2.0.0"):
        SemVer.parse("01.4.2")

    with pytest.raises(ValueError, match="Invalid SemVer 2.0.0"):
        SemVer.parse("1.04.2")

    with pytest.raises(ValueError, match="Invalid SemVer 2.0.0"):
        SemVer.parse("1.4.02")

    with pytest.raises(ValueError, match="Invalid SemVer 2.0.0"):
        SemVer.parse("v1.4.2")


def test_semver_exact_bump_rules() -> None:
    base = SemVer.parse("1.4.2")

    # MAJOR: 1.4.2 -> 2.0.0 (MINOR and PATCH reset to 0)
    v_major = base.bump("major")
    assert str(v_major) == "2.0.0"

    # MINOR: 1.4.2 -> 1.5.0 (PATCH resets to 0)
    v_minor = base.bump("minor")
    assert str(v_minor) == "1.5.0"

    # PATCH: 1.4.2 -> 1.4.3
    v_patch = base.bump("patch")
    assert str(v_patch) == "1.4.3"


def test_bump_app_multi_file_sync(tmp_path: Path) -> None:
    # Set up mock repository files
    root_pyproject = tmp_path / "pyproject.toml"
    root_pyproject.write_text('[project]\nname = "test"\nversion = "0.1.0"\n', encoding="utf-8")

    training_dir = tmp_path / "training"
    training_dir.mkdir(parents=True)
    training_pyproject = training_dir / "pyproject.toml"
    training_pyproject.write_text('[project]\nname = "training"\nversion = "0.1.0"\n', encoding="utf-8")

    mobile_dir = tmp_path / "mobile"
    mobile_dir.mkdir(parents=True)
    package_json = mobile_dir / "package.json"
    package_json.write_text('{\n  "name": "mobile",\n  "version": "0.1.0"\n}\n', encoding="utf-8")

    # Bump minor: 0.1.0 -> 0.2.0
    old_v, new_v = bump_app(tmp_path, "minor")
    assert str(old_v) == "0.1.0"
    assert str(new_v) == "0.2.0"

    # Verify all 3 files updated
    assert 'version = "0.2.0"' in root_pyproject.read_text(encoding="utf-8")
    assert 'version = "0.2.0"' in training_pyproject.read_text(encoding="utf-8")
    assert '"version": "0.2.0"' in package_json.read_text(encoding="utf-8")


def test_bump_app_dry_run_does_not_modify(tmp_path: Path) -> None:
    root_pyproject = tmp_path / "pyproject.toml"
    root_pyproject.write_text('[project]\nname = "test"\nversion = "1.0.0"\n', encoding="utf-8")

    old_v, new_v = bump_app(tmp_path, "patch", dry_run=True)
    assert str(old_v) == "1.0.0"
    assert str(new_v) == "1.0.1"

    # File should remain unchanged
    assert 'version = "1.0.0"' in root_pyproject.read_text(encoding="utf-8")


def test_bump_content_pack_sync(tmp_path: Path) -> None:
    configs_dir = tmp_path / "training" / "configs"
    configs_dir.mkdir(parents=True)
    yaml_file = configs_dir / "pipeline.yaml"
    yaml_file.write_text(
        'link_qa_pairs:\n  content_version: "1.0.0"\ncontent_pack:\n  version: "1.0.0"\n',
        encoding="utf-8",
    )

    old_v, new_v = bump_content_pack(tmp_path, "minor")
    assert old_v == "1.0.0"
    assert new_v == "1.1.0"

    content = yaml_file.read_text(encoding="utf-8")
    assert 'content_version: "1.1.0"' in content
    assert 'version: "1.1.0"' in content
