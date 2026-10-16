"""Stage 4: Precompute passage vector embeddings (Optional).

Not implemented for MVP. Offline vector search on iPhone 16 requires a native
query embedding model. Lexical FTS5 search provides sub-millisecond retrieval
with zero additional RAM overhead.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any


def build_embeddings(
    passages: list[dict[str, Any]] | Path | str,
    config: dict[str, Any] | None = None,
) -> None:
    """OPTIONAL: Build vector embeddings for passages."""
    raise NotImplementedError(
        "Embedding stage disabled for MVP. Enable in pipeline.yaml when "
        "on-device query embedding runtime is available."
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Build embeddings for passages (Stub).")
    parser.add_argument("--input", help="Path to passages.jsonl")
    args = parser.parse_args()
    print("Stage 4 (build_embeddings) is optional and disabled for MVP.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
