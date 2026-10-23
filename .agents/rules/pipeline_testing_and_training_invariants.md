---
name: pipeline-testing-and-training-invariants
description: Enforces multi-tier test execution hierarchy, authentic dataset verification, Windows OpenBLAS threading guardrails, and Jupyter notebook headless execution patterns.
trigger: model_decision
---

# Pipeline Testing & Training Invariants Protocol

Whenever developing, testing, or executing machine learning pipelines, data preparation scripts, or model training workflows in this repository:

## 1. Five-Tier Prioritized Test Execution Hierarchy
Never run tests as an undifferentiated monolith when diagnosing or verifying features. Always execute and report tests by priority tier:
- **Tier 1 (Unit Tests)**: Pure functions, regexes, JSON contract schemas (`contracts/*.schema.json`), mathematical scoring, prompt builders, and WCAG AAA/AA color contrast tokens. Run instantly with zero database or network dependencies.
- **Tier 2 (Integration Tests)**: SQLite database operations, FTS5 BM25 virtual table queries, state machine lifecycle transitions (`ready -> loading -> loaded -> generating -> releasing -> ready`), and atomic transaction rollback on failure.
- **Tier 3 (Authentic Reviewer & E2E Tests)**: Full ingestion of authentic reviewer materials (`training/data/raw/reviewer.pdf`, 200 real questions, 68 passages) asserting 100% schema compliance and foreign key integrity.
- **Tier 4 (Basis Path & Regression Tests)**: Linearly independent code branches (McCabe complexity), prompt injection defense (`<system>attack</system>`), and multi-page answer key continuations.
- **Tier 5 (Notebook Pipeline Execution Tests)**: Validates Jupyter Notebooks (`.ipynb`) against official `nbformat` JSON schema, verifies presence of all required stages, and executes all code cells headlessly on the local GPU.

## 2. Windows Python 3.13 OpenBLAS Threading Guardrail
On 64-bit Windows workstations running Python 3.13, scientific libraries and PyTorch can fail with:
`OpenBLAS error: Memory allocation still failed after 10 retries, giving up.`
- **Mandatory Invariant**: Always set environment variables at the top of every training script, notebook, or test before importing `torch` or `numpy`:
  ```python
  import os
  os.environ["OPENBLAS_NUM_THREADS"] = "1"
  os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
  ```

## 3. Causal LM Tokenizer Invariant: Exclude `token_type_ids`
When using a fallback or BERT-derived tokenizer with a causal language model (such as `Qwen2ForCausalLM` or `LlamaForCausalLM`), the tokenizer emits `token_type_ids`. Passing `token_type_ids` into `model.generate()` triggers `ValueError: The following model_kwargs are not used by the model: ['token_type_ids']`.
- **Mandatory Invariant**: Always filter `token_type_ids` before generation:
  ```python
  inputs = tokenizer(formatted_prompt, return_tensors="pt")
  inputs.pop("token_type_ids", None)
  ```

## 4. Live-First Annotation & Ingestion Invariant
Authoring scripts that only process synthetic sample fixtures leave production paths vulnerable to unexpected document layouts.
- **Mandatory Invariant**: Pipeline CLIs (such as `annotate_and_prepare_training.py`) must default to `--mode live`, loading and validating all authentic dataset items (`linked_questions.jsonl` and `passages.jsonl`) against JSON schemas and compiling the complete SQLite database, while preserving a `--mode demo` flag for authoring walkthroughs.

## 5. Disjoint Train/Val/Test Split Contracts
In question-answering and RAG pipelines, random splitting without assertions can accidentally allow identical questions or passages across train and test sets, inflating evaluation metrics.
- **Mandatory Invariant**: Always compute explicit set intersections over `question_id` and assert:
  ```python
  assert len(train_ids & val_ids) == 0, "Data leakage detected between Train and Val!"
  assert len(train_ids & test_ids) == 0, "Data leakage detected between Train and Test!"
  assert len(val_ids & test_ids) == 0, "Data leakage detected between Val and Test!"
  ```

## 6. Headless Jupyter Notebook Automated Testing
Jupyter Notebooks frequently bitrot due to hidden interactive state, missing dependencies, or unstated execution ordering.
- **Mandatory Invariant**: Every production Jupyter Notebook must be accompanied by an automated pytest suite that:
  1. Validates the `.ipynb` file using `nbformat.validate(nb)` against schema v4.
  2. Asserts that all required stages are present in Markdown headers.
  3. Compiles code cell strings to verify Python syntax.
  4. Executes cells sequentially in an isolated namespace dictionary to verify end-to-end execution without errors.
