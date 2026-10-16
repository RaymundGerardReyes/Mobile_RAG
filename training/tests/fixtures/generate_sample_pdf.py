"""Generate a synthetic Philippine Civil Service Exam Reviewer PDF for tests."""

from __future__ import annotations

import sys
from pathlib import Path


def generate_sample_pdf(output_path: Path | str) -> Path:
    """Generate a multi-page synthetic reviewer PDF using PyMuPDF."""
    out_p = Path(output_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)

    try:
        import fitz
    except ImportError:
        raise ImportError("PyMuPDF is required to generate synthetic test PDF.")

    doc = fitz.open()

    # Page 1: Chapter 1 - Questions 1-2
    p1 = doc.new_page()
    text_p1 = (
        "CHAPTER 1: GENERAL INFORMATION\n"
        "Section: Philippine Constitution\n\n"
        "The 1987 Constitution is the fundamental law of the Philippines.\n"
        "All public officials must defend and uphold the Constitution.\n\n"
        "1. Which branch of the Philippine government is vested with legislative power?\n"
        "A. Supreme Court\n"
        "B. Office of the President\n"
        "C. Congress of the Philippines\n"
        "D. Civil Service Commission\n\n"
        "2. How many senators comprise the Philippine Senate?\n"
        "A. 12\n"
        "B. 24\n"
        "C. 36\n"
        "D. 48\n"
    )
    p1.insert_text((50, 50), text_p1, fontsize=11)

    # Page 2: Chapter 1 - Questions 3-5
    p2 = doc.new_page()
    text_p2 = (
        "CHAPTER 1: GENERAL INFORMATION\n"
        "Section: Code of Conduct (R.A. 6713)\n\n"
        "Republic Act 6713 sets ethical standards for public officials.\n\n"
        "3. Public officials and employees shall always uphold public interest over personal interest.\n"
        "A. Commitment to public interest\n"
        "B. Professionalism\n"
        "C. Political neutrality\n"
        "D. Responsiveness to the public\n\n"
        "4. Identify the Republic Act known as the Code of Conduct for Public Officials.\n\n"
        "5. Explain the concept of accountability of public officers.\n"
    )
    p2.insert_text((50, 50), text_p2, fontsize=11)

    # Page 3: Chapter 1 - Answer Key
    p3 = doc.new_page()
    text_p3 = (
        "CHAPTER 1: GENERAL INFORMATION\n"
        "Answer Key\n"
        "1 - C\n"
        "2 - B\n"
        "3 - A\n"
        "4 - Republic Act 6713\n"
    )
    p3.insert_text((50, 50), text_p3, fontsize=11)

    # Page 4: Chapter 2 - Filipino Questions 6-7
    p4 = doc.new_page()
    text_p4 = (
        "CHAPTER 2: FILIPINO\n"
        "Section: Talasalitaan\n\n"
        "Subukin ang kaalaman sa talasalitaan at wastong gramatika.\n\n"
        "6. Piliin ang kasingkahulugan ng salitang marikit.\n"
        "A. Maganda\n"
        "B. Pangit\n"
        "C. Matayog\n"
        "D. Maliit\n\n"
        "7. Piliin ang kasalungat ng salitang masigasig.\n"
        "A. Masipag\n"
        "B. Tamad\n"
        "C. Masigla\n"
        "D. Mapagbigay\n"
    )
    p4.insert_text((50, 50), text_p4, fontsize=11)

    # Page 5: Chapter 2 - Filipino Question 8 + Susi sa Pagwawasto
    p5 = doc.new_page()
    text_p5 = (
        "CHAPTER 2: FILIPINO\n"
        "Section: Balarila\n\n"
        "8. Piliin ang tamang salita: Lumakad siya (ng/nang) mabilis.\n"
        "A. ng\n"
        "B. nang\n"
        "C. habang\n"
        "D. noong\n\n"
        "Susi sa Pagwawasto:\n"
        "6 - A\n"
        "7 - B\n"
        "8 - B\n"
    )
    p5.insert_text((50, 50), text_p5, fontsize=11)

    # Page 6: Blank / Empty page
    doc.new_page()

    doc.save(str(out_p))
    doc.close()
    return out_p


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("sample_reviewer.pdf")
    generate_sample_pdf(target)
    print(f"Generated synthetic PDF at {target}")
