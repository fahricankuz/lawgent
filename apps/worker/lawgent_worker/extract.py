"""Belgeden sayfa sayfa metin çıkarma. Taranmış sayfalar Türkçe OCR'dan geçer.

PDF: her sayfa için önce metin katmanı (pdftotext); yetersizse sayfa görüntüye çevrilip
Tesseract (tur) ile okunur. Böylece karma belgelerde (kısmen taranmış) da sayfa numarası korunur.
"""
from __future__ import annotations

import io
import re
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree

MIN_TEXT_CHARS = 40  # Bundan az metin varsa sayfa taranmış kabul edilir.


@dataclass
class Page:
    page_no: int
    text: str
    ocr: bool = False


def _run(args: list[str], timeout: int = 300) -> str:
    return subprocess.run(args, check=True, capture_output=True, timeout=timeout).stdout.decode("utf-8", "replace")


def _ocr_image(path: Path, lang: str) -> str:
    return _run(["tesseract", str(path), "stdout", "-l", lang, "--psm", "3"])


def _pdf_page_count(path: Path) -> int:
    m = re.search(r"^Pages:\s+(\d+)", _run(["pdfinfo", str(path)]), re.M)
    if not m:
        raise ValueError("PDF sayfa sayısı okunamadı")
    return int(m.group(1))


def extract_pdf(data: bytes, lang: str) -> list[Page]:
    with tempfile.TemporaryDirectory() as d:
        pdf = Path(d) / "in.pdf"
        pdf.write_bytes(data)
        pages: list[Page] = []
        for n in range(1, _pdf_page_count(pdf) + 1):
            text = _run(["pdftotext", "-layout", "-enc", "UTF-8", "-f", str(n), "-l", str(n), str(pdf), "-"])
            if len(text.strip()) >= MIN_TEXT_CHARS:
                pages.append(Page(n, text))
                continue
            prefix = Path(d) / f"p{n}"
            _run(["pdftoppm", "-r", "300", "-gray", "-png", "-singlefile", "-f", str(n), "-l", str(n), str(pdf), str(prefix)])
            pages.append(Page(n, _ocr_image(prefix.with_suffix(".png"), lang), ocr=True))
        return pages


def extract_image(data: bytes, suffix: str, lang: str) -> list[Page]:
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / f"in{suffix}"
        p.write_bytes(data)
        return [Page(1, _ocr_image(p, lang), ocr=True)]


def extract_docx(data: bytes) -> list[Page]:
    """Word'de sayfa bilgisi düzende değil; açık sayfa sonlarını (w:br type=page) sayfa sınırı sayarız."""
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        root = ElementTree.fromstring(z.read("word/document.xml"))
    pages: list[list[str]] = [[]]
    for para in root.iter(f"{ns}p"):
        buf: list[str] = []
        for el in para.iter():
            if el.tag == f"{ns}t" and el.text:
                buf.append(el.text)
            elif el.tag == f"{ns}tab":
                buf.append("\t")
            elif el.tag == f"{ns}br" and el.get(f"{ns}type") == "page":
                pages[-1].append("".join(buf))
                buf = []
                pages.append([])
        pages[-1].append("".join(buf))
    return [Page(i + 1, "\n".join(p)) for i, p in enumerate(pages) if any(s.strip() for s in p)] or [Page(1, "")]


def extract_text(data: bytes) -> list[Page]:
    text = data.decode("utf-8", "replace")
    parts = text.split("\f")
    return [Page(i + 1, t) for i, t in enumerate(parts)]


def extract(data: bytes, mime: str, lang: str = "tur") -> list[Page]:
    if mime == "application/pdf":
        return extract_pdf(data, lang)
    if mime in ("image/png", "image/jpeg", "image/tiff"):
        return extract_image(data, {"image/png": ".png", "image/jpeg": ".jpg", "image/tiff": ".tif"}[mime], lang)
    if mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return extract_docx(data)
    if mime == "text/plain":
        return extract_text(data)
    raise ValueError(f"Desteklenmeyen tür: {mime}")
