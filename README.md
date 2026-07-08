# Czarnik Publications Online Viewer

A professional, fast, single-page online publication viewer for large academic PDF compilations. Built as a static website using pre-rendered page images and a JSON-driven table of contents — not WordPress, not an embedded PDF.

**Document:** AWC Publications

---

## Why this approach?

| Approach | Limitation |
|----------|------------|
| **WordPress / Elementor** | Heavy CMS overhead, plugin dependencies, poor fit for a read-only archive viewer |
| **Embedded PDF / browser PDF viewer** | Slow navigation on large files, inconsistent mobile UX, easy full-document download |
| **This viewer** | Instant page jumps via images, polished reading UI, hierarchical bookmarks, no public PDF link |

Online content can never be made impossible to copy. This project avoids a one-click full PDF download and makes full-document copying less convenient. Individual page images may still be saved.

---

## Project structure

```
czarnik-publications-viewer/
├── index.html              # Main viewer (single-page app)
├── robots.txt
├── README.md
├── assets/
│   ├── css/styles.css      # Used by the app
│   ├── css/styles.scss     # Editable SCSS source (optional)
│   └── js/app.js           # Viewer logic
├── viewer-data/            # Table of contents + page manifest (JSON)
│   ├── outline.json
│   └── page-manifest.json
├── pages/                  # Full-size page images (WebP)
├── thumbs/                 # Thumbnail images (WebP)
├── source/                 # Source PDF (local build only — NOT public)
│   └── AWC_Publications_v17_bookmarked_citation_outline.pdf
└── scripts/                # Python build tools
    ├── requirements.txt
    ├── inspect_pdf.py
    ├── extract_outline.py
    ├── render_pages.py
    ├── generate_manifest.py
    └── qa_check.py
```

---

## Prerequisites

- **Python 3.10+** (for build scripts only)
- **No Node.js / npm** required for the frontend
- A local HTTP server (Python's built-in server works)

---

## Setup

### 1. Place the source PDF

Copy the publication PDF to:

```
source/AWC_Publications_v17_bookmarked_citation_outline.pdf
```

**Do not** place the PDF in the public web root when deploying. The viewer never links to it.

### 2. Install Python dependencies

```bash
cd czarnik-publications-viewer
pip install -r scripts/requirements.txt
```

### 3. Inspect the PDF

Verify the file, page count, and bookmark structure:

```bash
python scripts/inspect_pdf.py
```

Expected outline (approximate):
- 13 parent sections
- 178 child publications
- 191 total outline entries

Page count is read from the actual PDF — do not hardcode.

### 4. Extract the outline

```bash
python scripts/extract_outline.py
```

Writes `viewer-data/outline.json` from PDF bookmarks via PyMuPDF `get_toc()`.

### 5. Render page images

Render QA pages first (recommended):

```bash
python scripts/render_pages.py --qa
```

Other options:

```bash
# Specific pages
python scripts/render_pages.py --pages 1,49,116

# All pages (large — run when ready)
python scripts/render_pages.py --all

# Optional quality settings
python scripts/render_pages.py --qa --dpi 170 --quality 88 --thumb-width 260
```

Outputs:
- `pages/page-0001.webp` — full pages (~170 DPI, quality 88)
- `thumbs/page-0001.webp` — thumbnails (~260px wide, quality 75)

If WebP save fails, the script falls back to PNG and reports a warning.

### 6. Generate the page manifest

```bash
python scripts/generate_manifest.py
```

Writes `viewer-data/page-manifest.json` with image paths and dimensions.

### 7. Run QA checks

```bash
python scripts/qa_check.py
```

Prints PASS / WARN / FAIL for PDF, outline counts, parent start pages, and rendered files.

---

## Phase 2: Full local build

Phase 2 turns the prototype into a working local viewer using the real PDF, full bookmark structure, rendered page images, thumbnails, and QA checks.

### Replace the source PDF

Place (or replace) the PDF at:

```
source/AWC_Publications_v17_bookmarked_citation_outline.pdf
```

Use the **same filename** when swapping in a corrected edition. All scripts read page count and bookmarks from the file at runtime — nothing is hardcoded.

After replacing the PDF, re-run the full pipeline below.

### Phase 2 build commands

From the project root:

```bash
pip install -r scripts/requirements.txt
python scripts/inspect_pdf.py
python scripts/extract_outline.py
python scripts/render_pages.py --qa
python scripts/generate_manifest.py
python scripts/qa_check.py
python -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000)

**What each step does:**

| Command | Output |
|---------|--------|
| `inspect_pdf.py` | QA report: file size, SHA-256, page count, metadata, bookmark counts, page sizes |
| `extract_outline.py` | `viewer-data/outline.json` — hierarchical TOC with 191 entries (13 sections + 178 publications) |
| `render_pages.py --qa` | 14 QA page images in `pages/` and `thumbs/` (section starts + final page) |
| `generate_manifest.py` | `viewer-data/page-manifest.json` — image paths and dimensions |
| `qa_check.py` | PASS / WARN / FAIL report for the full build |

### Render all pages (full build)

QA mode renders only bookmark start pages plus the final page. For the complete viewer experience:

```bash
python scripts/render_pages.py --all
python scripts/generate_manifest.py
python scripts/qa_check.py
```

**Time and disk:** Full rendering of ~1053 pages at 170 DPI produces hundreds of WebP files. Expect significant processing time and disk usage (often several GB). The script is safe to interrupt and resume — it skips existing files unless you pass `--force`.

**Useful render options:**

```bash
python scripts/render_pages.py --pages 1,49,116          # specific pages
python scripts/render_pages.py --qa                      # QA set + final page
python scripts/render_pages.py --all                     # every page
python scripts/render_pages.py --all --force             # re-render everything
python scripts/render_pages.py --qa --dpi 170 --quality 88 --thumb-width 260
```

Outputs:
- `pages/page-0001.webp` — full pages
- `thumbs/page-0001.webp` — thumbnails (~260px wide)

If WebP save fails, the script falls back to PNG and prints a warning.

### Security reminder

**Do not** place the source PDF in the public web root when deploying. The viewer uses pre-rendered images and JSON navigation only — it never links to or downloads the source PDF.

---

## Run locally

From the project root:

```bash
cd czarnik-publications-viewer
python -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000)

