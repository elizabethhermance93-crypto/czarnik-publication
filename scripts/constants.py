"""Shared constants for the publication viewer build pipeline."""

from __future__ import annotations

SOURCE_FILENAME = "AWC_Publications_v17_bookmarked_citation_outline.pdf"
DOCUMENT_TITLE = "AWC Publications"

EXPECTED_PARENT_COUNT = 13
EXPECTED_CHILD_COUNT = 178
EXPECTED_TOTAL_COUNT = 191

EXPECTED_PARENT_PAGES = [1, 49, 116, 156, 165, 214, 304, 456, 507, 658, 666, 708, 910]

QA_PAGES = [1, 49, 116, 156, 165, 214, 304, 456, 507, 658, 666, 708, 910]

IMAGE_EXTENSIONS = ("webp", "png", "jpg", "jpeg")

# Public web folder for JSON (avoid "data/" — blocked on some hosts)
PUBLIC_DATA_DIR = "viewer-data"
LINKS_FILENAME = "links.json"
AUTHOR_INDEX_FILENAME = "author-index.json"
AUTHOR_INDEX_XLSX = "AWC_Pubs_1053_TitleAuthor_Pages_v1_2026-07-07.xlsx"
AUTHOR_INDEX_SHEET = "TitleAuthorPages"
