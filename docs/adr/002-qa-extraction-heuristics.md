# ADR 002: QA Extraction and Linking Heuristics

## Status
Accepted

## Context
Philippine Civil Service Exam reviewers contain over 1,000 questions across multiple domains:
- Verbal Ability (English and Filipino)
- Analytical Ability
- Numerical Ability
- General Information (1987 Philippine Constitution, R.A. 6713 Code of Conduct, Environmental Laws, Peace and Human Rights)

Reviewer PDFs typically group questions into chapters or practice sets, with answer keys either located at the end of each chapter (common format: "Answer Key: 1. A, 2. C" or "1 - A") or inline. Questions may be multiple choice (stems with choices A through D), identification (free text), or essay/enumeration.

We need a deterministic, observable extraction and linking strategy that avoids hardcoding fragile layout assumptions and surfaces unlinked or anomalous items immediately.

## Decisions

1. **Two-Pass Heuristic Linker**:
   - **Pass 1 (Answer Key Extraction)**: Scans extracted pages for answer key sections (e.g., "Answer Key", "Susi sa Pagwawasto", "Mga Sagot"). Extracts item number to correct choice mapping per chapter.
   - **Pass 2 (Question and Choice Detection)**: Scans for numbered stems (`1.`, `1)`), lettered choices (`A.`, `B.`, `C.`, `D.`), and question categories.
   - **Merge & Classification**: Merges question stems with parsed keys. Assigns confidence:
     - `verified`: Multiple choice with matching answer key entry and valid choices.
     - `high`: Identification with unambiguous answer.
     - `low`: Inferred match.
     - `unresolved`: Question stem found with missing answer key entry.
2. **External Configuration via YAML**:
   - Regex patterns for question stems, choices, answer keys, and chapter headings are defined in `training/configs/pipeline.yaml`.
   - Tunable without changing core parsing code.
3. **Bilingual Support**:
   - Supports both English and Filipino headings and numbering conventions ("Mga Tanong", "Susi sa Pagwawasto").
4. **Validation and Audit Warnings**:
   - Emits explicit warnings when:
     - Multiple choice question does not have exactly 4 choices (or at least 2-4).
     - Question has no corresponding answer in the answer key.
     - Answer key contains question numbers not found in the question stems.
     - Duplicate question numbers exist within the same chapter.

## Consequences
- 100% auditable: any failure to parse or link is recorded in `link_warnings` and reflected in `link_confidence`.
- The user can run the pipeline against their specific PDF, observe extraction reports, and tune patterns in `pipeline.yaml` in minutes.
