from pathlib import Path

from lawgent_worker.chunking import chunk_pages, detect_article
from lawgent_worker.extract import Page, extract

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "demo"


def test_detect_article():
    assert detect_article("MADDE 7 – KİRA ARTIŞI") == "m.7"
    assert detect_article("7.2. Kira bedeli her yıl") == "m.7.2"
    assert detect_article("Md. 12/3 uyarınca") == "m.12.3"
    assert detect_article("2026 yılında") is None
    assert detect_article("Kira bedeli 185.000 TL") is None


def test_chunks_keep_page_and_article():
    pages = [
        Page(1, "MADDE 1 – TARAFLAR\n1.1. Kiraya veren X.\n1.2. Kiracı Y."),
        Page(2, "MADDE 7 – KİRA ARTIŞI\n7.1. Yeniden belirlenir.\n7.2. TÜFE oranında artırılır."),
    ]
    chunks = chunk_pages(pages)
    tufe = next(c for c in chunks if "TÜFE" in c.content)
    assert tufe.page_from == 2
    assert tufe.article_ref and tufe.article_ref.startswith("m.7")


def test_lease_pdf_text_layer():
    pages = extract((FIXTURES / "kira-sozlesmesi.pdf").read_bytes(), "application/pdf")
    assert len(pages) == 5
    assert not any(p.ocr for p in pages)
    chunks = chunk_pages(pages)
    hit = next(c for c in chunks if "Tüketici Fiyat Endeksi" in c.content)
    assert hit.page_from == 4
    assert hit.article_ref == "m.7.2"


def test_scanned_pdf_goes_through_turkish_ocr():
    pages = extract((FIXTURES / "ihtarname-taranmis.pdf").read_bytes(), "application/pdf")
    assert pages[0].ocr
    text = pages[0].text
    assert "İHTARNAME" in text
    assert "kira tespit davası" in text
