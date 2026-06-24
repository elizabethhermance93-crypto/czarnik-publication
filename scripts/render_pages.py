#!/usr/bin/env python3
"""Render PDF pages to WebP images and thumbnails."""

from __future__ import annotations

import argparse
import sys
from enum import Enum
from pathlib import Path

import fitz
from PIL import Image

from constants import IMAGE_EXTENSIONS, QA_PAGES, SOURCE_FILENAME

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PDF_PATH = PROJECT_ROOT / "source" / SOURCE_FILENAME
PAGES_DIR = PROJECT_ROOT / "pages"
THUMBS_DIR = PROJECT_ROOT / "thumbs"

DEFAULT_DPI = 170
DEFAULT_QUALITY = 88
DEFAULT_THUMB_WIDTH = 260
THUMB_QUALITY = 75


class RenderStatus(Enum):
    RENDERED = "rendered"
    SKIPPED = "skipped"
    FAILED = "failed"


def parse_page_list(raw: str) -> list[int]:
    pages: set[int] = set()
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_s, end_s = part.split("-", 1)
            start, end = int(start_s), int(end_s)
            if start > end:
                start, end = end, start
            pages.update(range(start, end + 1))
        else:
            pages.add(int(part))
    return sorted(pages)


def page_filename(page_num: int, ext: str) -> str:
    return f"page-{page_num:04d}.{ext}"


def find_existing_image(directory: Path, page_num: int) -> Path | None:
    for ext in IMAGE_EXTENSIONS:
        candidate = directory / page_filename(page_num, ext)
        if candidate.exists():
            return candidate
    return None


def page_assets_exist(page_num: int) -> bool:
    return find_existing_image(PAGES_DIR, page_num) is not None and find_existing_image(THUMBS_DIR, page_num) is not None


def save_image(img: Image.Image, path: Path, quality: int) -> str:
    """Save as WebP; fall back to PNG on failure. Returns extension used."""
    try:
        img.save(path, format="WEBP", quality=quality, method=6)
        return "webp"
    except Exception as exc:
        png_path = path.with_suffix(".png")
        print(f"  WARN: WebP save failed for {path.name} ({exc}); saving PNG instead.")
        img.save(png_path, format="PNG", optimize=True)
        if path.exists():
            path.unlink()
        return "png"


def render_page(
    doc: fitz.Document,
    page_num: int,
    dpi: int,
    quality: int,
    thumb_width: int,
    force: bool = False,
) -> RenderStatus:
    if not force and page_assets_exist(page_num):
        return RenderStatus.SKIPPED

    page_index = page_num - 1
    if page_index < 0 or page_index >= doc.page_count:
        print(f"  FAIL: page {page_num} out of range (1-{doc.page_count})")
        return RenderStatus.FAILED

    try:
        PAGES_DIR.mkdir(parents=True, exist_ok=True)
        THUMBS_DIR.mkdir(parents=True, exist_ok=True)

        page = doc.load_page(page_index)
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=matrix, alpha=False)

        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

        page_path = PAGES_DIR / page_filename(page_num, "webp")
        ext = save_image(img, page_path, quality)
        final_page_path = PAGES_DIR / page_filename(page_num, ext)

        ratio = thumb_width / img.width
        thumb_height = max(1, int(img.height * ratio))
        thumb = img.resize((thumb_width, thumb_height), Image.Resampling.LANCZOS)
        thumb_path = THUMBS_DIR / page_filename(page_num, "webp")
        thumb_ext = save_image(thumb, thumb_path, THUMB_QUALITY)
        final_thumb_path = THUMBS_DIR / page_filename(page_num, thumb_ext)

        print(
            f"  OK: {final_page_path.name} ({img.width}x{img.height}), "
            f"thumb {final_thumb_path.name}"
        )
        return RenderStatus.RENDERED
    except Exception as exc:
        print(f"  FAIL: page {page_num}: {exc}")
        return RenderStatus.FAILED


def resolve_pages(args: argparse.Namespace, doc: fitz.Document) -> list[int]:
    if args.all:
        return list(range(1, doc.page_count + 1))
    if args.qa:
        pages = list(QA_PAGES)
        if doc.page_count not in pages:
            pages.append(doc.page_count)
        return sorted(set(pages))
    if args.pages:
        return [p for p in parse_page_list(args.pages) if 1 <= p <= doc.page_count]
    return []


def folder_size(directory: Path) -> int:
    if not directory.exists():
        return 0
    return sum(f.stat().st_size for f in directory.iterdir() if f.is_file())


def format_bytes(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    if n < 1024 * 1024 * 1024:
        return f"{n / (1024 * 1024):.1f} MB"
    return f"{n / (1024 * 1024 * 1024):.2f} GB"


def main() -> int:
    parser = argparse.ArgumentParser(description="Render PDF pages to WebP images.")
    parser.add_argument("--pages", type=str, help="Comma-separated page numbers or ranges, e.g. 1,49,100-105")
    parser.add_argument("--qa", action="store_true", help="Render QA pages plus final page")
    parser.add_argument("--all", action="store_true", help="Render all pages")
    parser.add_argument("--force", action="store_true", help="Re-render even if output files exist")
    parser.add_argument("--dpi", type=int, default=DEFAULT_DPI, help=f"Render DPI (default {DEFAULT_DPI})")
    parser.add_argument("--quality", type=int, default=DEFAULT_QUALITY, help=f"WebP quality (default {DEFAULT_QUALITY})")
    parser.add_argument("--thumb-width", type=int, default=DEFAULT_THUMB_WIDTH, help=f"Thumbnail width (default {DEFAULT_THUMB_WIDTH})")
    args = parser.parse_args()

    if not PDF_PATH.exists():
        print(f"FAIL: Source PDF not found at {PDF_PATH}")
        return 1

    if not args.pages and not args.qa and not args.all:
        print("No pages selected. Use --pages, --qa, or --all.")
        print("Examples:")
        print("  python scripts/render_pages.py --pages 1,49,116")
        print("  python scripts/render_pages.py --qa")
        print("  python scripts/render_pages.py --all")
        return 1

    doc = fitz.open(PDF_PATH)
    pages = resolve_pages(args, doc)
    if not pages:
        print("No valid pages to render.")
        doc.close()
        return 1

    total_pages = doc.page_count
    print(f"Rendering {len(pages)} page(s) at {args.dpi} DPI (document has {total_pages} pages)...")

    counts = {status: 0 for status in RenderStatus}
    for i, page_num in enumerate(pages, 1):
        denominator = total_pages if args.all else len(pages)
        print(f"Rendering page {page_num} / {denominator}...")
        status = render_page(doc, page_num, args.dpi, args.quality, args.thumb_width, force=args.force)
        counts[status] += 1

    doc.close()

    print("\n--- Summary ---")
    print(f"  Pages rendered: {counts[RenderStatus.RENDERED]}")
    print(f"  Pages skipped:  {counts[RenderStatus.SKIPPED]}")
    print(f"  Failures:       {counts[RenderStatus.FAILED]}")
    print(f"  pages/ size:    {format_bytes(folder_size(PAGES_DIR))}")
    print(f"  thumbs/ size:   {format_bytes(folder_size(THUMBS_DIR))}")
    print("Done.")

    return 1 if counts[RenderStatus.FAILED] else 0


if __name__ == "__main__":
    sys.exit(main())
