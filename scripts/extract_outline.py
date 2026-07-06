#!/usr/bin/env python3
"""Extract PDF bookmarks into viewer-data/outline.json."""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import fitz

from constants import (
    DOCUMENT_TITLE,
    EXPECTED_CHILD_COUNT,
    EXPECTED_PARENT_COUNT,
    EXPECTED_PARENT_PAGES,
    EXPECTED_TOTAL_COUNT,
    PUBLIC_DATA_DIR,
    SOURCE_FILENAME,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PDF_PATH = PROJECT_ROOT / "source" / SOURCE_FILENAME
OUTLINE_PATH = PROJECT_ROOT / PUBLIC_DATA_DIR / "outline.json"

CITATION_YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
CITATION_SPLIT_RE = re.compile(r"\s*[,;]\s*(?=(?:J\.|Vol\.|pp\.|p\.|doi:|\d{4}))", re.IGNORECASE)


def slugify(text: str, prefix: str = "") -> str:
    slug = text.lower()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug).strip("-")
    slug = re.sub(r"-+", "-", slug)
    if not slug:
        slug = "untitled"
    return f"{prefix}{slug}" if prefix else slug


def split_title_citation(raw_title: str) -> tuple[str, str]:
    """Try to separate visible title from citation-like tail text."""
    title = raw_title.strip()
    if not title:
        return "", ""

    if CITATION_SPLIT_RE.search(title):
        parts = CITATION_SPLIT_RE.split(title, maxsplit=1)
        if len(parts) == 2 and parts[0].strip() and parts[1].strip():
            return parts[0].strip(), parts[1].strip()

    if CITATION_YEAR_RE.search(title) and title.count(",") >= 2:
        comma_idx = title.rfind(",", 0, len(title) // 2 + 20)
        if comma_idx > 20:
            head = title[:comma_idx].strip()
            tail = title[comma_idx + 1 :].strip()
            if head and tail and CITATION_YEAR_RE.search(tail):
                return head, tail

    return title, ""


def build_outline(toc: list) -> list[dict]:
    outline: list[dict] = []
    current_parent: dict | None = None
    used_ids: set[str] = set()

    def unique_id(base: str) -> str:
        candidate = base
        n = 2
        while candidate in used_ids:
            candidate = f"{base}-{n}"
            n += 1
        used_ids.add(candidate)
        return candidate

    for level, title, page in toc:
        page_num = max(1, int(page))
        if level <= 1:
            clean_title, _ = split_title_citation(title)
            node_id = unique_id(slugify(clean_title or title, "sec-"))
            current_parent = {
                "id": node_id,
                "title": clean_title or title.strip(),
                "page": page_num,
                "children": [],
            }
            outline.append(current_parent)
        else:
            clean_title, citation = split_title_citation(title)
            child_id = unique_id(slugify(clean_title or title, "pub-"))
            child = {
                "id": child_id,
                "title": clean_title or title.strip(),
                "page": page_num,
                "citation": citation,
            }
            if current_parent is not None:
                current_parent["children"].append(child)
            else:
                outline.append(
                    {
                        "id": child_id,
                        "title": child["title"],
                        "page": page_num,
                        "children": [],
                    }
                )

    return outline


def validate_counts(outline: list[dict]) -> None:
    parent_count = len(outline)
    child_count = sum(len(sec.get("children", [])) for sec in outline)
    total_count = parent_count + child_count
    actual_parent_pages = [sec.get("page") for sec in outline]

    checks = [
        (parent_count, EXPECTED_PARENT_COUNT, "parent sections"),
        (child_count, EXPECTED_CHILD_COUNT, "child publications"),
        (total_count, EXPECTED_TOTAL_COUNT, "total outline entries"),
    ]
    for actual, expected, label in checks:
        if actual != expected:
            print(f"  WARN: {label}: got {actual}, expected {expected}")

    if actual_parent_pages != EXPECTED_PARENT_PAGES:
        print(f"  WARN: parent section start pages differ from expected")
        print(f"         got:      {actual_parent_pages}")
        print(f"         expected: {EXPECTED_PARENT_PAGES}")


def main() -> int:
    if not PDF_PATH.exists():
        print(f"FAIL: Source PDF not found at {PDF_PATH}")
        return 1

    doc = fitz.open(PDF_PATH)
    toc = doc.get_toc()
    page_count = doc.page_count
    doc.close()

    outline = build_outline(toc)
    parent_count = len(outline)
    child_count = sum(len(sec.get("children", [])) for sec in outline)

    payload = {
        "document": {
            "title": DOCUMENT_TITLE,
            "sourceFile": SOURCE_FILENAME,
            "pageCount": page_count,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        },
        "outline": outline,
    }

    OUTLINE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTLINE_PATH.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(f"Wrote {OUTLINE_PATH}")
    print(f"  Page count: {page_count}")
    print(f"  Parent sections: {parent_count}")
    print(f"  Child publications: {child_count}")
    print(f"  Total outline entries: {parent_count + child_count}")

    print("\nValidation:")
    validate_counts(outline)

    return 0


if __name__ == "__main__":
    sys.exit(main())
