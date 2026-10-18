"""Unit and integration tests for English reviewer parsing, 5-choice items, and inline explanations."""

from pathlib import Path
import pytest

from ai_tutor_training.stages.link_qa_pairs import (
    link_qa_pairs,
    parse_questions_from_pages,
)
from training.scripts.prepare_reviewer_sft import build_reviewer_chatml_dataset


@pytest.fixture
def sample_inline_explanation_pages():
    return [
        {
            "page_number": 1,
            "chapter": "Context Clues - Synonyms",
            "section": "Context Clues - Synonyms",
            "text": """
3. Context Clues
Introductory text defining context clues.

Context Clues - Synonyms
Directions: Choose the letter corresponding to the word.

1. The Vice-President's act was absolutely treacherous for the Filipinos.
a. betrayal
b. hazardous
c. harmless
d. commendable
e. secured
Explanation: Choice (a) "betrayal" is correct because "treacherous" means guilty of deception. Choice (b) is incorrect.

2. Relevant issues on death penalty were discussed.
a. Pertinent
b. Unique
c. Unrelated
d. Inapplicable
e. Abhor
Explanation: Choice (a) "Pertinent" is correct because both denote direct relevance. Choice (b) is incorrect.
            """.strip()
        }
    ]


def test_parse_questions_from_pages_with_inline_explanations(sample_inline_explanation_pages):
    q_patterns = [r"^\s*(\d{1,4})[.)]\s+(.*)"]
    c_patterns = [r"^\s*([A-Ea-e])[.)]\s+(.*)"]
    header_patterns = [r"(?i)(?:explanation\s*:|answer\s+key)"]

    raw_q = parse_questions_from_pages(
        pages=sample_inline_explanation_pages,
        q_patterns=q_patterns,
        c_patterns=c_patterns,
        header_patterns=header_patterns,
    )

    # '3. Context Clues' heading must NOT be parsed as question 3
    assert len(raw_q) == 2
    assert raw_q[0]["raw_num"] == 1
    assert raw_q[1]["raw_num"] == 2

    # Check choices (A through E = 5 choices)
    assert len(raw_q[0]["choices"]) == 5
    assert [c["key"] for c in raw_q[0]["choices"]] == ["A", "B", "C", "D", "E"]
    assert raw_q[0]["choices"][0]["text"] == "betrayal"
    assert raw_q[0]["choices"][4]["text"] == "secured"

    # Check inline explanation
    assert raw_q[0]["inline_canonical_choice_key"] == "A"
    assert len(raw_q[0]["explanation_lines"]) >= 1
    assert "betrayal" in raw_q[0]["explanation_lines"][0]


def test_link_qa_pairs_verifies_5_choice_inline_explanations(tmp_path, sample_inline_explanation_pages):
    cfg = {
        "link_qa_pairs": {
            "output_path": str(tmp_path / "linked.jsonl"),
            "manifest_path": str(tmp_path / "manifest.json"),
            "content_version": "2026.10.1",
            "question_patterns": [r"^\s*(\d{1,4})[.)]\s+(.*)"],
            "choice_patterns": [r"^\s*([A-Ea-e])[.)]\s+(.*)"],
            "answer_key_header_patterns": [r"(?i)(?:explanation\s*:|answer\s+key)"],
        }
    }

    linked = link_qa_pairs(
        extracted_pages=sample_inline_explanation_pages,
        config=cfg,
        output_path=tmp_path / "linked.jsonl",
        manifest_path=tmp_path / "manifest.json",
    )

    assert len(linked) == 2
    for q in linked:
        assert q["link_confidence"] == "verified"
        assert len(q["choices"]) == 5
        assert q["canonical_choice_key"] == "A"
        assert q["canonical_answer"] in ("betrayal", "Pertinent")
        assert q["canonical_explanation"] is not None
        assert len(q["link_warnings"]) == 0


def test_reviewer_chatml_generation(tmp_path, sample_inline_explanation_pages):
    linked_file = tmp_path / "linked.jsonl"
    passages_file = tmp_path / "passages.jsonl"
    sft_file = tmp_path / "sft.jsonl"

    cfg = {
        "link_qa_pairs": {
            "output_path": str(linked_file),
            "manifest_path": str(tmp_path / "link_manifest.json"),
            "choice_patterns": [r"^\s*([A-Ea-e])[.)]\s+(.*)"],
        }
    }
    link_qa_pairs(sample_inline_explanation_pages, config=cfg, output_path=linked_file)

    # Create dummy passage
    import json
    with open(passages_file, "w", encoding="utf-8") as f:
        f.write(json.dumps({
            "passage_id": "p0001",
            "chapter": "Context Clues - Synonyms",
            "section": "Context Clues - Synonyms",
            "start_page": 1,
            "end_page": 1,
            "text": "Context clues provide hints to determine the meaning of unusual words.",
            "content_hash": "dummyhash",
            "word_count": 10,
        }) + "\n")

    records = build_reviewer_chatml_dataset(linked_file, passages_file, sft_file)
    assert len(records) == 2
    for r in records:
        assert r["task_type"] == "explain_more"
        assert len(r["messages"]) == 3
        assert r["messages"][0]["role"] == "system"
        assert r["messages"][1]["role"] == "user"
        assert r["messages"][2]["role"] == "assistant"
        assert "(Source: Context Clues - Synonyms, [Page 1])" in r["messages"][2]["content"]

