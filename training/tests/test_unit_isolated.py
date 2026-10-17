"""Unit tests for isolated pipeline components: regexes, tokenizers, provenance, and classifiers.

Marked with @pytest.mark.unit.
"""

from __future__ import annotations

import datetime
from pathlib import Path

import pytest

from ai_tutor_training.provenance import (
    compute_dict_hash,
    compute_sha256,
    create_stage_manifest,
    save_stage_manifest,
)
from ai_tutor_training.stages.build_passages import count_words, split_into_sentences
from ai_tutor_training.stages.extract_textbook import extract_page_headings
from ai_tutor_training.stages.link_qa_pairs import classify_question_type


# ---------------------------------------------------------------------------
# 1. Heading Regex & Roman Numeral Unit Tests
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestHeadingRegexes:
    """Isolated verification of chapter, section, and Roman numeral regexes."""

    CHAPTER_PATTERNS = [
        r"^(?:CHAPTER|Chapter|KABANATA|Kabanata)\s+[\dIVXLCDM]+[.:]?\s*(.*)",
        r"^(?:PART|Part|BAHAGI|Bahagi)\s+[\dIVXLCDM]+[.:]?\s*(.*)",
        r"^(?:ENGLISH|MATH|FILIPINO|GENERAL\s+(?:INFORMATION|LAWS?)|CLERICAL\s+OPERATIONS)",
        r"^(?:NUMERICAL\s+ABILITY|VERBAL\s+ABILITY|ANALYTICAL\s+ABILITY)",
    ]

    SECTION_PATTERNS = [
        r"^(?:Section|Seksyon)\s+[\dIVXLCDM]+[.:]?\s*(.*)",
        r"^(?:Vocabulary|Grammar|Reading Comprehension|Analogy|Logic|Word Problems)",
        r"^(?:Balarila|Talasalitaan|Pagbasa|Saligang Batas|R\.A\.\s*6713)",
    ]

    @pytest.mark.parametrize(
        "heading_text,expected_chapter",
        [
            ("CHAPTER 1: The Philippine Constitution", "The Philippine Constitution"),
            ("Chapter 12. Public Accountability", "Public Accountability"),
            ("KABANATA 3: Kasaysayan ng Pilipinas", "Kasaysayan ng Pilipinas"),
            ("Kabanata IV - Mga Karapatan", "- Mga Karapatan"),
            ("PART I: General Information", "General Information"),
            ("Part 5. Clerical Operations", "Clerical Operations"),
            ("BAHAGI 2: Pagsusulit sa Balarila", "Pagsusulit sa Balarila"),
            ("Bahagi III - Talasalitaan", "- Talasalitaan"),
            ("GENERAL INFORMATION", "GENERAL INFORMATION"),
            ("NUMERICAL ABILITY", "NUMERICAL ABILITY"),
            ("VERBAL ABILITY", "VERBAL ABILITY"),
            ("CLERICAL OPERATIONS", "CLERICAL OPERATIONS"),
            ("ENGLISH", "ENGLISH"),
            ("MATH", "MATH"),
            ("FILIPINO", "FILIPINO"),
        ],
    )
    def test_chapter_heading_patterns(self, heading_text: str, expected_chapter: str) -> None:
        chapter, section, detected = extract_page_headings(
            heading_text, self.CHAPTER_PATTERNS, self.SECTION_PATTERNS
        )
        assert chapter is not None
        assert expected_chapter in chapter or chapter == expected_chapter
        assert any("Chapter:" in d for d in detected)

    @pytest.mark.parametrize(
        "roman_numeral",
        ["I", "IV", "V", "IX", "X", "XIV", "XIX", "XL", "L", "XC", "C", "CD", "D", "CM", "M"],
    )
    def test_roman_numerals_in_chapter_headings(self, roman_numeral: str) -> None:
        text = f"CHAPTER {roman_numeral}: Roman Numeral Test Topic"
        chapter, section, detected = extract_page_headings(
            text, self.CHAPTER_PATTERNS, self.SECTION_PATTERNS
        )
        assert chapter == "Roman Numeral Test Topic"

    @pytest.mark.parametrize(
        "section_text,expected_section",
        [
            ("Section 1: Bill of Rights", "Bill of Rights"),
            ("Seksyon 4: Katungkulan ng Kawani", "Katungkulan ng Kawani"),
            ("Vocabulary", "Vocabulary"),
            ("Grammar", "Grammar"),
            ("Reading Comprehension", "Reading Comprehension"),
            ("Analogy", "Analogy"),
            ("Logic", "Logic"),
            ("Word Problems", "Word Problems"),
            ("Balarila", "Balarila"),
            ("Talasalitaan", "Talasalitaan"),
            ("Pagbasa", "Pagbasa"),
            ("Saligang Batas", "Saligang Batas"),
            ("R.A. 6713", "R.A. 6713"),
        ],
    )
    def test_section_heading_patterns(self, section_text: str, expected_section: str) -> None:
        chapter, section, detected = extract_page_headings(
            section_text, self.CHAPTER_PATTERNS, self.SECTION_PATTERNS
        )
        assert section is not None
        assert expected_section in section or section == expected_section
        assert any("Section:" in d for d in detected)

    def test_extract_headings_empty_and_plain_text(self) -> None:
        assert extract_page_headings("", self.CHAPTER_PATTERNS, self.SECTION_PATTERNS) == (None, None, [])
        assert extract_page_headings("   \n\n  ", self.CHAPTER_PATTERNS, self.SECTION_PATTERNS) == (None, None, [])
        plain = "This is ordinary body text on the page without any headings whatsoever."
        assert extract_page_headings(plain, self.CHAPTER_PATTERNS, self.SECTION_PATTERNS) == (None, None, [])

    def test_extract_both_chapter_and_section(self) -> None:
        page_text = (
            "CHAPTER 1: The Executive Department\n"
            "Section 2: Powers of the President\n"
            "The executive power shall be vested in the President of the Philippines."
        )
        chapter, section, detected = extract_page_headings(
            page_text, self.CHAPTER_PATTERNS, self.SECTION_PATTERNS
        )
        assert chapter == "The Executive Department"
        assert section == "Powers of the President"
        assert len(detected) == 2


