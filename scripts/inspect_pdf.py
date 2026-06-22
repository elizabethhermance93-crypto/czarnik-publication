#!/usr/bin/env python3
"""Inspect the source PDF and print a structured report."""

from __future__ import annotations

import hashlib
import sys
from collections import Counter
from pathlib import Path

import fitz

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PDF_PATH = PROJECT_ROOT / "source" / "AWC_Publications_v17_bookmarked_citation_outline.pdf"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def count_toc_levels(toc: list) -> tuple[int, int, int]:
    """Return total entries, parent (level 1), child (level 2+) counts."""
    if not toc:
        return 0, 0, 0
    parents = sum(1 for entry in toc if entry[0] == 1)
    children = sum(1 for entry in toc if entry[0] >= 2)
    return len(toc), parents, children


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
    total, parents, children = count_toc_levels(toc)
    print(f"\n--- Table of Contents ---")
    print(f"Total bookmark entries: {total}")
    print(f"Parent bookmarks (level 1): {parents}")
    print(f"Child bookmarks (level 2+): {children}")

    print(f"\n--- Page Sizes ---")
    print(summarize_page_sizes(doc))

    doc.close()
    print("\n" + "=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
