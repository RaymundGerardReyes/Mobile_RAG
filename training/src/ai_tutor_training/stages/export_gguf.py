"""Stage 6: Export and quantize fine-tuned checkpoint to GGUF format (Optional).

Not needed for baseline as the official Qwen3-1.7B-GGUF Q4_K_M is utilized.
Only invoked if stage 5 produces a custom PyTorch adapter/checkpoint.
"""

from __future__ import annotations

import argparse
import sys
from typing import Any


def export_gguf(config: dict[str, Any] | None = None) -> None:
    """OPTIONAL: Export checkpoint to GGUF format."""
    raise NotImplementedError(
        "Export stage disabled for MVP. Base pre-quantized Qwen3-1.7B Q4_K_M is used."
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Export GGUF model stage (Stub).")
    parser.add_argument("--config", help="Path to export config")
    args = parser.parse_args()
    print("Stage 6 (export_gguf) is optional and disabled for MVP.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