# ---------------------------------------------------------------------------
# 2. Sentence Boundary & Abbreviation Unit Tests
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestSentenceTokenizer:
    """Unit tests for sentence segmentation avoiding false splits on abbreviations."""

    def test_empty_and_whitespace(self) -> None:
        assert split_into_sentences("") == []
        assert split_into_sentences("   \t \n\n ") == []

    def test_single_sentence(self) -> None:
        sents = split_into_sentences("The 1987 Constitution is the supreme law.")
        assert len(sents) == 1
        assert sents[0] == "The 1987 Constitution is the supreme law."

    def test_standard_punctuation_splits(self) -> None:
        text = "First sentence here. Second sentence has an exclamation! Third is a question? Fourth is final."
        sents = split_into_sentences(text)
        assert len(sents) == 4
        assert sents[0] == "First sentence here."
        assert sents[1] == "Second sentence has an exclamation!"
        assert sents[2] == "Third is a question?"
        assert sents[3] == "Fourth is final."

    @pytest.mark.parametrize(
        "abbrev",
        [
            "No.", "Art.", "Sec.", "Mr.", "Ms.", "Mrs.", "Dr.", "Prof.",
            "Atty.", "vs.", "v.", "p.", "pp.", "RA.", "vol.", "par.",
            "para.", "ch.", "dept.", "gov.", "gen.", "col.", "lt.",
            "pres.", "sen.", "rep.", "univ.", "sr.", "jr.", "cf.",
            "al.", "Blg.", "Pah.", "R.A.",
        ],
    )
    def test_abbreviation_not_split(self, abbrev: str) -> None:
        text = f"Review the citation in {abbrev} 45 for official civil service guidelines."
        sents = split_into_sentences(text)
        assert len(sents) == 1, f"Abbreviation '{abbrev}' caused a false sentence split: {sents}"

    def test_philippine_legal_citations(self) -> None:
        text = (
            "Pursuant to R.A. No. 6713, Sec. 4, public officials must observe accountability. "
            "Under B.P. Blg. 881, election offenses are prosecuted by COMELEC. "
            "See Pah. 15 for complete details."
        )
        sents = split_into_sentences(text)
        assert len(sents) == 3
        assert "R.A. No. 6713, Sec. 4" in sents[0]
        assert "B.P. Blg. 881" in sents[1]
        assert "Pah. 15" in sents[2]

    def test_person_initials_not_split(self) -> None:
        text = "Dr. Jose P. Rizal wrote Noli Me Tangere. He was executed in Bagumbayan."
        sents = split_into_sentences(text)
        assert len(sents) == 2
        assert sents[0] == "Dr. Jose P. Rizal wrote Noli Me Tangere."
        assert sents[1] == "He was executed in Bagumbayan."

    def test_quoted_sentences_handled(self) -> None:
        text = 'He stated, "Public office is a public trust." That remains an unyielding doctrine.'
        sents = split_into_sentences(text)
        assert len(sents) == 2
        assert sents[0] == 'He stated, "Public office is a public trust."'
        assert sents[1] == "That remains an unyielding doctrine."

    def test_parenthetical_sentence_endings(self) -> None:
        text = "The law took effect immediately (as approved in 1989). All provisions apply."
        sents = split_into_sentences(text)
        assert len(sents) == 2
        assert sents[0] == "The law took effect immediately (as approved in 1989)."
        assert sents[1] == "All provisions apply."

    def test_count_words(self) -> None:
        assert count_words("") == 0
        assert count_words("   ") == 0
        assert count_words("One two three four five.") == 5


