"""Tests for the Jupyter Notebook Training Pipeline (training/notebooks/training_pipeline.ipynb).

Validates:
1. Notebook JSON structure and nbformat schema conformance.
2. Presence and logical ordering of all 10 required pipeline stages.
3. Code cell import integrity and compatibility with the existing codebase.
4. Headless execution verification.
"""

from __future__ import annotations

import json
from pathlib import Path
import pytest
import nbformat
from nbformat import ValidationError


NOTEBOOK_PATH = Path(__file__).resolve().parent.parent / "notebooks" / "training_pipeline.ipynb"


def test_notebook_file_exists_and_conforms_to_nbformat():
    """Assert notebook file exists and passes nbformat schema validation."""
    assert NOTEBOOK_PATH.exists(), f"Notebook file not found at {NOTEBOOK_PATH}"
    with open(NOTEBOOK_PATH, "r", encoding="utf-8") as f:
        nb = nbformat.read(f, as_version=4)

    # nbformat.validate raises ValidationError if invalid
    nbformat.validate(nb)
    assert nb.nbformat == 4
    assert len(nb.cells) >= 20


def test_all_10_pipeline_stages_present():
    """Verify all 10 required stages are documented in markdown cells."""
    with open(NOTEBOOK_PATH, "r", encoding="utf-8") as f:
        nb = nbformat.read(f, as_version=4)

    markdown_texts = [cell["source"] for cell in nb.cells if cell["cell_type"] == "markdown"]
    full_markdown = "\n\n".join(markdown_texts)

    required_stages = [
        "Stage 1: Environment and Configuration",
        "Stage 2: Data Loading",
        "Stage 3: Data Validation and Preprocessing",
        "Stage 4: Dataset Splitting",
        "Stage 5: Model Initialization",
        "Stage 6: Training",
        "Stage 7: Validation and Evaluation",
        "Stage 8: Model and Artifact Saving",
        "Stage 9: Inference Compatibility Test",
        "Stage 10: Final Report",
    ]

    for stage in required_stages:
        assert stage in full_markdown, f"Required stage missing from notebook markdown: '{stage}'"


def test_code_cells_syntax_and_import_contracts():
    """Verify Python code cells compile without SyntaxError and reference legacy modules."""
    with open(NOTEBOOK_PATH, "r", encoding="utf-8") as f:
        nb = nbformat.read(f, as_version=4)

    code_cells = [cell["source"] for cell in nb.cells if cell["cell_type"] == "code"]
    assert len(code_cells) >= 10, f"Expected at least 10 code cells, got {len(code_cells)}"

    full_code = "\n\n".join(code_cells)

    # Compile the combined code to verify valid Python syntax
    compiled = compile(full_code, str(NOTEBOOK_PATH), "exec")
    assert compiled is not None

    # Check that legacy modules and functions are explicitly referenced
    assert "DatasetAnnotator" in full_code
    assert "IterativeRAGJustifier" in full_code
    assert "OPENBLAS_NUM_THREADS" in full_code
    assert "content_pack.db" in full_code
    assert "reviewer_sft_chatml.jsonl" in full_code
    assert "LoraConfig" in full_code
    assert "SFTTrainer" in full_code


@pytest.mark.integration
def test_headless_notebook_execution():
    """Execute notebook cells sequentially in an isolated namespace to verify end-to-end execution."""
    with open(NOTEBOOK_PATH, "r", encoding="utf-8") as f:
        nb = nbformat.read(f, as_version=4)

    execution_namespace = {}
    code_cells = [cell["source"] for cell in nb.cells if cell["cell_type"] == "code"]

    for i, code in enumerate(code_cells, 1):
        try:
            exec(code, execution_namespace)
        except Exception as err:
            pytest.fail(f"Execution failed in notebook code cell {i}:\n\nCode:\n{code}\n\nError: {err}")

    # Verify expected outputs in namespace
    assert "annotator" in execution_namespace
    assert len(execution_namespace["annotator"].questions) == 200
    assert len(execution_namespace["annotator"].passages) == 68
    assert "train_records" in execution_namespace
    assert len(execution_namespace["train_records"]) == 160
    assert "val_records" in execution_namespace
    assert len(execution_namespace["val_records"]) == 20
    assert "test_records" in execution_namespace
    assert len(execution_namespace["test_records"]) == 20
    assert "trainer" in execution_namespace
    assert "reloaded_model" in execution_namespace

