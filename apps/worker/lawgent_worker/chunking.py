"""Madde farkında parçalama.

Sözleşme ve dilekçelerde "Madde 7", "MADDE 7.2 –", "7.2." gibi başlıkları izler; her parçaya
başladığı sayfa ile bulunduğu maddeyi ("m.7.2") etiketler. Böylece yanıt "s.4, m.7.2" diye kaynak gösterebilir.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .extract import Page

TARGET_CHARS = 1200
MAX_CHARS = 1800
OVERLAP_CHARS = 200

# "Madde 7", "MADDE 7.2", "Md. 12", "m. 7/2" ve satır başı "7.2." / "7.2 " numaralandırmaları.
ARTICLE_RE = re.compile(
    r"^\s*(?:(?:MADDE|Madde|madde|MD\.|Md\.|md\.|m\.)\s*(\d+(?:[./]\d+)*)|(\d+(?:\.\d+)+)[.)]?\s+\S)",
)


@dataclass
class Chunk:
    ordinal: int
    page_from: int
    page_to: int
    article_ref: str | None
    content: str


def detect_article(line: str) -> str | None:
    m = ARTICLE_RE.match(line)
    if not m:
        return None
    num = (m.group(1) or m.group(2)).replace("/", ".")
    return f"m.{num}"


def _normalize(text: str) -> str:
    text = text.replace("\r", "")
    text = re.sub(r"[ \t]+", " ", text)
    # Satır sonu tirelemesini birleştir: "sözleş-\nme" → "sözleşme"
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    return text


def _is_heading(line: str) -> bool:
    """"MADDE 7 – KİRA ARTIŞI" gibi yalnızca başlık olan satır."""
    return bool(re.match(r"^\s*(MADDE|Madde)\s*\d+\s*[–—:-]?\s*[^.]{0,80}$", line))


def chunk_pages(pages: list[Page]) -> list[Chunk]:  # noqa: C901
    """Her madde/alt madde yeni bir parçada başlar; uzun maddeler örtüşmeli bölünür.

    Alt madde parçalarının başına üst madde başlığı eklenir ("MADDE 7 – KİRA ARTIŞI"),
    böylece arama bağlamı kaybetmez, kaynak ise kesin kalır (s.4, m.7.2).
    """
    chunks: list[Chunk] = []
    lines: list[str] = []
    size = 0
    start_page = pages[0].page_no if pages else 1
    last_page = start_page
    article: str | None = None
    heading: str | None = None
    only_headings = True
    carried = False  # Satırlar yalnızca önceki parçadan gelen örtüşme mi?

    def flush(overlap: bool) -> None:
        nonlocal lines, size, start_page, only_headings, carried
        content = "\n".join(lines).strip()
        if content and not only_headings:
            chunks.append(Chunk(len(chunks), start_page, last_page, article, content))
        tail = content[-OVERLAP_CHARS:] if overlap and content else ""
        lines, size = ([tail], len(tail)) if tail else ([], 0)
        only_headings = True
        carried = bool(tail)

    def add(line: str, page_no: int, is_heading: bool = False) -> None:
        nonlocal size, start_page, last_page, only_headings, carried
        if not lines or carried:
            start_page = page_no
        lines.append(line)
        size += len(line) + 1
        last_page = page_no
        if not is_heading:
            only_headings = False
            carried = False

    for page in pages:
        for raw in _normalize(page.text).split("\n"):
            line = raw.strip()
            if not line:
                continue
            new_article = detect_article(line)
            if new_article and new_article != article:
                if not only_headings:
                    flush(overlap=False)
                elif carried:
                    # Önceki maddenin örtüşme kuyruğu yeni maddeye taşınmaz.
                    lines, size, carried = [], 0, False
                article = new_article
                if _is_heading(line):
                    heading = line
                    add(line, page.page_no, is_heading=True)
                    continue
                # Alt madde: üst başlığı bağlam olarak taşı (sayfa numarasını etkilemez).
                if heading and not lines and new_article.startswith(f"m.{heading_number(heading)}."):
                    lines.append(heading)
                    size += len(heading) + 1
                    start_page = page.page_no
            if size + len(line) > MAX_CHARS and not only_headings:
                flush(overlap=True)
            add(line, page.page_no)
            if size >= TARGET_CHARS and line.endswith((".", ":", ";")):
                flush(overlap=True)
    flush(overlap=False)
    return chunks


def heading_number(heading: str) -> str:
    m = re.search(r"\d+", heading)
    return m.group(0) if m else ""