# ---------------------------------------------------------------------------
# 3. Provenance & Hashing Unit Tests
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestProvenanceUtilities:
    """Isolated unit tests for provenance manifests, SHA-256, and dict hashing."""

    def test_compute_sha256(self, tmp_path: Path) -> None:
        sample_file = tmp_path / "hello.txt"
        sample_file.write_text("civil service examination 2026", encoding="utf-8")
        h1 = compute_sha256(sample_file)
        assert len(h1) == 64
        assert h1 == compute_sha256(str(sample_file))

        # Modifying file changes hash
        sample_file.write_text("civil service examination 2027", encoding="utf-8")
        h2 = compute_sha256(sample_file)
        assert h1 != h2

    def test_compute_sha256_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            compute_sha256(tmp_path / "non_existent.txt")

    def test_compute_dict_hash_key_order_invariant(self) -> None:
        d1 = {"alpha": 1, "beta": "two", "gamma": [1, 2, 3]}
        d2 = {"gamma": [1, 2, 3], "beta": "two", "alpha": 1}
        assert compute_dict_hash(d1) == compute_dict_hash(d2)

    def test_create_stage_manifest_structure(self, tmp_path: Path) -> None:
        in_f = tmp_path / "in.txt"
        out_f = tmp_path / "out.txt"
        in_f.write_text("input data", encoding="utf-8")
        out_f.write_text("output data", encoding="utf-8")

        start = datetime.datetime.now(datetime.timezone.utc)
        end = start + datetime.timedelta(milliseconds=250)

        manifest = create_stage_manifest(
            stage="test_stage",
            started_at=start,
            ended_at=end,
            status="success",
            input_files={"input": in_f},
            output_files={"output": out_f},
            config={"max_words": 300},
            record_count=10,
            warnings=["test warning"],
        )

        assert manifest["stage"] == "test_stage"
        assert manifest["status"] == "success"
        assert manifest["duration_ms"] == 250
        assert manifest["record_count"] == 10
        assert "in.txt" in manifest["input_hashes"]
        assert "out.txt" in manifest["output_hashes"]
        assert manifest["config_hash"] is not None
        assert manifest["warnings"] == ["test warning"]

    def test_save_stage_manifest_atomic(self, tmp_path: Path) -> None:
        out_manifest = tmp_path / "manifest.json"
        data = {"stage": "stage_x", "status": "success"}
        save_stage_manifest(data, out_manifest)
        assert out_manifest.exists()

        # Overwrite atomically
        data2 = {"stage": "stage_x", "status": "updated"}
        save_stage_manifest(data2, out_manifest)
        assert out_manifest.exists()
        import json
        with out_manifest.open("r", encoding="utf-8") as f:
            loaded = json.load(f)
        assert loaded["status"] == "updated"


# ---------------------------------------------------------------------------
# 4. Question Classifier Unit Tests
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestQuestionClassifier:
    """Isolated tests for question type classification."""

    def test_multiple_choice_when_choices_present(self) -> None:
        choices = [{"key": "A", "text": "First choice"}, {"key": "B", "text": "Second choice"}]
        assert classify_question_type("Any stem question here?", choices) == "multiple_choice"

    @pytest.mark.parametrize(
        "stem",
        [
            "Explain the three branches of the Philippine Government.",
            "Ipaliwanag ang mga tungkulin ng Pangulo ng Pilipinas.",
            "Discuss the significance of the Bill of Rights in the 1987 Constitution.",
            "Talakayin ang mga patakaran ng Civil Service Commission ukol sa meritocracy.",
            "Enumerate the qualifications of a Senator under Article VI.",
            "Isa-isahin ang mga karapatan ng isang nasasakdal ayon sa Saligang Batas.",
            "Magbigay ng mga halimbawa ng paglabag sa R.A. 6713.",
            "In your own words, describe how a bill becomes a law.",
            "Sa iyong sariling salita, ipaliwanag ang ibig sabihin ng accountability.",
        ],
    )
    def test_essay_keywords_english_and_filipino(self, stem: str) -> None:
        assert classify_question_type(stem, None) == "essay"
        assert classify_question_type(stem, []) == "essay"

    @pytest.mark.parametrize(
        "stem",
        [
            "What is the Republic Act number of the Code of Conduct and Ethical Standards?",
            "Anong taon pinagtibay ang kasalukuyang Saligang Batas ng Pilipinas?",
            "The upper chamber of the Philippine Congress.",
            "Who is considered the Father of the Philippine Constitution of 1935?",
        ],
    )
    def test_identification_fallback(self, stem: str) -> None:
        assert classify_question_type(stem, None) == "identification"
        assert classify_question_type(stem, []) == "identification"
