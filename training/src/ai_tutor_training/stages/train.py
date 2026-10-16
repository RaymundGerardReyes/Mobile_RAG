"""Stage 5: Fine-tune model with LoRA/QLoRA on RTX 4050 (Optional).

Not implemented for MVP. Pre-trained Qwen3-1.7B-GGUF Q4_K_M baseline is used
unless held-out evaluation indicates clear performance gaps that retrieval and
prompting cannot resolve.
"""

from __future__ import annotations

import argparse
import sys
from typing import Any


def train(config: dict[str, Any] | None = None) -> None:
    """OPTIONAL: Train/fine-tune model with LoRA."""
    raise NotImplementedError(
        "Training stage disabled for MVP. Enable in pipeline.yaml after "
        "baseline evaluation justifies fine-tuning."
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="LoRA fine-tuning stage (Stub).")
    parser.add_argument("--config", help="Path to training config")
    args = parser.parse_args()
    print("Stage 5 (train) is optional and disabled for MVP.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
