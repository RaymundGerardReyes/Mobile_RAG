"""CLI interface for the AI Tutor data preparation pipeline."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

try:
    import click
except ImportError:
    click = None

try:
    import yaml
except ImportError:
    yaml = None

from ai_tutor_training.content_pack import build_content_pack
from ai_tutor_training.contracts import validate_jsonl_against_schema
from ai_tutor_training.stages.build_passages import build_passages
from ai_tutor_training.stages.extract_textbook import extract_textbook
from ai_tutor_training.stages.link_qa_pairs import link_qa_pairs


def load_yaml_config(config_path: Path | str) -> dict[str, Any]:
    """Load configuration from a YAML file."""
    p = Path(config_path)
    if not p.exists():
        raise FileNotFoundError(f"Configuration file not found: {p}")
    if yaml is None:
        raise ImportError("pyyaml is required to parse YAML configurations. Install via: pip install pyyaml")
    with p.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


if click is not None:

    @click.group()
    def cli() -> None:
        """AI Tutor offline preparation and training pipeline."""
        pass

    @cli.command("extract")
    @click.option("--config", "-c", default="configs/pipeline.yaml", help="Path to pipeline YAML config.")
    @click.option("--pdf", help="Override source PDF path.")
    @click.option("--output", help="Override output JSONL path.")
    def cmd_extract(config: str, pdf: str | None, output: str | None) -> None:
        """Extract raw pages from textbook PDF."""
        cfg = load_yaml_config(config)
        pdf_path = pdf or cfg.get("source", {}).get("pdf_path", "data/raw/reviewer.pdf")
        click.echo(f"Running extract_textbook on {pdf_path}...")
        pages = extract_textbook(pdf_path, config=cfg, output_path=output)
        click.echo(f"Successfully extracted {len(pages)} pages.")

    @cli.command("link")
    @click.option("--config", "-c", default="configs/pipeline.yaml", help="Path to pipeline YAML config.")
    @click.option("--input", help="Override input extracted_pages.jsonl path.")
    @click.option("--output", help="Override output linked_questions.jsonl path.")
    def cmd_link(config: str, input: str | None, output: str | None) -> None:
        """Link question stems, choices, and answer keys."""
        cfg = load_yaml_config(config)
        inp_path = input or cfg.get("link_qa_pairs", {}).get("input_path", "artifacts/extracted_pages.jsonl")
        click.echo(f"Running link_qa_pairs on {inp_path}...")
        records = link_qa_pairs(inp_path, config=cfg, output_path=output)
        click.echo(f"Successfully linked {len(records)} questions.")

    @cli.command("build-passages")
    @click.option("--config", "-c", default="configs/pipeline.yaml", help="Path to pipeline YAML config.")
    @click.option("--input", help="Override input extracted_pages.jsonl path.")
    @click.option("--output", help="Override output passages.jsonl path.")
    def cmd_build_passages(config: str, input: str | None, output: str | None) -> None:
        """Chunk extracted text into bounded, sentence-aware passages."""
        cfg = load_yaml_config(config)
        inp_path = input or cfg.get("build_passages", {}).get("input_path", "artifacts/extracted_pages.jsonl")
        click.echo(f"Running build_passages on {inp_path}...")
        passages = build_passages(inp_path, config=cfg, output_path=output)
        click.echo(f"Successfully built {len(passages)} passages.")

    @cli.command("build-content-pack")
    @click.option("--config", "-c", default="configs/pipeline.yaml", help="Path to pipeline YAML config.")
    @click.option("--questions", help="Override linked_questions.jsonl path.")
    @click.option("--passages", help="Override passages.jsonl path.")
    @click.option("--output", help="Override output content_pack.db path.")
    def cmd_build_content_pack(
        config: str,
        questions: str | None,
        passages: str | None,
        output: str | None,
    ) -> None:
        """Build SQLite content pack with FTS5 lexical search."""
        cfg = load_yaml_config(config)
        cp_cfg = cfg.get("content_pack", {})
        q_path = questions or cp_cfg.get("input_questions_path", "artifacts/linked_questions.jsonl")
        p_path = passages or cp_cfg.get("input_passages_path", "artifacts/passages.jsonl")
        out_path = output or cp_cfg.get("output_path", "artifacts/content_pack.db")
        version = cp_cfg.get("version", "2026.10.1")

        click.echo(f"Building content pack {out_path} from {q_path} and {p_path}...")
        db_file = build_content_pack(
            linked_questions_path=q_path,
            passages_path=p_path,
            output_db_path=out_path,
            version=version,
            config=cfg,
        )
        click.echo(f"Successfully built content pack: {db_file}")

    @cli.command("validate")
    @click.option("--artifact", required=True, help="Path to JSONL artifact to validate.")
    @click.option("--schema", required=True, help="Path to JSON Schema file.")
    def cmd_validate(artifact: str, schema: str) -> None:
        """Validate an artifact against a JSON Schema."""
        report = validate_jsonl_against_schema(artifact, schema)
        if report.is_valid:
            click.echo(f"Validation passed: {report.valid_count} valid records.")
        else:
            click.echo(f"Validation FAILED: {report.invalid_count} invalid records, {len(report.errors)} errors:")
            for err in report.errors[:20]:
                click.echo(f"  - {err}")
            sys.exit(1)

    @cli.command("run-all")
    @click.option("--config", "-c", default="configs/pipeline.yaml", help="Path to pipeline YAML config.")
    def cmd_run_all(config: str) -> None:
        """Run stages 1-3 and build content pack in sequence."""
        cfg = load_yaml_config(config)
        pdf_path = cfg.get("source", {}).get("pdf_path", "data/raw/reviewer.pdf")
        pages_out = cfg.get("extract_textbook", {}).get("output_path", "artifacts/extracted_pages.jsonl")
        questions_out = cfg.get("link_qa_pairs", {}).get("output_path", "artifacts/linked_questions.jsonl")
        passages_out = cfg.get("build_passages", {}).get("output_path", "artifacts/passages.jsonl")
        cp_out = cfg.get("content_pack", {}).get("output_path", "artifacts/content_pack.db")
        version = cfg.get("content_pack", {}).get("version", "2026.10.1")

        click.echo("=== Step 1/4: Extracting Textbook ===")
        extract_textbook(pdf_path, config=cfg, output_path=pages_out)

        click.echo("=== Step 2/4: Linking QA Pairs ===")
        link_qa_pairs(pages_out, config=cfg, output_path=questions_out)

        click.echo("=== Step 3/4: Building Passages ===")
        build_passages(pages_out, config=cfg, output_path=passages_out)

        click.echo("=== Step 4/4: Building Content Pack ===")
        build_content_pack(
            linked_questions_path=questions_out,
            passages_path=passages_out,
            output_db_path=cp_out,
            version=version,
            config=cfg,
        )
        click.echo("Pipeline completed successfully!")


def main() -> None:
    if click is not None:
        cli()
    else:
        print("click is required for CLI. Install via: pip install click")
        sys.exit(1)


if __name__ == "__main__":
    main()