> **Note:** Serve from the project root so paths like `/pages/page-0001.webp` resolve correctly.

The app works before rendering: placeholder JSON is included, and missing images show a friendly message instead of crashing.

---

## Frontend features

- Dark navy toolbar with page navigation, zoom, and fit controls
- Right-side Table of Contents (desktop), Bootstrap offcanvas drawer (mobile)
- Optional left thumbnail rail (desktop, toggleable)
- Pre-rendered WebP page images with intelligent prefetch
- URL hash deep links (`#page=156`)
- No public PDF download button

---

## Deployment (later)

Recommended: static hosting + CDN for images.

| Component | Suggestion |
|-----------|------------|
| HTML / JS / CSS | Cloudflare Pages, Netlify, GitHub Pages, S3 static site |
| Page images | Cloudflare R2, S3, or CDN-backed object storage |
| Source PDF | Keep off the public web root entirely |

Upload `index.html`, `assets/`, `viewer-data/`, `pages/`, `thumbs/`, and `robots.txt`. Do **not** upload `source/`.

After running link extraction (Phase 4), include `viewer-data/links.json` in the deploy bundle.
After running author index extraction, include `viewer-data/author-index.json` as well.

**Important:** The JSON folder must be named `viewer-data/` on the server (not `data/` — some hosts block that path). Verify in your browser:

```
https://your-domain.com/viewer-data/outline.json
```

You should see raw JSON (HTTP 200). If you get 404, the folder was not uploaded to the web root.

`robots.txt` disallows crawlers from `/source/`, `/pages/`, `/thumbs/`, and `/viewer-data/`. This is not access control — it only guides well-behaved crawlers.

---

## Security notes

- The source PDF must not be in the public web root.
- Right-click on the page image is disabled in JS as a weak deterrent only.
- Users can still save images or reconstruct content; the goal is to avoid easy full-PDF download.

---

## Phase 4 — Links, navigation, and TOC polish

Phase 4 adds a favicon, section navigation shortcuts, clearer TOC hierarchy styling, and automated PDF link hotspots on page images.

### Favicon

`assets/img/favicon.svg` is linked from `index.html`. Upload `assets/img/` with the rest of the static assets.

### Section navigation

Toolbar buttons (desktop and mobile):

- **First Page** — jump to page 1
- **Section Top** — jump to the start of the current parent section
- **Next Section** — jump to the next parent section

### TOC hierarchy

Parent sections use `.toc-parent` / `.toc-section-title`; child entries use `.toc-child` / `.toc-member-title` with a **2rem** left indent.

### Link extraction

Links are extracted automatically from PDF annotations (no manual URL mapping):

```bash
python scripts/extract_links.py
```

Outputs:

- `viewer-data/links.json` — normalized hotspot rects per page
- `reports/link-report.md` — counts, sample URIs, proofreading notes

The viewer loads `links.json` gracefully; if it is missing, pages still render without hotspots.

### Link overlays and proofreading

External URI links open in a new tab. Internal links jump to the target page in the viewer. Hotspots reposition on zoom and window resize.

Proofreading mode (translucent blue boxes):

```bash
python -m http.server 8000
# http://localhost:8000?debugLinks=1
```

### Phase 4 QA

```bash
python scripts/extract_links.py
python scripts/qa_check.py
```

Deploy must include `viewer-data/links.json` after extraction.

---

## Author Search / Name Index

Former students and collaborators can search by author name or paper title and jump to the matching page.

### Source spreadsheet

Place the Excel file at one of:

- `resources/AWC_Pubs_1053_TitleAuthor_Pages_v1_2026-07-07.xlsx` (preferred)
- `resource/AWC_Pubs_1053_TitleAuthor_Pages_v1_2026-07-07.xlsx`
- `source/AWC_Pubs_1053_TitleAuthor_Pages_v1_2026-07-07.xlsx` (fallback)

Sheet: **TitleAuthorPages**

| Column | Header |
|--------|--------|
| A | Page |
| B | Names |
| C | Paper Title |

Names in column B are semicolon-separated (for example `Anthony W. Czarnik; Nelson J. Leonard`).

### Generate the index

```bash
python -m pip install -r scripts/requirements.txt
python scripts/extract_author_index.py
```

This writes `viewer-data/author-index.json` (same public data folder as `outline.json` / `links.json`).

### QA and local test

```bash
python scripts/qa_check.py
python -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000), then use **Search Authors / Papers** (toolbar input on large screens, person icon, or More → Author / paper search).

### Behavior notes

- Search matches author names, aliases (initials, last name, etc.), and paper titles.
- Results are paper-based; clicking a result jumps to that page with the existing viewer navigation.
- The spreadsheet and source PDF are not exposed publicly. Search does not modify page images or the PDF.
- Deploy must include `viewer-data/author-index.json` after extraction. If the file is missing, search shows “Author index not available yet” and the viewer still works.

---

## SCSS

`assets/css/styles.scss` is the editable source. `assets/css/styles.css` is what `index.html` loads. If you edit SCSS, recompile manually or edit `styles.css` directly.

---

## License

Client project — see client agreement for terms.
