#!/usr/bin/env python3
"""Validate any JSONL artifact against its corresponding JSON Schema.

Usage:
    python scripts/validate_contracts.py <jsonl_file> <schema_file>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import jsonschema
except ImportError:
    jsonschema = None


def validate_jsonl_file(jsonl_path: Path, schema_path: Path) -> tuple[int, list[str]]:
    """Validate each line of a JSONL file against a JSON Schema.

    Returns:
        (valid_count, errors)
    """
    if not jsonl_path.exists():
        return 0, [f"JSONL file not found: {jsonl_path}"]
    if not schema_path.exists():
        return 0, [f"Schema file not found: {schema_path}"]

    with schema_path.open("r", encoding="utf-8") as f:
        schema = json.load(f)

    if jsonschema is None:
        return 0, ["The 'jsonschema' package is required. Install it with: pip install jsonschema"]

    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)

    valid_count = 0
    errors: list[str] = []

    with jsonl_path.open("r", encoding="utf-8") as f:
        for line_no, raw_line in enumerate(f, start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError as e:
                errors.append(f"Line {line_no}: Invalid JSON syntax ({e})")
                continue

            validation_errors = list(validator.iter_errors(data))
            if validation_errors:
                for err in validation_errors:
                    path_str = " -> ".join(str(p) for p in err.absolute_path) or "root"
                    errors.append(f"Line {line_no} [{path_str}]: {err.message}")
            else:
                valid_count += 1

    return valid_count, errors


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: python scripts/validate_contracts.py <jsonl_file> <schema_file>")
        return 1

    jsonl_path = Path(sys.argv[1])
    schema_path = Path(sys.argv[2])

    print(f"Validating {jsonl_path} against {schema_path}...")
    valid_count, errors = validate_jsonl_file(jsonl_path, schema_path)

    if errors:
        print(f"\nValidation failed with {len(errors)} error(s):")
        for err in errors[:20]:
            print(f"  - {err}")
        if len(errors) > 20:
            print(f"  ... and {len(errors) - 20} more errors.")
        print(f"\nSummary: {valid_count} valid records, {len(errors)} error(s).")
        return 1

    print(f"Success: {valid_count} record(s) passed validation.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
