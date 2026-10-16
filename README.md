# Offline AI Tutor — Philippine Civil Service Exam Reviewer

An offline AI tutor designed for the Philippine Civil Service Examination (Professional & Sub-Professional levels). The system couples a deterministic, auditable SQLite core (0% hallucination for scoring) with an on-device local LLM (Qwen3-1.7B Q4_K_M GGUF via `llama.rn`) running entirely offline on an iPhone 16.

## Architecture Highlights

1. **Deterministic Core Invariant**: SQLite and application logic grade multiple-choice questions in `< 1 ms` with zero AI inference. The local LLM never scores the exam or sets the answer key.
2. **Feature A (`ExplainMore`)**: Local RAG retrieves verified textbook excerpts (via direct passage links or offline SQLite FTS5 BM25 search) and generates grounded, pedagogical explanations citing exact page numbers.
3. **Feature B (`InterpretFreeAnswer`)**: Semantic interpretation of free-form identification and short-answer questions against official rubrics, validated with strict JSON schema guardrails and confidence thresholds.
4. **Offline & Resource-Bounded**: Fully functional in Airplane Mode. Single active LLM context bounded to 2,048 tokens ensuring `< 1.8 GB` RAM footprint on device.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/adr/](docs/adr/) for comprehensive specifications.

---

## Repository Structure

```text
ai-tutor-app/
├── contracts/                     # Language-neutral JSON Schemas
│   ├── extracted-page.schema.json
│   ├── linked-question.schema.json
│   ├── passage.schema.json
│   ├── model-manifest.schema.json
│   └── stage-manifest.schema.json
├── docs/                          # Architecture decision records & runbooks
│   └── adr/
├── scripts/                       # Verification and utility scripts
│   ├── validate_contracts.py
│   └── verify_artifacts.py
├── training/                      # Python data preparation pipeline (Windows / RTX 4050)
│   ├── configs/pipeline.yaml
│   ├── data/raw/                  # Place source reviewer PDF here (gitignored)
│   ├── artifacts/                 # Stage JSONL & SQLite outputs (gitignored)
│   ├── src/ai_tutor_training/     # Pipeline implementation
│   └── tests/                     # Pytest suite with synthetic fixtures
└── mobile/                        # React Native / Expo iOS app skeleton
```

---

## Quickstart: Python Data Pipeline (Windows)

### 1. Environment Setup

```powershell
cd training
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
```

### 2. Run Pipeline Stages

Place your Civil Service Reviewer PDF at `training/data/raw/reviewer.pdf`.

```powershell
# Stage 1: Extract textbook text and pages with pymupdf
ai-tutor-pipeline extract --config configs/pipeline.yaml

# Stage 2: Link question stems, choices A-D, and answer keys
ai-tutor-pipeline link --config configs/pipeline.yaml

# Stage 3: Build bounded, sentence-aware passages
ai-tutor-pipeline build-passages --config configs/pipeline.yaml

# Content Pack: Build the offline SQLite database with FTS5 search
ai-tutor-pipeline build-content-pack --config configs/pipeline.yaml

# Or run all 3 stages and build content pack in one go:
ai-tutor-pipeline run-all --config configs/pipeline.yaml
```

### 3. Validate Contracts and Artifacts

```powershell
# Validate JSONL against JSON Schemas
python scripts/validate_contracts.py training/artifacts/extracted_pages.jsonl contracts/extracted-page.schema.json
python scripts/validate_contracts.py training/artifacts/linked_questions.jsonl contracts/linked-question.schema.json
python scripts/validate_contracts.py training/artifacts/passages.jsonl contracts/passage.schema.json

# Verify artifact integrity against manifests
python scripts/verify_artifacts.py training/artifacts/
```

### 4. Run Tests

```powershell
cd training
pytest -v
```
