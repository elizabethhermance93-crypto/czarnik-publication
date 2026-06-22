#!/usr/bin/env python3
"""QA checks for the publication viewer build pipeline."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import fitz

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PDF_PATH = PROJECT_ROOT / "source" / "AWC_Publications_v17_bookmarked_citation_outline.pdf"
OUTLINE_PATH = PROJECT_ROOT / "data" / "outline.json"
MANIFEST_PATH = PROJECT_ROOT / "data" / "page-manifest.json"
PAGES_DIR = PROJECT_ROOT / "pages"
THUMBS_DIR = PROJECT_ROOT / "thumbs"

EXPECTED_PARENT_PAGES = [1, 49, 116, 156, 165, 214, 304, 456, 507, 658, 666, 708, 910]
EXPECTED_PARENT_COUNT = 13
EXPECTED_CHILD_COUNT = 178
EXPECTED_TOTAL_COUNT = 191

QA_PAGES = [1, 49, 116, 156, 165, 214, 304, 456, 507, 658, 666, 708, 910]

results: list[tuple[str, str, str]] = []


def record(status: str, check: str, detail: str) -> None:
    results.append((status, check, detail))


def load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def resolve_disk_path(public_path: str) -> Path:
    clean = public_path.lstrip("/")
    return PROJECT_ROOT / clean


def find_page_image(page_num: int) -> Path | None:
    for ext in ("webp", "png"):
        candidate = PAGES_DIR / f"page-{page_num:04d}.{ext}"
        if candidate.exists():
            return candidate
    return None


def main() -> int:
    print("=" * 60)
    print("QA Check Report")
    print("=" * 60)

    # Source PDF
    if PDF_PATH.exists():
        doc = fitz.open(PDF_PATH)
        pdf_page_count = doc.page_count
        doc.close()
        record("PASS", "Source PDF exists", str(PDF_PATH))
        record("PASS", "PDF page count", str(pdf_page_count))
    else:
        pdf_page_count = 0
        record("FAIL", "Source PDF exists", f"Missing: {PDF_PATH}")

    # Outline
    outline_data = load_json(OUTLINE_PATH)
    if outline_data:
        record("PASS", "outline.json exists", str(OUTLINE_PATH))
        outline = outline_data.get("outline", [])
        parent_count = len(outline)
        child_count = sum(len(sec.get("children", [])) for sec in outline)
        total_count = parent_count + child_count

        outline_extracted = outline_data.get("document", {}).get("pageCount", 0) > 0

        def count_status(actual: int, expected: int) -> str:
            if actual == expected:
                return "PASS"
            return "FAIL" if outline_extracted else "WARN"

        record(
            count_status(parent_count, EXPECTED_PARENT_COUNT),
            "Parent section count",
            f"{parent_count} (expected {EXPECTED_PARENT_COUNT})",
        )
        record(
            count_status(child_count, EXPECTED_CHILD_COUNT),
            "Child publication count",
            f"{child_count} (expected {EXPECTED_CHILD_COUNT})",
        )
        record(
            count_status(total_count, EXPECTED_TOTAL_COUNT),
            "Total outline entries",
            f"{total_count} (expected {EXPECTED_TOTAL_COUNT})",
        )

        actual_parent_pages = [sec.get("page") for sec in outline]
        if actual_parent_pages == EXPECTED_PARENT_PAGES:
            record("PASS", "Parent section start pages", str(actual_parent_pages))
        else:
            status = "FAIL" if outline_extracted else "WARN"
            record(status, "Parent section start pages", f"got {actual_parent_pages}")
    else:
        record("FAIL", "outline.json exists", f"Missing: {OUTLINE_PATH}")

    # Manifest
    manifest_data = load_json(MANIFEST_PATH)
    if manifest_data:
        record("PASS", "page-manifest.json exists", str(MANIFEST_PATH))
        pages = manifest_data.get("pages", {})
        manifest_page_count = manifest_data.get("document", {}).get("pageCount", 0)
        if pdf_page_count and manifest_page_count == pdf_page_count:
            record("PASS", "Manifest page count matches PDF", str(manifest_page_count))
        elif pdf_page_count:
            record("WARN", "Manifest page count matches PDF", f"manifest={manifest_page_count}, pdf={pdf_page_count}")
        else:
            record("WARN", "Manifest page count", str(manifest_page_count))

        missing_files = []
        for key, entry in pages.items():
            image = entry.get("image")
            if image:
                disk = resolve_disk_path(image)
                if not disk.exists():
                    missing_files.append(image)
            thumb = entry.get("thumb")
            if thumb:
                disk = resolve_disk_path(thumb)
                if not disk.exists():
                    missing_files.append(thumb)

        if missing_files:
            record("FAIL", "Manifest files on disk", f"{len(missing_files)} missing: {missing_files[:5]}")
        else:
            record("PASS", "Manifest files on disk", "All referenced files exist")
    else:
        record("FAIL", "page-manifest.json exists", f"Missing: {MANIFEST_PATH}")

    # QA rendered pages
    qa_targets = list(QA_PAGES)
    if pdf_page_count and pdf_page_count not in qa_targets:
        qa_targets.append(pdf_page_count)

    missing_qa = [p for p in qa_targets if not find_page_image(p)]
    if missing_qa:
        record("WARN", "QA rendered pages", f"Missing: {missing_qa}")
    else:
        record("PASS", "QA rendered pages", f"All {len(qa_targets)} QA pages rendered")

    # Print report
    print()
    for status, check, detail in results:
        print(f"[{status:4}] {check}: {detail}")

    print()
    fails = sum(1 for s, _, _ in results if s == "FAIL")
    warns = sum(1 for s, _, _ in results if s == "WARN")
    passes = sum(1 for s, _, _ in results if s == "PASS")
    print(f"Summary: {passes} PASS, {warns} WARN, {fails} FAIL")
    print("=" * 60)

    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
