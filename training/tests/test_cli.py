"""Unit and integration tests for the AI Tutor CLI (ai_tutor_training.cli)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from click.testing import CliRunner
import yaml

from ai_tutor_training.cli import cli, load_yaml_config, main

pytestmark = pytest.mark.integration


@pytest.fixture
def cli_runner() -> CliRunner:
    return CliRunner()


@pytest.fixture
def temp_pipeline_config(tmp_path: Path, sample_pdf: Path) -> Path:
    """Generate a self-contained pipeline.yaml pointing to tmp_path."""
    cfg_data = {
        "source": {"pdf_path": str(sample_pdf).replace("\\", "/")},
        "extract_textbook": {
            "output_path": str(tmp_path / "extracted_pages.jsonl").replace("\\", "/"),
            "manifest_path": str(tmp_path / "extract_manifest.json").replace("\\", "/"),
            "chapter_heading_patterns": [
                r"^(?:CHAPTER|Chapter|KABANATA|Kabanata)\s+[\dIVXLCDM]+[.:]?\s*(.*)",
            ],
            "section_heading_patterns": [
                r"^(?:Section|Seksyon)\s+[\dIVXLCDM]+[.:]?\s*(.*)",
            ],
        },
        "link_qa_pairs": {
            "content_version": "2026.10.1",
            "input_path": str(tmp_path / "extracted_pages.jsonl").replace("\\", "/"),
            "output_path": str(tmp_path / "linked_questions.jsonl").replace("\\", "/"),
            "manifest_path": str(tmp_path / "link_manifest.json").replace("\\", "/"),
            "question_patterns": [r"^\s*(\d{1,4})[.)]\s+(.*)"],
            "choice_patterns": [r"^\s*([A-Da-d])[.)]\s+(.*)"],
            "answer_key_header_patterns": [r"(?i)(?:answer\s+key|susi\s+sa\s+pagwawasto)"],
            "answer_key_item_patterns": [r"(\d{1,4})\s*[-–—:]\s*([A-Da-d])\b"],
        },
        "build_passages": {
            "input_path": str(tmp_path / "extracted_pages.jsonl").replace("\\", "/"),
            "output_path": str(tmp_path / "passages.jsonl").replace("\\", "/"),
            "manifest_path": str(tmp_path / "passages_manifest.json").replace("\\", "/"),
            "max_passage_words": 300,
            "overlap_words": 50,
        },
        "content_pack": {
            "input_questions_path": str(tmp_path / "linked_questions.jsonl").replace("\\", "/"),
            "input_passages_path": str(tmp_path / "passages.jsonl").replace("\\", "/"),
            "output_path": str(tmp_path / "content_pack.db").replace("\\", "/"),
            "manifest_path": str(tmp_path / "content_pack_manifest.json").replace("\\", "/"),
            "version": "2026.10.1",
        },
    }
    cfg_file = tmp_path / "test_pipeline.yaml"
    with cfg_file.open("w", encoding="utf-8") as f:
        yaml.safe_dump(cfg_data, f)
    return cfg_file


def test_cli_help(cli_runner: CliRunner) -> None:
    """Root CLI displays help and subcommands."""
    result = cli_runner.invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "AI Tutor offline preparation and training pipeline" in result.output
    for cmd in ["extract", "link", "build-passages", "build-content-pack", "validate", "run-all", "justify", "export-sft"]:
        assert cmd in result.output


def test_subcommand_helps(cli_runner: CliRunner) -> None:
    """Each subcommand provides descriptive --help."""
    for cmd in ["extract", "link", "build-passages", "build-content-pack", "validate", "run-all", "justify", "export-sft"]:
        res = cli_runner.invoke(cli, [cmd, "--help"])
        assert res.exit_code == 0, f"--help failed for {cmd}"
        assert "Usage:" in res.output


def test_missing_config_error_handling(cli_runner: CliRunner, tmp_path: Path) -> None:
    """Missing config file raises ClickException gracefully without unhandled traceback."""
    nonexistent = tmp_path / "missing_config.yaml"
    res = cli_runner.invoke(cli, ["extract", "--config", str(nonexistent)])
    assert res.exit_code != 0
    assert "Configuration file not found" in res.output

    res2 = cli_runner.invoke(cli, ["link", "--config", str(nonexistent)])
    assert res2.exit_code != 0
    assert "Configuration file not found" in res2.output

    res3 = cli_runner.invoke(cli, ["build-passages", "--config", str(nonexistent)])
    assert res3.exit_code != 0
    assert "Configuration file not found" in res3.output

    res4 = cli_runner.invoke(cli, ["build-content-pack", "--config", str(nonexistent)])
    assert res4.exit_code != 0
    assert "Configuration file not found" in res4.output

    res5 = cli_runner.invoke(cli, ["run-all", "--config", str(nonexistent)])
    assert res5.exit_code != 0
    assert "Configuration file not found" in res5.output


def test_cmd_extract(cli_runner: CliRunner, sample_pdf: Path, temp_pipeline_config: Path, tmp_path: Path) -> None:
    """Execute 'extract' subcommand with overrides."""
    out_jsonl = tmp_path / "custom_extract.jsonl"
    out_manifest = tmp_path / "custom_manifest.json"
    res = cli_runner.invoke(
        cli,
        [
            "extract",
            "--config",
            str(temp_pipeline_config),
            "--pdf",
            str(sample_pdf),
            "--output",
            str(out_jsonl),
            "--manifest",
            str(out_manifest),
        ],
    )
    assert res.exit_code == 0, f"extract failed: {res.output}"
    assert "Successfully extracted" in res.output
    assert out_jsonl.exists()
    assert out_manifest.exists()


def test_cmd_link(cli_runner: CliRunner, sample_pages_path: Path, temp_pipeline_config: Path, tmp_path: Path) -> None:
    """Execute 'link' subcommand with overrides."""
    out_jsonl = tmp_path / "custom_link.jsonl"
    out_manifest = tmp_path / "custom_link_manifest.json"
    res = cli_runner.invoke(
        cli,
        [
            "link",
            "--config",
            str(temp_pipeline_config),
            "--input",
            str(sample_pages_path),
            "--output",
            str(out_jsonl),
            "--manifest",
            str(out_manifest),
        ],
    )
    assert res.exit_code == 0, f"link failed: {res.output}"
    assert "Successfully linked" in res.output
    assert out_jsonl.exists()
    assert out_manifest.exists()


def test_cmd_build_passages(cli_runner: CliRunner, sample_pages_path: Path, temp_pipeline_config: Path, tmp_path: Path) -> None:
    """Execute 'build-passages' subcommand with overrides."""
    out_jsonl = tmp_path / "custom_passages.jsonl"
    out_manifest = tmp_path / "custom_passages_manifest.json"
    res = cli_runner.invoke(
        cli,
        [
            "build-passages",
            "--config",
            str(temp_pipeline_config),
            "--input",
            str(sample_pages_path),
            "--output",
            str(out_jsonl),
            "--manifest",
            str(out_manifest),
        ],
    )
    assert res.exit_code == 0, f"build-passages failed: {res.output}"
    assert "Successfully built" in res.output
    assert out_jsonl.exists()
    assert out_manifest.exists()


def test_cmd_build_content_pack(
    cli_runner: CliRunner,
    sample_linked_questions_path: Path,
    sample_passages_path: Path,
    temp_pipeline_config: Path,
    tmp_path: Path,
) -> None:
    """Execute 'build-content-pack' subcommand with overrides and --version / --manifest."""
    out_db = tmp_path / "custom_content_pack.db"
    out_manifest = tmp_path / "custom_cp_manifest.json"
    res = cli_runner.invoke(
        cli,
        [
            "build-content-pack",
            "--config",
            str(temp_pipeline_config),
            "--questions",
            str(sample_linked_questions_path),
            "--passages",
            str(sample_passages_path),
            "--output",
            str(out_db),
            "--version",
            "2026.11.0",
            "--manifest",
            str(out_manifest),
        ],
    )
    assert res.exit_code == 0, f"build-content-pack failed: {res.output}"
    assert "Successfully built content pack" in res.output
    assert out_db.exists()
    assert out_manifest.exists()


def test_cmd_validate_success_and_failure(
    cli_runner: CliRunner,
    sample_pages_path: Path,
    contracts_dir: Path,
    tmp_path: Path,
) -> None:
    """Execute 'validate' command on valid and invalid files."""
    schema_path = contracts_dir / "extracted-page.schema.json"

    # Success path
    res_ok = cli_runner.invoke(
        cli,
        ["validate", "--artifact", str(sample_pages_path), "--schema", str(schema_path)],
    )
    assert res_ok.exit_code == 0
    assert "Validation passed" in res_ok.output

    # Failure path
    bad_artifact = tmp_path / "bad.jsonl"
    bad_artifact.write_text(json.dumps({"invalid": "payload"}) + "\n", encoding="utf-8")
    res_fail = cli_runner.invoke(
        cli,
        ["validate", "--artifact", str(bad_artifact), "--schema", str(schema_path)],
    )
    assert res_fail.exit_code != 0
    assert "Validation FAILED" in res_fail.output


def test_cmd_run_all(cli_runner: CliRunner, temp_pipeline_config: Path, tmp_path: Path) -> None:
    """Execute full sequential pipeline via 'run-all' subcommand."""
    res = cli_runner.invoke(cli, ["run-all", "--config", str(temp_pipeline_config)])
    assert res.exit_code == 0, f"run-all failed: {res.output}"
    assert "Step 1/4: Extracting Textbook" in res.output
    assert "Step 2/4: Linking QA Pairs" in res.output
    assert "Step 3/4: Building Passages" in res.output
    assert "Step 4/4: Building Content Pack" in res.output
    assert "Pipeline completed successfully!" in res.output

    assert (tmp_path / "extracted_pages.jsonl").exists()
    assert (tmp_path / "linked_questions.jsonl").exists()
    assert (tmp_path / "passages.jsonl").exists()
    assert (tmp_path / "content_pack.db").exists()


def test_cli_main_entrypoint() -> None:
    """Verify main entrypoint invokes cli when click is installed."""
    with patch("ai_tutor_training.cli.cli") as mock_cli:
        main()
        assert mock_cli.called


def test_cli_subcommands_invalid_inputs(
    cli_runner: CliRunner,
    temp_pipeline_config: Path,
    contracts_dir: Path,
    tmp_path: Path,
) -> None:
    """Subcommands fail cleanly with non-zero exit code on invalid/missing inputs."""
    schema_path = contracts_dir / "extracted-page.schema.json"

    # 1. Unknown subcommand
    res_unknown = cli_runner.invoke(cli, ["invalid-subcommand"])
    assert res_unknown.exit_code != 0

    # 2. validate with missing required options
    res_no_art = cli_runner.invoke(cli, ["validate", "--schema", str(schema_path)])
    assert res_no_art.exit_code != 0
    assert "Missing option" in res_no_art.output

    res_no_sch = cli_runner.invoke(cli, ["validate", "--artifact", str(tmp_path / "dummy.jsonl")])
    assert res_no_sch.exit_code != 0
    assert "Missing option" in res_no_sch.output

    # 3. validate with non-existent file
    res_missing_file = cli_runner.invoke(
        cli,
        ["validate", "--artifact", str(tmp_path / "nonexistent.jsonl"), "--schema", str(schema_path)],
    )
    assert res_missing_file.exit_code != 0

    # 4. extract with non-existent PDF
    res_bad_pdf = cli_runner.invoke(
        cli,
        ["extract", "--config", str(temp_pipeline_config), "--pdf", str(tmp_path / "ghost.pdf")],
    )
    assert res_bad_pdf.exit_code != 0

    # 5. link with non-existent input
    res_bad_link = cli_runner.invoke(
        cli,
        ["link", "--config", str(temp_pipeline_config), "--input", str(tmp_path / "ghost.jsonl")],
    )
    assert res_bad_link.exit_code != 0

    # 6. build-passages with non-existent input
    res_bad_pass = cli_runner.invoke(
        cli,
        ["build-passages", "--config", str(temp_pipeline_config), "--input", str(tmp_path / "ghost.jsonl")],
    )
    assert res_bad_pass.exit_code != 0

    # 7. build-content-pack with non-existent inputs
    res_bad_cp = cli_runner.invoke(
        cli,
        [
            "build-content-pack",
            "--config",
            str(temp_pipeline_config),
            "--questions",
            str(tmp_path / "ghost_q.jsonl"),
            "--passages",
            str(tmp_path / "ghost_p.jsonl"),
        ],
    )
    assert res_bad_cp.exit_code != 0


def test_cmd_justify_and_export_sft(
    cli_runner: CliRunner,
    sample_linked_questions_path: Path,
    sample_passages_path: Path,
    tmp_path: Path,
    temp_pipeline_config: Path,
) -> None:
    """Verify justify and export-sft CLI subcommands."""
    db_out = tmp_path / "cli_test_content_pack.db"
    res_cp = cli_runner.invoke(
        cli,
        [
            "build-content-pack",
            "--config",
            str(temp_pipeline_config),
            "--questions",
            str(sample_linked_questions_path),
            "--passages",
            str(sample_passages_path),
            "--output",
            str(db_out),
        ],
    )
    assert res_cp.exit_code == 0
    assert db_out.exists()

    # Test justify subcommand
    res_just = cli_runner.invoke(
        cli,
        [
            "justify",
            "--db",
            str(db_out),
            "-q",
            "q0001",
        ],
    )
    assert res_just.exit_code == 0
    assert "=== Question:" in res_just.output
    assert "Retrieval Trace" in res_just.output

    # Test export-sft subcommand
    sft_out = tmp_path / "cli_sft.jsonl"
    res_sft = cli_runner.invoke(
        cli,
        [
            "export-sft",
            "--db",
            str(db_out),
            "--output",
            str(sft_out),
            "--version",
            "2026.10.1",
        ],
    )
    assert res_sft.exit_code == 0
    assert sft_out.exists()
    with sft_out.open("r", encoding="utf-8") as f:
        records = [json.loads(line) for line in f if line.strip()]
    assert len(records) > 0


def test_content_pack_main_entrypoint(
    sample_linked_questions_path: Path,
    sample_passages_path: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify standalone main() entrypoint in content_pack.py."""
    from ai_tutor_training.content_pack import main as cp_main

    out_db = tmp_path / "cp_standalone.db"
    manifest_out = tmp_path / "cp_manifest.json"

    test_args = [
        "content_pack.py",
        "--questions",
        str(sample_linked_questions_path),
        "--passages",
        str(sample_passages_path),
        "--output",
        str(out_db),
        "--manifest",
        str(manifest_out),
        "--version",
        "2026.10.1",
    ]
    monkeypatch.setattr("sys.argv", test_args)
    exit_code = cp_main()
    assert exit_code == 0
    assert out_db.exists()
    assert manifest_out.exists()


