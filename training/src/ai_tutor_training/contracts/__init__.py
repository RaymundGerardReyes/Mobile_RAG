"""Contract validation utilities for JSON Schema enforcement."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import jsonschema
except ImportError:
    jsonschema = None


@dataclass
class ValidationReport:
    """Report detailing validation status and any contract errors."""

    is_valid: bool
    valid_count: int
    invalid_count: int
    errors: list[str] = field(default_factory=list)


def load_schema(schema_path: Path | str) -> dict[str, Any]:
    """Load and parse a JSON Schema file."""
    path = Path(schema_path)
    if not path.exists():
        raise FileNotFoundError(f"Schema not found: {path}")
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def validate_record_against_schema(
    record: dict[str, Any], schema: dict[str, Any]
) -> list[str]:
    """Validate a single dictionary record against a JSON Schema.

    Returns a list of error messages (empty if valid).
    """
    if jsonschema is None:
        raise RuntimeError("jsonschema package is required for validation")

    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)

    errors: list[str] = []
    for err in validator.iter_errors(record):
        path_str = " -> ".join(str(p) for p in err.absolute_path) or "root"
        errors.append(f"[{path_str}]: {err.message}")
    return errors


def validate_jsonl_against_schema(
    jsonl_path: Path | str, schema_path: Path | str
) -> ValidationReport:
    """Validate every line of a JSONL file against a JSON Schema file."""
    j_path = Path(jsonl_path)
    s_path = Path(schema_path)

    if not j_path.exists():
        return ValidationReport(
            is_valid=False,
            valid_count=0,
            invalid_count=1,
            errors=[f"JSONL file not found: {j_path}"],
        )

    schema = load_schema(s_path)
    if jsonschema is None:
        return ValidationReport(
            is_valid=False,
            valid_count=0,
            invalid_count=1,
            errors=["jsonschema package is required for contract validation"],
        )

    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)

    valid_count = 0
    invalid_count = 0
    all_errors: list[str] = []

    with j_path.open("r", encoding="utf-8") as f:
        for line_no, raw_line in enumerate(f, start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError as e:
                invalid_count += 1
                all_errors.append(f"Line {line_no}: Invalid JSON syntax ({e})")
                continue

            errs = list(validator.iter_errors(data))
            if errs:
                invalid_count += 1
                for err in errs:
                    path_str = " -> ".join(str(p) for p in err.absolute_path) or "root"
                    all_errors.append(f"Line {line_no} [{path_str}]: {err.message}")
            else:
                valid_count += 1

    return ValidationReport(
        is_valid=(invalid_count == 0),
        valid_count=valid_count,
        invalid_count=invalid_count,
        errors=all_errors,
    )
