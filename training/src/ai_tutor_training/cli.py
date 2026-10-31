"""CLI interface for the AI Tutor data preparation pipeline."""

from __future__ import annotations

import hashlib
import os
import shutil
import sys
import tempfile
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


def deploy_content_pack_to_mobile(
    artifacts_dir: Path | str = "training/artifacts",
    mobile_assets_dir: Path | str = "mobile/assets",
) -> dict[str, Any]:
    """Atomically copy content_pack.db and content_pack_manifest.json to mobile/assets/.

    Verifies SHA-256 parity after copying, and removes any legacy live_content_pack.json.
    """
    artifacts_path = Path(artifacts_dir)
    mobile_assets_path = Path(mobile_assets_dir)

    src_db = artifacts_path / "content_pack.db"
    src_manifest = artifacts_path / "content_pack_manifest.json"

    if not src_db.exists():
        raise FileNotFoundError(f"Source content pack DB not found at: {src_db}")
    if not src_manifest.exists():
        raise FileNotFoundError(f"Source content pack manifest not found at: {src_manifest}")

    mobile_assets_path.mkdir(parents=True, exist_ok=True)
    dest_db = mobile_assets_path / "content_pack.db"
    dest_manifest = mobile_assets_path / "content_pack_manifest.json"

    # Atomic copy for DB using a temporary file in the target directory
    with tempfile.NamedTemporaryFile("wb", dir=mobile_assets_path, delete=False) as tf:
        temp_db = Path(tf.name)
        with src_db.open("rb") as f_src:
            shutil.copyfileobj(f_src, tf)
    os.replace(temp_db, dest_db)

    # Atomic copy for manifest
    with tempfile.NamedTemporaryFile("wb", dir=mobile_assets_path, delete=False) as tf:
        temp_mf = Path(tf.name)
        with src_manifest.open("rb") as f_src:
            shutil.copyfileobj(f_src, tf)
    os.replace(temp_mf, dest_manifest)

    # Verify SHA-256 parity
    src_db_hash = hashlib.sha256(src_db.read_bytes()).hexdigest()
    dest_db_hash = hashlib.sha256(dest_db.read_bytes()).hexdigest()
    if src_db_hash != dest_db_hash:
        raise ValueError(f"SHA-256 parity check failed for DB: src={src_db_hash} != dest={dest_db_hash}")

    src_mf_hash = hashlib.sha256(src_manifest.read_bytes()).hexdigest()
    dest_mf_hash = hashlib.sha256(dest_manifest.read_bytes()).hexdigest()
    if src_mf_hash != dest_mf_hash:
        raise ValueError(f"SHA-256 parity check failed for manifest: src={src_mf_hash} != dest={dest_mf_hash}")

    # Remove legacy live_content_pack.json if present
    legacy_json = mobile_assets_path / "live_content_pack.json"
    removed_legacy = False
    if legacy_json.exists():
        legacy_json.unlink()
        removed_legacy = True

    return {
        "status": "deployed",
        "db_sha256": dest_db_hash,
        "manifest_sha256": dest_mf_hash,
        "db_size": dest_db.stat().st_size,
        "removed_legacy_json": removed_legacy,
    }


