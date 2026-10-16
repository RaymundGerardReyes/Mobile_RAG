#!/usr/bin/env python3
"""Automated Semantic Versioning (SemVer 2.0.0) bump utility.

Adheres strictly to the SemVer 2.0.0 specification (https://semver.org):
- MAJOR: Incompatible API changes (resets MINOR and PATCH to 0)
- MINOR: Backward-compatible functionality (resets PATCH to 0)
- PATCH: Backward-compatible bug fixes
- Validates: non-negative integers without leading zeros.
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

# Strict SemVer 2.0.0 regex
SEMVER_REGEX = re.compile(
    r"^(?P<major>0|[1-9]\d*)\."
    r"(?P<minor>0|[1-9]\d*)\."
    r"(?P<patch>0|[1-9]\d*)"
    r"(?:-(?P<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)"
    r"(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+(?P<buildmetadata>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
)

BumpType = Literal["major", "minor", "patch", "auto"]
ComponentType = Literal["app", "content-pack"]


@dataclass(frozen=True)
class SemVer:
    major: int
    minor: int
    patch: int
    prerelease: str | None = None
    buildmetadata: str | None = None

    @classmethod
    def parse(cls, version_str: str) -> SemVer:
        match = SEMVER_REGEX.match(version_str.strip())
        if not match:
            raise ValueError(
                f"Invalid SemVer 2.0.0 string: '{version_str}'. "
                "Must be in format MAJOR.MINOR.PATCH without leading zeroes."
            )
        gd = match.groupdict()
        return cls(
            major=int(gd["major"]),
            minor=int(gd["minor"]),
            patch=int(gd["patch"]),
            prerelease=gd.get("prerelease"),
            buildmetadata=gd.get("buildmetadata"),
        )

    def bump(self, bump_type: Literal["major", "minor", "patch"]) -> SemVer:
        if bump_type == "major":
            return SemVer(major=self.major + 1, minor=0, patch=0)
        elif bump_type == "minor":
            return SemVer(major=self.major, minor=self.minor + 1, patch=0)
        elif bump_type == "patch":
            return SemVer(major=self.major, minor=self.minor, patch=self.patch + 1)
        raise ValueError(f"Unknown bump type: {bump_type}")

    def __str__(self) -> str:
        s = f"{self.major}.{self.minor}.{self.patch}"
        if self.prerelease:
            s += f"-{self.prerelease}"
        if self.buildmetadata:
            s += f"+{self.buildmetadata}"
        return s


def detect_bump_from_git_commits(repo_root: Path, tag_prefix: str = "v") -> Literal["major", "minor", "patch"]:
    """Analyze commit messages since the last git tag to determine SemVer increment."""
    try:
        # Find latest tag matching prefix
        tag_proc = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=0", f"--match={tag_prefix}*"],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            check=False,
        )
        latest_tag = tag_proc.stdout.strip()
        
        rev_range = f"{latest_tag}..HEAD" if latest_tag else "HEAD"
        log_proc = subprocess.run(
            ["git", "log", rev_range, "--pretty=format:%B---COMMIT_SPLIT---"],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            check=False,
        )
        commits = [c.strip() for c in log_proc.stdout.split("---COMMIT_SPLIT---") if c.strip()]
    except Exception:
        commits = []

    if not commits:
        return "patch"

    has_breaking = False
    has_feat = False

    for msg in commits:
        if "BREAKING CHANGE:" in msg or re.search(r"^[a-z]+(\([^\)]+\))?!:", msg, re.MULTILINE):
            has_breaking = True
            break
        if re.search(r"^feat(\([^\)]+\))?:", msg, re.MULTILINE):
            has_feat = True

    if has_breaking:
        return "major"
    if has_feat:
        return "minor"
    return "patch"


def update_file_regex(file_path: Path, pattern: str, replacement: str, dry_run: bool = False) -> bool:
    """Safely replace a regex pattern in a file."""
    if not file_path.exists():
        return False
    content = file_path.read_text(encoding="utf-8")
    new_content, count = re.subn(pattern, replacement, content, count=1, flags=re.MULTILINE)
    if count == 0:
        return False
    if not dry_run:
        file_path.write_text(new_content, encoding="utf-8")
    return True


def get_current_app_version(repo_root: Path) -> SemVer:
    root_pyproject = repo_root / "pyproject.toml"
    if root_pyproject.exists():
        content = root_pyproject.read_text(encoding="utf-8")
        match = re.search(r'^\s*version\s*=\s*"([^"]+)"', content, re.MULTILINE)
        if match:
            return SemVer.parse(match.group(1))
    return SemVer(0, 1, 0)


def get_current_content_version(repo_root: Path) -> str:
    yaml_path = repo_root / "training" / "configs" / "pipeline.yaml"
    if yaml_path.exists():
        content = yaml_path.read_text(encoding="utf-8")
        match = re.search(r'^\s*version:\s*"([^"]+)"', content, re.MULTILINE)
        if match:
            return match.group(1)
    return "2026.10.1"


def bump_app(repo_root: Path, bump: Literal["major", "minor", "patch"], dry_run: bool = False) -> tuple[SemVer, SemVer]:
    current_ver = get_current_app_version(repo_root)
    new_ver = current_ver.bump(bump)

    files_to_update = [
        (repo_root / "pyproject.toml", r'^(version\s*=\s*)"[^"]+"', rf'\g<1>"{new_ver}"'),
        (repo_root / "training" / "pyproject.toml", r'^(version\s*=\s*)"[^"]+"', rf'\g<1>"{new_ver}"'),
        (repo_root / "training" / "src" / "ai_tutor_training" / "__init__.py", r'(__version__\s*=\s*)"[^"]+"', rf'\g<1>"{new_ver}"'),
        (repo_root / "mobile" / "package.json", r'("version"\s*:\s*)"[^"]+"', rf'\g<1>"{new_ver}"'),
        (repo_root / "mobile" / "package-lock.json", r'("version"\s*:\s*)"[^"]+"', rf'\g<1>"{new_ver}"'),
    ]

    for file_path, pattern, repl in files_to_update:
        if file_path.exists():
            update_file_regex(file_path, pattern, repl, dry_run=dry_run)

    return current_ver, new_ver


def bump_content_pack(repo_root: Path, bump: Literal["major", "minor", "patch"], dry_run: bool = False) -> tuple[str, str]:
    current_ver_str = get_current_content_version(repo_root)
    # Check if CalVer or SemVer
    try:
        current_semver = SemVer.parse(current_ver_str)
        new_semver = current_semver.bump(bump)
        new_ver_str = str(new_semver)
    except ValueError:
        # CalVer fallback: YYYY.MM.PATCH
        parts = current_ver_str.split(".")
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit() and parts[2].isdigit():
            old_year, old_month, old_patch = int(parts[0]), int(parts[1]), int(parts[2])
            now = datetime.datetime.now(datetime.timezone.utc)
            if now.year == old_year and now.month == old_month:
                patch = old_patch + 1
            else:
                patch = 1
            new_ver_str = f"{now.year}.{now.month}.{patch}"
        else:
            new_ver_str = f"{current_ver_str}.1"

    config_path = repo_root / "training" / "configs" / "pipeline.yaml"
    if config_path.exists():
        update_file_regex(config_path, r'(version:\s*)"[^"]+"', rf'\g<1>"{new_ver_str}"', dry_run=dry_run)
        update_file_regex(config_path, r'(content_version:\s*)"[^"]+"', rf'\g<1>"{new_ver_str}"', dry_run=dry_run)

    return current_ver_str, new_ver_str


def append_changelog(repo_root: Path, component: str, new_ver: str, dry_run: bool = False) -> None:
    changelog_path = repo_root / "CHANGELOG.md"
    today = datetime.date.today().isoformat()
    entry = f"\n## [{component} v{new_ver}] - {today}\n- Automated semantic release increment.\n"
    if not dry_run:
        if changelog_path.exists():
            content = changelog_path.read_text(encoding="utf-8")
            changelog_path.write_text(content + entry, encoding="utf-8")
        else:
            header = "# Changelog\nAll notable changes to this project will be documented in this file.\n"
            changelog_path.write_text(header + entry, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Automated Semantic Versioning (SemVer 2.0.0) Tool for Offline AI Tutor"
    )
    parser.add_argument(
        "component",
        choices=["app", "content-pack"],
        help="Target component to bump ('app' for software code, 'content-pack' for database reviewer)",
    )
    parser.add_argument(
        "bump",
        choices=["major", "minor", "patch", "auto"],
        help="Type of bump: major (breaking), minor (feature), patch (fix), or auto (Conventional Commits)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview version changes without writing files")
    parser.add_argument("--no-tag", action="store_true", help="Skip creating git tags")

    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parent.parent

    bump_action = args.bump
    if bump_action == "auto":
        tag_prefix = "v" if args.component == "app" else "content-v"
        bump_action = detect_bump_from_git_commits(repo_root, tag_prefix=tag_prefix)
        print(f"[SemVer Auto-Detection] Analyzed unreleased git commits -> Bumping '{bump_action}'")

    if args.component == "app":
        old_v, new_v = bump_app(repo_root, bump_action, dry_run=args.dry_run)
        tag_name = f"v{new_v}"
        print(f"[App Version] {old_v} -> {new_v} ({bump_action.upper()})")
    else:
        old_v, new_v = bump_content_pack(repo_root, bump_action, dry_run=args.dry_run)
        tag_name = f"content-v{new_v}"
        print(f"[Content Pack Version] {old_v} -> {new_v} ({bump_action.upper()})")

    if args.dry_run:
        print("[Dry Run] No files modified and no git tags created.")
        return 0

    append_changelog(repo_root, args.component, str(new_v), dry_run=args.dry_run)
    print(f"Updated CHANGELOG.md for {args.component} v{new_v}")

    if not args.no_tag:
        try:
            subprocess.run(
                ["git", "tag", "-a", tag_name, "-m", f"Release {args.component} {new_v}"],
                cwd=str(repo_root),
                check=False,
                capture_output=True,
            )
            print(f"Created annotated git tag: {tag_name}")
        except Exception as e:
            print(f"Warning: Failed to create git tag {tag_name}: {e}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
