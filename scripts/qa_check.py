#!/usr/bin/env python3
"""QA checks for the publication viewer build pipeline."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

import fitz

from constants import (
    EXPECTED_CHILD_COUNT,
    EXPECTED_PARENT_COUNT,
    EXPECTED_PARENT_PAGES,
    EXPECTED_TOTAL_COUNT,
    IMAGE_EXTENSIONS,
    LINKS_FILENAME,
    PUBLIC_DATA_DIR,
    QA_PAGES,
    SOURCE_FILENAME,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PDF_PATH = PROJECT_ROOT / "source" / SOURCE_FILENAME
OUTLINE_PATH = PROJECT_ROOT / PUBLIC_DATA_DIR / "outline.json"
MANIFEST_PATH = PROJECT_ROOT / PUBLIC_DATA_DIR / "page-manifest.json"
LINKS_PATH = PROJECT_ROOT / PUBLIC_DATA_DIR / LINKS_FILENAME
FAVICON_PATH = PROJECT_ROOT / "assets" / "img" / "favicon.svg"
INDEX_PATH = PROJECT_ROOT / "index.html"
PAGES_DIR = PROJECT_ROOT / "pages"
THUMBS_DIR = PROJECT_ROOT / "thumbs"
ROBOTS_PATH = PROJECT_ROOT / "robots.txt"

FRONTEND_FILES = [
    PROJECT_ROOT / "index.html",
    PROJECT_ROOT / "assets" / "js" / "app.js",
    PROJECT_ROOT / "assets" / "css" / "styles.css",
]

PDF_REF_PATTERNS = [
    re.compile(r"\.pdf\b", re.IGNORECASE),
    re.compile(r"source/", re.IGNORECASE),
    re.compile(r"AWC_Publications", re.IGNORECASE),
]

DOWNLOAD_PATTERNS = [
    re.compile(r"download\s+pdf", re.IGNORECASE),
    re.compile(r"download\s+document", re.IGNORECASE),
    re.compile(r"save\s+pdf", re.IGNORECASE),
]

results: list[tuple[str, str, str]] = []


def record(status: str, check: str, detail: str) -> None:
    results.append((status, check, detail))


def load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_disk_path(public_path: str) -> Path:
    clean = public_path.lstrip("/")
    return PROJECT_ROOT / clean


def find_page_image(page_num: int) -> Path | None:
    for ext in IMAGE_EXTENSIONS:
        candidate = PAGES_DIR / f"page-{page_num:04d}.{ext}"
        if candidate.exists():
            return candidate
    return None


def find_thumb_image(page_num: int) -> Path | None:
    for ext in IMAGE_EXTENSIONS:
        candidate = THUMBS_DIR / f"page-{page_num:04d}.{ext}"
        if candidate.exists():
            return candidate
    return None


def scan_frontend_file(path: Path) -> tuple[list[str], list[str]]:
    if not path.exists():
        return [], []
    text = path.read_text(encoding="utf-8")
    pdf_hits = [p.pattern for p in PDF_REF_PATTERNS if p.search(text)]
    download_hits = [p.pattern for p in DOWNLOAD_PATTERNS if p.search(text)]
    return pdf_hits, download_hits


def main() -> int:
    print("=" * 60)
    print("QA Check Report")
    print("=" * 60)

    pdf_page_count = 0

    # Source PDF
    if PDF_PATH.exists():
        doc = fitz.open(PDF_PATH)
        pdf_page_count = doc.page_count
        doc.close()
        pdf_hash = sha256_file(PDF_PATH)
        record("PASS", "Source PDF exists", str(PDF_PATH))
        record("PASS", "PDF page count", str(pdf_page_count))
        record("PASS", "Source PDF SHA-256", pdf_hash)
    else:
        record("FAIL", "Source PDF exists", f"Missing: {PDF_PATH}")

    # Outline
    outline_data = load_json(OUTLINE_PATH)
    if outline_data:
        record("PASS", "outline.json exists", str(OUTLINE_PATH))
        outline = outline_data.get("outline", [])
        parent_count = len(outline)
        child_count = sum(len(sec.get("children", [])) for sec in outline)
        total_count = parent_count + child_count

        def count_status(actual: int, expected: int) -> str:
            return "PASS" if actual == expected else "WARN"

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
            record("WARN", "Parent section start pages", f"got {actual_parent_pages}")
    else:
        record("FAIL", "outline.json exists", f"Missing: {OUTLINE_PATH}")

    # Manifest
    manifest_data = load_json(MANIFEST_PATH)
    manifest_entries = 0
    if manifest_data:
        record("PASS", "page-manifest.json exists", str(MANIFEST_PATH))
        pages = manifest_data.get("pages", {})
        manifest_entries = len(pages)
        manifest_page_count = manifest_data.get("document", {}).get("pageCount", 0)
        if pdf_page_count and manifest_page_count == pdf_page_count:
            record("PASS", "Manifest document page count", str(manifest_page_count))
        elif pdf_page_count:
            record("WARN", "Manifest document page count", f"manifest={manifest_page_count}, pdf={pdf_page_count}")
        else:
            record("WARN", "Manifest document page count", str(manifest_page_count))

        missing_files = []
        missing_thumbs = []
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
            page_num = entry.get("page", int(key))
            if image and not find_thumb_image(page_num):
                missing_thumbs.append(page_num)

        if missing_files:
            record("FAIL", "Manifest files on disk", f"{len(missing_files)} missing: {missing_files[:5]}")
        else:
            record("PASS", "Manifest files on disk", "All referenced files exist")

        if missing_thumbs:
            record("FAIL", "Thumbnails for rendered pages", f"Missing thumbs for pages: {missing_thumbs[:10]}")
        else:
            record("PASS", "Thumbnails for rendered pages", f"All {manifest_entries} rendered pages have thumbnails")
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

    # Final page rendered
    if pdf_page_count:
        if find_page_image(pdf_page_count):
            record("PASS", "Final page rendered", f"page-{pdf_page_count:04d}")
        else:
            record("WARN", "Final page rendered", f"page-{pdf_page_count:04d} not found (run --qa or --all)")

    # Full render complete
    if pdf_page_count and manifest_entries:
        if manifest_entries >= pdf_page_count:
            record("PASS", "Full render complete", f"{manifest_entries}/{pdf_page_count} pages in manifest")
        else:
            record("WARN", "Full render complete", f"{manifest_entries}/{pdf_page_count} pages in manifest (run --all)")
    elif pdf_page_count:
        record("WARN", "Full render complete", "No manifest entries")

    # Frontend security scans
    all_pdf_refs: list[str] = []
    all_download_refs: list[str] = []
    for fpath in FRONTEND_FILES:
        pdf_hits, download_hits = scan_frontend_file(fpath)
        if pdf_hits:
            all_pdf_refs.append(f"{fpath.name}: {pdf_hits}")
        if download_hits:
            all_download_refs.append(f"{fpath.name}: {download_hits}")

    if all_pdf_refs:
        record("FAIL", "No public source PDF reference in frontend", "; ".join(all_pdf_refs))
    else:
        record("PASS", "No public source PDF reference in frontend", "index.html, app.js, styles.css clean")

    if all_download_refs:
        record("FAIL", "No PDF download button text", "; ".join(all_download_refs))
    else:
        record("PASS", "No PDF download button text", "No download phrases found")

    # robots.txt
    if ROBOTS_PATH.exists():
        record("PASS", "robots.txt exists", str(ROBOTS_PATH))
    else:
        record("FAIL", "robots.txt exists", f"Missing: {ROBOTS_PATH}")

    # Phase 4 — links, favicon, navigation, TOC styling
    links_data = load_json(LINKS_PATH)
    if links_data:
        summary = links_data.get("summary", {})
        total = summary.get("totalLinks", 0)
        uri_count = summary.get("uriLinks", 0)
        pages_with = summary.get("pagesWithLinks", 0)
        record(
            "PASS" if total > 0 else "WARN",
            "links.json exists",
            f"{LINKS_PATH} ({total} links)",
        )
        record(
            "PASS" if total > 0 else "WARN",
            "Link summary counts",
            f"total={total}, uri={uri_count}, pagesWithLinks={pages_with}",
        )
    else:
        record("WARN", "links.json exists", f"Missing: {LINKS_PATH} (run scripts/extract_links.py)")
        record("WARN", "Link summary counts", "links.json not found")

    if FAVICON_PATH.exists():
        record("PASS", "favicon.svg exists", str(FAVICON_PATH))
    else:
        record("FAIL", "favicon.svg exists", f"Missing: {FAVICON_PATH}")

    if INDEX_PATH.exists():
        index_html = INDEX_PATH.read_text(encoding="utf-8")
        nav_ids = ["btnFirstPage", "btnSectionTop", "btnNextSection"]
        missing_nav = [btn_id for btn_id in nav_ids if btn_id not in index_html]
        if missing_nav:
            record("FAIL", "Section navigation buttons in index.html", f"Missing: {missing_nav}")
        else:
            record("PASS", "Section navigation buttons in index.html", ", ".join(nav_ids))
    else:
        record("FAIL", "Section navigation buttons in index.html", f"Missing: {INDEX_PATH}")

    styles_path = PROJECT_ROOT / "assets" / "css" / "styles.css"
    if styles_path.exists():
        styles_text = styles_path.read_text(encoding="utf-8")
        toc_ok = ".toc-parent" in styles_text and ".toc-child" in styles_text
        record(
            "PASS" if toc_ok else "FAIL",
            "TOC hierarchy styles in styles.css",
            "Found .toc-parent and .toc-child" if toc_ok else "Missing TOC classes",
        )
    else:
        record("FAIL", "TOC hierarchy styles in styles.css", f"Missing: {styles_path}")

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