def load_yaml_config(config_path: Path | str) -> dict[str, Any]:
    """Load configuration from a YAML file."""
    p = Path(config_path)
    if not p.exists():
        if click is not None:
            raise click.ClickException(f"Configuration file not found: {p}")
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
    @click.option("--manifest", help="Override output manifest JSON path.")
    def cmd_extract(config: str, pdf: str | None, output: str | None, manifest: str | None) -> None:
        """Extract raw pages from textbook PDF."""
        cfg = load_yaml_config(config)
        pdf_path = pdf or cfg.get("source", {}).get("pdf_path", "data/raw/reviewer.pdf")
        click.echo(f"Running extract_textbook on {pdf_path}...")
        pages = extract_textbook(pdf_path, config=cfg, output_path=output, manifest_path=manifest)
        click.echo(f"Successfully extracted {len(pages)} pages.")

    @cli.command("link")
    @click.option("--config", "-c", default="configs/pipeline.yaml", help="Path to pipeline YAML config.")
    @click.option("--input", help="Override input extracted_pages.jsonl path.")
    @click.option("--output", help="Override output linked_questions.jsonl path.")
    @click.option("--manifest", help="Override output manifest JSON path.")
    def cmd_link(config: str, input: str | None, output: str | None, manifest: str | None) -> None:
        """Link question stems, choices, and answer keys."""
        cfg = load_yaml_config(config)
        inp_path = input or cfg.get("link_qa_pairs", {}).get("input_path", "artifacts/extracted_pages.jsonl")
        click.echo(f"Running link_qa_pairs on {inp_path}...")
        records = link_qa_pairs(inp_path, config=cfg, output_path=output, manifest_path=manifest)
        click.echo(f"Successfully linked {len(records)} questions.")

    @cli.command("build-passages")
    @click.option("--config", "-c", default="configs/pipeline.yaml", help="Path to pipeline YAML config.")
    @click.option("--input", help="Override input extracted_pages.jsonl path.")
    @click.option("--output", help="Override output passages.jsonl path.")
    @click.option("--manifest", help="Override output manifest JSON path.")
    def cmd_build_passages(config: str, input: str | None, output: str | None, manifest: str | None) -> None:
        """Chunk extracted text into bounded, sentence-aware passages."""
        cfg = load_yaml_config(config)
        inp_path = input or cfg.get("build_passages", {}).get("input_path", "artifacts/extracted_pages.jsonl")
        click.echo(f"Running build_passages on {inp_path}...")
        passages = build_passages(inp_path, config=cfg, output_path=output, manifest_path=manifest)
        click.echo(f"Successfully built {len(passages)} passages.")

    @cli.command("build-content-pack")
    @click.option("--config", "-c", default="configs/pipeline.yaml", help="Path to pipeline YAML config.")
    @click.option("--questions", help="Override linked_questions.jsonl path.")
    @click.option("--passages", help="Override passages.jsonl path.")
    @click.option("--output", help="Override output content_pack.db path.")
    @click.option("--version", "version", help="Override content pack semantic version.")
    @click.option("--manifest", help="Override output manifest JSON path.")
    @click.option("--deploy-mobile", is_flag=True, help="Automatically deploy built content pack to mobile/assets.")
    def cmd_build_content_pack(
        config: str,
        questions: str | None,
        passages: str | None,
        output: str | None,
        version: str | None,
        manifest: str | None,
        deploy_mobile: bool = False,
    ) -> None:
        """Build SQLite content pack with FTS5 lexical search."""
        cfg = load_yaml_config(config)
        cp_cfg = cfg.get("content_pack", {})
        q_path = questions or cp_cfg.get("input_questions_path", "artifacts/linked_questions.jsonl")
        p_path = passages or cp_cfg.get("input_passages_path", "artifacts/passages.jsonl")
        out_path = output or cp_cfg.get("output_path", "artifacts/content_pack.db")
        ver = version or cp_cfg.get("version", "2026.10.1")

        click.echo(f"Building content pack {out_path} from {q_path} and {p_path}...")
        db_file = build_content_pack(
            linked_questions_path=q_path,
            passages_path=p_path,
            output_db_path=out_path,
            version=ver,
            config=cfg,
            manifest_path=manifest,
        )
        click.echo(f"Successfully built content pack: {db_file}")
        if deploy_mobile:
            click.echo("Deploying content pack to mobile assets...")
            deploy_res = deploy_content_pack_to_mobile(
                artifacts_dir=Path(out_path).parent,
            )
            click.echo(f"Deployed to mobile. SHA-256: {deploy_res['db_sha256']}")
            if deploy_res["removed_legacy_json"]:
                click.echo("Cleaned up legacy mobile/assets/live_content_pack.json.")

    @cli.command("deploy-mobile")
    @click.option("--artifacts-dir", default="training/artifacts", help="Path to training artifacts directory.")
    @click.option("--mobile-assets-dir", default="mobile/assets", help="Path to mobile assets directory.")
    def cmd_deploy_mobile(artifacts_dir: str, mobile_assets_dir: str) -> None:
        """Deploy compiled content_pack.db and manifest to mobile assets with SHA-256 parity check."""
        result = deploy_content_pack_to_mobile(artifacts_dir=artifacts_dir, mobile_assets_dir=mobile_assets_dir)
        click.echo(
            f"Successfully deployed content pack to mobile ({result['db_size']} bytes). "
            f"SHA-256: {result['db_sha256']}"
        )
        if result["removed_legacy_json"]:
            click.echo("Cleaned up legacy mobile/assets/live_content_pack.json.")

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
    @click.option("--deploy-mobile", is_flag=True, help="Automatically deploy built content pack to mobile/assets.")
    def cmd_run_all(config: str, deploy_mobile: bool = False) -> None:
        """Run stages 1-3 and build content pack in sequence."""
        cfg = load_yaml_config(config)
        pdf_path = cfg.get("source", {}).get("pdf_path", "data/raw/reviewer.pdf")
        pages_out = cfg.get("extract_textbook", {}).get("output_path", "artifacts/extracted_pages.jsonl")
        questions_out = cfg.get("link_qa_pairs", {}).get("output_path", "artifacts/linked_questions.jsonl")
        passages_out = cfg.get("build_passages", {}).get("output_path", "artifacts/passages.jsonl")
        cp_out = cfg.get("content_pack", {}).get("output_path", "artifacts/content_pack.db")
        version = cfg.get("content_pack", {}).get("version", "2026.10.1")

        extract_manifest = cfg.get("extract_textbook", {}).get("manifest_path")
        link_manifest = cfg.get("link_qa_pairs", {}).get("manifest_path")
        passages_manifest = cfg.get("build_passages", {}).get("manifest_path")
        cp_manifest = cfg.get("content_pack", {}).get("manifest_path")

        click.echo("=== Step 1/4: Extracting Textbook ===")
        extract_textbook(pdf_path, config=cfg, output_path=pages_out, manifest_path=extract_manifest)

        click.echo("=== Step 2/4: Linking QA Pairs ===")
        link_qa_pairs(pages_out, config=cfg, output_path=questions_out, manifest_path=link_manifest)

        click.echo("=== Step 3/4: Building Passages ===")
        build_passages(pages_out, config=cfg, output_path=passages_out, manifest_path=passages_manifest)

        click.echo("=== Step 4/4: Building Content Pack ===")
        build_content_pack(
            linked_questions_path=questions_out,
            passages_path=passages_out,
            output_db_path=cp_out,
            version=version,
            config=cfg,
            manifest_path=cp_manifest,
        )
        click.echo("Pipeline completed successfully!")
        if deploy_mobile:
            click.echo("Deploying content pack to mobile assets...")
            deploy_res = deploy_content_pack_to_mobile(
                artifacts_dir=Path(cp_out).parent,
            )
            click.echo(f"Deployed to mobile. SHA-256: {deploy_res['db_sha256']}")
            if deploy_res["removed_legacy_json"]:
                click.echo("Cleaned up legacy mobile/assets/live_content_pack.json.")

    @cli.command("justify")
    @click.option("--db", default="artifacts/content_pack.db", help="Path to content pack SQLite database.")
    @click.option("--question-id", "-q", required=True, help="Question ID to justify.")
    @click.option("--query", help="Optional student follow-up query or confusion.")
    @click.option("--distractor", "-d", help="Optional distractor choice key (e.g. B).")
    def cmd_justify(db: str, question_id: str, query: str | None, distractor: str | None) -> None:
        """Run 3-tier iterative RAG retrieval and format justification prompt."""
        from ai_tutor_training.iterative_justifier import IterativeRAGJustifier

        justifier = IterativeRAGJustifier(db_path=db)
        q_data, evidence, log = justifier.retrieve_evidence_iteratively(
            question_id=question_id,
            follow_up_query=query,
            distractor_choice_key=distractor,
        )
        click.echo(f"=== Question: {q_data['stem']} ===")
        click.echo(f"Canonical Answer: {q_data['canonical_answer']}")
        click.echo("\n--- Retrieval Trace ---")
        for step in log:
            click.echo(f"  * {step}")
        click.echo(f"\nRetrieved {len(evidence)} evidence passages:")
        for i, ev in enumerate(evidence, 1):
            click.echo(f"  [{i}] {ev.passage_id} (Page {ev.start_page}, {ev.retrieval_tier}): {ev.text[:100]}...")

    @cli.command("export-sft")
    @click.option("--db", default="artifacts/content_pack.db", help="Path to content pack database.")
    @click.option("--output", "-o", default="artifacts/reviewer_sft_chatml.jsonl", help="Path to output ChatML JSONL.")
    @click.option("--version", default="2026.10.1", help="Content pack version.")
    @click.option("--max-passage-words", default=140, type=int, help="Max words per passage for ChatML token budgeting.")
    def cmd_export_sft(db: str, output: str, version: str, max_passage_words: int) -> None:
        """Export Grounded RAG ChatML training records using 3-tier Iterative RAG retrieval."""
        from ai_tutor_training.annotation import build_iterative_sft_chatml_dataset

        click.echo(f"Exporting Grounded RAG SFT dataset from {db} to {output}...")
        out_path = build_iterative_sft_chatml_dataset(
            db_path=db,
            output_chatml_path=output,
            content_version=version,
            max_passage_words=max_passage_words,
        )
        click.echo(f"Successfully generated ChatML dataset at {out_path}.")

    @cli.command("train-lora")
    @click.option("--config", "-c", default="configs/pipeline.yaml", help="Path to pipeline YAML config.")
    @click.option("--dataset", help="Path to ChatML SFT dataset JSONL.")
    @click.option("--output-dir", help="Output directory for LoRA adapter weights.")
    @click.option("--dry-run", is_flag=True, help="Validate dataset & config without GPU execution.")
    def cmd_train_lora(
        config: str,
        dataset: str | None,
        output_dir: str | None,
        dry_run: bool,
    ) -> None:
        """Run Stage 5 QLoRA fine-tuning on the grounded ChatML SFT dataset."""
        from ai_tutor_training.stages.train import train

        cfg = load_yaml_config(config) if Path(config).exists() else {}
        summary = train(
            sft_dataset_path=dataset,
            output_adapter_dir=output_dir,
            config=cfg,
            dry_run=dry_run,
        )
        click.echo(
            f"Stage 5 LoRA training {summary['status']}: "
            f"{summary['train_samples']} samples ({summary['base_model_repo']})."
        )

    @cli.command("export-gguf")
    @click.option("--config", "-c", default="configs/pipeline.yaml", help="Path to pipeline YAML config.")
    @click.option("--adapter-dir", help="Path to trained LoRA adapter directory.")
    @click.option("--output", help="Output GGUF file path.")
    @click.option("--manifest", help="Output model-manifest.json path.")
    def cmd_export_gguf(
        config: str,
        adapter_dir: str | None,
        output: str | None,
        manifest: str | None,
    ) -> None:
        """Run Stage 6 GGUF quantization and emit a verified model-manifest.json."""
        from ai_tutor_training.stages.export_gguf import export_gguf

        cfg = load_yaml_config(config) if Path(config).exists() else {}
        model_manifest = export_gguf(
            adapter_dir=adapter_dir,
            output_gguf_path=output,
            model_manifest_path=manifest,
            config=cfg,
        )
        click.echo(
            f"Exported GGUF model ({model_manifest['quantization']}) "
            f"with SHA-256: {model_manifest['file_sha256']}"
        )

    @cli.command("eval-consensus")
    @click.option("--db", default="artifacts/content_pack.db", help="Path to content_pack.db.")
    @click.option("--question-id", "-q", required=True, help="Question ID (e.g., q0004).")
    @click.option("--answer", "-a", required=True, help="Student free-text response to evaluate.")
    @click.option("--samples", "-n", default=3, type=int, help="Number of probabilistic consensus samples.")
    @click.option("--temperature", default=0.65, type=float, help="Sampling temperature.")
    def cmd_eval_consensus(
        db: str,
        question_id: str,
        answer: str,
        samples: int,
        temperature: float,
    ) -> None:
        """Evaluate a free-text answer using Best-of-N probabilistic self-consistency voting."""
        from ai_tutor_training.probabilistic_engine import (
            ProbabilisticSamplingConfig,
            ProbabilisticTutorEngine,
        )

        sampling_cfg = ProbabilisticSamplingConfig(
            do_sample=temperature > 0.0,
            temperature=temperature,
            num_consensus_samples=samples,
        )
        engine = ProbabilisticTutorEngine(db_path=db, sampling_config=sampling_cfg)
        result = engine.evaluate_free_answer_with_consensus(
            question_id=question_id,
            user_answer=answer,
            num_samples=samples,
        )
        click.echo(f"=== Probabilistic Consensus Verdict ({result.num_samples} samples) ===")
        click.echo(f"Majority Verdict:    {result.final_result.verdict}")
        click.echo(f"Score Assigned:      {result.final_result.score}")
        click.echo(f"Average Confidence:  {result.average_confidence:.2f}")
        click.echo(f"Vote Distribution:   {json.dumps(result.verdict_distribution)}")


def main() -> None:
    if click is not None:
        cli()
    else:
        print("click is required for CLI. Install via: pip install click")
        sys.exit(1)


if __name__ == "__main__":
    main()
