#!/usr/bin/env python3
"""Inspect the source PDF and print a structured report."""

from __future__ import annotations

import hashlib
import sys
from collections import Counter
from pathlib import Path

import fitz

from constants import (
    EXPECTED_CHILD_COUNT,
    EXPECTED_PARENT_COUNT,
    EXPECTED_PARENT_PAGES,
    EXPECTED_TOTAL_COUNT,
    SOURCE_FILENAME,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PDF_PATH = PROJECT_ROOT / "source" / SOURCE_FILENAME


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def count_toc_levels(toc: list) -> tuple[int, dict[int, int]]:
    """Return total entries and per-level counts."""
    if not toc:
        return 0, {}
    levels: Counter[int] = Counter()
    for entry in toc:
        levels[entry[0]] += 1
    return len(toc), dict(sorted(levels.items()))


def format_page_size(doc: fitz.Document, page_index: int) -> str:
    rect = doc[page_index].rect
    return f"{rect.width:.1f} x {rect.height:.1f} pt"


def summarize_page_sizes(doc: fitz.Document) -> str:
    sizes = Counter()
    for page in doc:
        rect = page.rect
        key = f"{rect.width:.1f} x {rect.height:.1f} pt"
        sizes[key] += 1
    lines = [f"  {size}: {count} page(s)" for size, count in sizes.most_common()]
    return "\n".join(lines) if lines else "  (none)"


def main() -> int:
    print("=" * 60)
    print("PDF Inspection Report")
    print("=" * 60)
    print(f"Path: {PDF_PATH}")

    if not PDF_PATH.exists():
        print("\nFAIL: Source PDF not found.")
        print("Place the file at:")
        print(f"  {PDF_PATH}")
        return 1

    size_bytes = PDF_PATH.stat().st_size
    print(f"\nFile exists: yes")
    print(f"File size: {size_bytes:,} bytes ({size_bytes / (1024 * 1024):.2f} MB)")
    print(f"SHA-256: {sha256_file(PDF_PATH)}")

    doc = fitz.open(PDF_PATH)

    metadata = doc.metadata or {}
    print("\n--- Metadata ---")
    for key in ("format", "title", "author", "subject", "keywords", "creator", "producer", "creationDate", "modDate"):
        value = metadata.get(key, "")
        if value:
            print(f"  {key}: {value}")

    page_count = doc.page_count
    print(f"\n--- Document ---")
    print(f"Page count: {page_count}")
    print(f"Encrypted: {'yes' if doc.is_encrypted else 'no'}")
    if doc.is_encrypted:
        print(f"Needs password: {'yes' if doc.needs_pass else 'no'}")

    toc = doc.get_toc()
    total, level_counts = count_toc_levels(toc)
    print(f"\n--- Table of Contents ---")
    print(f"Total bookmark entries: {total}")
    for level, count in level_counts.items():
        label = "parent" if level == 1 else f"level {level}"
        print(f"  Level {level} ({label}): {count}")
    deeper = sum(c for lvl, c in level_counts.items() if lvl > 2)
    if deeper:
        print(f"  Deeper levels (3+): {deeper}")

    print(f"\n--- Expected Structure (reference) ---")
    print(f"  Expected parent sections: {EXPECTED_PARENT_COUNT}")
    print(f"  Expected child publications: {EXPECTED_CHILD_COUNT}")
    print(f"  Expected total entries: {EXPECTED_TOTAL_COUNT}")
    print(f"  Expected parent start pages: {EXPECTED_PARENT_PAGES}")

    print(f"\n--- Page Sizes ---")
    if page_count > 0:
        print(f"  First page: {format_page_size(doc, 0)}")
        if page_count > 1:
            print(f"  Final page: {format_page_size(doc, page_count - 1)}")
    print("  Summary:")
    print(summarize_page_sizes(doc))

    doc.close()
    print("\n" + "=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
