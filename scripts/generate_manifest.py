#!/usr/bin/env python3
"""Generate data/page-manifest.json from rendered page images."""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import fitz
from PIL import Image

from constants import DOCUMENT_TITLE, SOURCE_FILENAME

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PDF_PATH = PROJECT_ROOT / "source" / SOURCE_FILENAME
PAGES_DIR = PROJECT_ROOT / "pages"
THUMBS_DIR = PROJECT_ROOT / "thumbs"
MANIFEST_PATH = PROJECT_ROOT / "data" / "page-manifest.json"

PAGE_FILE_RE = re.compile(r"^page-(\d{4})\.(webp|png|jpe?g)$", re.IGNORECASE)


def get_page_count() -> int:
    if PDF_PATH.exists():
        doc = fitz.open(PDF_PATH)
        count = doc.page_count
        doc.close()
        return count
    return 0


def scan_images(directory: Path) -> dict[int, Path]:
    found: dict[int, Path] = {}
    if not directory.exists():
        return found
    for path in sorted(directory.iterdir()):
        match = PAGE_FILE_RE.match(path.name)
        if match:
            found[int(match.group(1))] = path
    return found


def image_dimensions(path: Path) -> tuple[int, int]:
    with Image.open(path) as img:
        return img.width, img.height


def public_path(relative: Path) -> str:
    return "/" + relative.as_posix()


def main() -> int:
    page_files = scan_images(PAGES_DIR)
    thumb_files = scan_images(THUMBS_DIR)

    if not page_files and not thumb_files:
        print("WARN: No rendered images found in pages/ or thumbs/.")

    all_page_nums = sorted(set(page_files) | set(thumb_files))
    pages_data: dict[str, dict] = {}

    for page_num in all_page_nums:
        page_path = page_files.get(page_num)
        thumb_path = thumb_files.get(page_num)

        width, height = 0, 0
        if page_path:
            width, height = image_dimensions(page_path)

        entry: dict = {"page": page_num}
        if page_path:
            entry["image"] = public_path(Path("pages") / page_path.name)
            entry["width"] = width
            entry["height"] = height
        if thumb_path:
            entry["thumb"] = public_path(Path("thumbs") / thumb_path.name)

        pages_data[str(page_num)] = entry

    page_count = get_page_count()

    payload = {
        "document": {
            "title": DOCUMENT_TITLE,
            "pageCount": page_count,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        },
        "pages": pages_data,
    }

    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with MANIFEST_PATH.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(f"Wrote {MANIFEST_PATH}")
    print(f"  Document page count: {page_count}")
    print(f"  Manifest entries: {len(pages_data)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
