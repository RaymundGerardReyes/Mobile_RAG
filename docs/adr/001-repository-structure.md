# ADR 001: Monorepo Structure and Pipeline Boundaries

## Status
Accepted

## Context
The Offline AI Tutor project targets the Philippine Civil Service Examination, running fully offline on an iPhone 16 using a local LLM (`Qwen3-1.7B Q4_K_M GGUF` via `llama.rn`) and an offline SQLite database with FTS5 lexical search. Data preparation and model fine-tuning (if needed) take place on a Windows 11 host with an NVIDIA RTX 4050 GPU.

We need a clear architectural boundary between:
1. Data preparation and offline model artifacts (`training/`).
2. Native mobile application development (`mobile/`).
3. Shared, language-neutral data contracts (`contracts/`).

## Decisions

1. **Monorepo with Dedicated Environments**:
   - `training/` contains the Python pipeline with its own `pyproject.toml` and virtual environment.
   - `mobile/` contains the React Native/Expo app with its own `package.json` and dependencies.
   - Root does not share a single runtime across Python and Node.js.
2. **Intermediate Format as JSONL**:
   - Stages communicate via JSON Lines (`.jsonl`), allowing line-by-line streaming, low memory consumption during processing, and clear diffs/validation.
3. **Language-Neutral JSON Schema Contracts**:
   - All stage outputs (`extracted-page`, `linked-question`, `passage`, `stage-manifest`, `model-manifest`) are governed by JSON Schemas in `contracts/`.
   - Both Python preparation scripts and potential verification tooling validate against the exact same schemas.
4. **PyMuPDF for PDF Extraction**:
   - `pymupdf` (fitz) provides high-speed, 1:1 page-accurate text extraction without requiring external OCR tools, keeping extraction reproducible and fast on Windows.
5. **No Copyrighted/Generated Content in Git**:
   - `training/data/`, `training/artifacts/`, and `training/models/` are strictly gitignored. Tests use synthetic fixtures generated during testing.

## Consequences
- Fast feedback loops: pipeline stages can be tested and modified independently.
- Clean isolation: changes to Python pipeline do not impact mobile builds and vice-versa.
- Provable provenance: every stage emits a manifest with SHA-256 hashes of inputs and outputs.
