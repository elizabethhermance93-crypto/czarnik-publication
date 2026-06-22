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
├── data/
│   ├── outline.json        # Table of contents (bookmarks)
│   └── page-manifest.json  # Page image index
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

Writes `data/outline.json` from PDF bookmarks via PyMuPDF `get_toc()`.

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

Writes `data/page-manifest.json` with image paths and dimensions.

### 7. Run QA checks

```bash
python scripts/qa_check.py
```

Prints PASS / WARN / FAIL for PDF, outline counts, parent start pages, and rendered files.

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

Upload `index.html`, `assets/`, `data/`, `pages/`, `thumbs/`, and `robots.txt`. Do **not** upload `source/`.

`robots.txt` disallows crawlers from `/source/`, `/pages/`, `/thumbs/`, and `/data/`. This is not access control — it only guides well-behaved crawlers.

---

## Security notes

- The source PDF must not be in the public web root.
- Right-click on the page image is disabled in JS as a weak deterrent only.
- Users can still save images or reconstruct content; the goal is to avoid easy full-PDF download.

---

## SCSS

`assets/css/styles.scss` is the editable source. `assets/css/styles.css` is what `index.html` loads. If you edit SCSS, recompile manually or edit `styles.css` directly.

---

## License

Client project — see client agreement for terms.
