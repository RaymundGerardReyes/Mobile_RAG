"""AI Tutor training and data preparation package."""

from ai_tutor_training.annotation import DatasetAnnotator
from ai_tutor_training.iterative_justifier import (
    IterativeRAGJustifier,
    JustificationResult,
    RetrievedEvidence,
    extract_search_keywords,
)

__version__ = "0.4.0"

__all__ = [
    "DatasetAnnotator",
    "IterativeRAGJustifier",
    "JustificationResult",
    "RetrievedEvidence",
    "extract_search_keywords",
    "__version__",
]
