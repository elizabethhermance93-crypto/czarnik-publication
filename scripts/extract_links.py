#!/usr/bin/env python3
"""Extract PDF link annotations into viewer-data/links.json."""

from __future__ import annotations

import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import fitz

from constants import LINKS_FILENAME, PUBLIC_DATA_DIR, SOURCE_FILENAME

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PDF_PATH = PROJECT_ROOT / "source" / SOURCE_FILENAME
LINKS_PATH = PROJECT_ROOT / PUBLIC_DATA_DIR / LINKS_FILENAME
REPORT_PATH = PROJECT_ROOT / "reports" / "link-report.md"

LINK_URI = getattr(fitz, "LINK_URI", 2)
LINK_GOTO = getattr(fitz, "LINK_GOTO", 1)
LINK_NAMED = getattr(fitz, "LINK_NAMED", 3)


def normalize_rect(rect: fitz.Rect, page: fitz.Page) -> dict[str, float]:
    pw = page.rect.width or 1.0
    ph = page.rect.height or 1.0
    return {
        "x": rect.x0 / pw,
        "y": rect.y0 / ph,
        "w": (rect.x1 - rect.x0) / pw,
        "h": (rect.y1 - rect.y0) / ph,
    }


def resolve_internal_target(link: dict, doc: fitz.Document) -> int | None:
    page = link.get("page")
    if page is not None:
        return int(page) + 1

    dest = link.get("dest")
    if dest is None:
        return None

    if isinstance(dest, (list, tuple)) and dest:
        try:
            return int(dest[0]) + 1
        except (TypeError, ValueError):
            pass

    if isinstance(dest, str):
        try:
            resolved = doc.resolve_link(dest)
            if resolved and resolved[0] is not None:
                return int(resolved[0]) + 1
        except Exception:
            return None

    return None


def extract_links(doc: fitz.Document) -> tuple[dict, dict]:
    pages: dict[str, list[dict]] = {}
    type_counts: Counter[str] = Counter()
    skipped = 0
    total = 0

    for page_index in range(doc.page_count):
        page = doc[page_index]
        page_num = page_index + 1
        page_links: list[dict] = []

        for seq, link in enumerate(page.get_links(), start=1):
            link_type = link.get("kind")
            rect = link.get("from")
            if not rect:
                skipped += 1
                continue

            norm = normalize_rect(fitz.Rect(rect), page)
            if norm["w"] <= 0 or norm["h"] <= 0:
                skipped += 1
                continue

            entry: dict = {
                "id": f"link-p{page_num:04d}-{seq:03d}",
                "rect": norm,
                "xref": link.get("xref"),
                "source": "pdf-annotation",
            }

            if link_type == LINK_URI:
                uri = (link.get("uri") or "").strip()
                if not uri:
                    skipped += 1
                    continue
                entry["type"] = "uri"
                entry["uri"] = uri
                type_counts["uri"] += 1
            elif link_type in (LINK_GOTO, LINK_NAMED):
                target = resolve_internal_target(link, doc)
                if not target:
                    skipped += 1
                    continue
                entry["type"] = "internal"
                entry["targetPage"] = target
                type_counts["internal"] += 1
            else:
                skipped += 1
                continue

            page_links.append(entry)
            total += 1

        if page_links:
            pages[str(page_num)] = page_links

    summary = {
        "totalLinks": total,
        "uriLinks": type_counts["uri"],
        "internalLinks": type_counts["internal"],
        "pagesWithLinks": len(pages),
        "skipped": skipped,
        "pageCount": doc.page_count,
    }
    return pages, summary


def top_pages_by_link_count(pages: dict[str, list[dict]], limit: int = 10) -> list[tuple[int, int]]:
    ranked = sorted(((int(k), len(v)) for k, v in pages.items()), key=lambda item: (-item[1], item[0]))
    return ranked[:limit]


def sample_uris(pages: dict[str, list[dict]], limit: int = 12) -> list[str]:
    samples: list[str] = []
    for links in pages.values():
        for link in links:
            if link.get("type") == "uri" and link.get("uri"):
                samples.append(link["uri"])
                if len(samples) >= limit:
                    return samples
    return samples


def write_report(summary: dict, pages: dict[str, list[dict]]) -> None:
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    top_pages = top_pages_by_link_count(pages)
    uris = sample_uris(pages)

    lines = [
        "# Link extraction report",
        "",
        f"Generated: {generated}",
        "",
        "## Summary",
        "",
        f"- Total links extracted: **{summary['totalLinks']}**",
        f"- URI (external) links: **{summary['uriLinks']}**",
        f"- Internal page links: **{summary['internalLinks']}**",
        f"- Pages with at least one link: **{summary['pagesWithLinks']}** / {summary['pageCount']}",
        f"- Skipped annotations: **{summary['skipped']}**",
        "",
        "## Pages with most links",
        "",
    ]

    if top_pages:
        for page_num, count in top_pages:
            lines.append(f"- Page {page_num}: {count} links")
    else:
        lines.append("- None")

    lines.extend(["", "## Sample external URIs", ""])
    if uris:
        for uri in uris:
            lines.append(f"- `{uri}`")
    else:
        lines.append("- None")

    lines.extend(
        [
            "",
            "## Proofreading notes",
            "",
            "- Links are extracted automatically from PDF annotations; positions use normalized rects relative to each page.",
            "- Open the viewer with `?debugLinks=1` to show translucent hotspot boxes for visual proofing.",
            "- External links open in a new tab; internal links jump to the target page in the viewer.",
            "",
        ]
    )

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    if not PDF_PATH.exists():
        print(f"ERROR: Source PDF not found: {PDF_PATH}", file=sys.stderr)
        return 1

    doc = fitz.open(PDF_PATH)
    pages, summary = extract_links(doc)
    doc.close()

    payload = {
        "document": {
            "title": "AWC Publications",
            "source": SOURCE_FILENAME,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        },
        "summary": summary,
        "pages": pages,
    }

    LINKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LINKS_PATH.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    write_report(summary, pages)

    print(f"Wrote {LINKS_PATH}")
    print(f"Wrote {REPORT_PATH}")
    print(
        f"Links: {summary['totalLinks']} total "
        f"({summary['uriLinks']} URI, {summary['internalLinks']} internal) "
        f"on {summary['pagesWithLinks']} pages"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
