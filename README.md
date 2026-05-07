# Cyberpunk 2077 Breach Protocol Solver

> **Disclaimer**: Most of this project was generated using AI, with minor human review and adjustments.

Static-export Next.js 16 app for analyzing Cyberpunk 2077 Breach Protocol screenshots fully in the browser. The app can:

- upload or drag-drop a screenshot (auto-analyzed on load)
- use bundled demo samples from `sample-images/`
- detect the buffer size, code matrix, and daemon sequences via OpenCV.js
- let you correct any extracted values manually
- solve the best legal path using the actual row/column traversal rules

## Stack

- Next.js 16 + App Router + TypeScript + React 19 compiler
- static export only via `output: "export"`
- SCSS modules per component under [`styles/`](styles/), global styles in [`styles/globals.scss`](styles/globals.scss)
- OpenCV.js bundled at [`public/vendor/opencv.js`](public/vendor/opencv.js) (loaded lazily client-side)
- Tesseract.js for browser OCR on segmented code tokens

## Install

```bash
npm install
```

## Run Dev

```bash
npm run dev
```

Open `http://localhost:3000`.

## Build / Export

```bash
npm run build
```

Because `next.config.ts` uses `output: "export"`, `next build` emits a static export in `out/`.

Optional checks:

```bash
npm run lint
npm run typecheck
```

## Routes

| Route | Purpose |
|---|---|
| `/` | Main app — upload, analyze, edit, solve |
| `/debug` | Visualises panel detection overlays and OCR tokens for a single screenshot |
| `/ground-truth` | Batch labeling tool for generating Tesseract training data (exports PNG + `.gt.txt` pairs as a ZIP) |

## How The Extraction Pipeline Works

The browser analysis flow is implemented in [`lib/analysis/`](lib/analysis/):

1. Downsample the input screenshot to ≤ 1920 px and build a Canny edge mask.
2. Locate each panel (`matrix`, `sequence`, `buffer`) by finding the smallest contour containing a per-panel fractional anchor point (`panelAnchorPoints` in `extract.ts`). If the buffer contour is not found, `estimateBufferRect` derives it geometrically from the other two rects.
3. Trim frame borders via `trimEdgeNoise`, then find grid lines using column/row projection sums (`matColSums` / `matRowSums` → `findPeaks` → `groupPeaks` → `centersToBounds`).
4. Crop each cell, build a neon-hue HSV + brightness binary mask, upscale 5×, and OCR via Tesseract.js.
5. Fuzzy-map raw OCR text onto the six allowed codes: `1C 55 7A BD E9 FF`.

Low-level OpenCV operations live in [`lib/analysis/extract-core.ts`](lib/analysis/extract-core.ts); OCR helpers live in [`lib/analysis/ocr.ts`](lib/analysis/ocr.ts).

The UI always exposes the extracted puzzle as editable controls so failed or low-confidence tokens can be corrected before solving.

## Solver Logic

The solver lives in [`lib/solver/breach-solver.ts`](lib/solver/breach-solver.ts) and delegates internally to:

- [`bruter.ts`](lib/solver/bruter.ts) — DFS path exploration engine
- [`sequence-optimizer.ts`](lib/solver/sequence-optimizer.ts) — partial/full sequence matching
- [`tree.ts`](lib/solver/tree.ts) — path-tracking tree

Rules enforced:

- start in the first matrix row
- then alternate vertical and horizontal picks
- cannot reuse the same cell twice
- path length cannot exceed buffer size

Scoring priority:

1. more completed sequences
2. more completed sequence tokens overall
3. stronger partial progress when no better full solution exists
4. more spare buffer for ties

## Project Structure

```text
app/
  layout.tsx
  page.tsx
  debug/page.tsx
  ground-truth/page.tsx
components/
  breach-protocol-app.tsx   # top-level state orchestrator
  image-workbench.tsx
  puzzle-editor.tsx
  solver-results.tsx
  debug-page.tsx
  ground-truth-page.tsx
lib/
  analysis/
    extract.ts              # main pipeline + panelAnchorPoints
    extract-core.ts         # low-level OpenCV helpers
    opencv.ts               # lazy OpenCV.js loader
    ocr.ts                  # Tesseract.js helpers
  solver/
    breach-solver.ts
    bruter.ts
    sequence-optimizer.ts
    tree.ts
  types/breach.ts           # EditablePuzzle, AnalysisResult, SolverResult, BreachCode, DebugToken
  sample-gallery.ts         # maps sample-images/ filenames to gallery entries
styles/
  globals.scss
  *.module.scss
public/
  fonts/
  vendor/opencv.js
sample-images/
  sample screenshots used for tuning and demo selection
```

## Tuning Notes

- Panel anchor points (`panelAnchorPoints` in `extract.ts`) are fractional `[x, y]` coordinates tuned against the screenshots in `sample-images/`.
- The `/debug` route is useful for inspecting detected contours, grid lines, and per-cell OCR confidence on a single image.
- Matrix extraction groups token blobs into row and column clusters via projection sums instead of relying on fixed pixel coordinates.
- Sequence extraction only reads the left token column of the daemon panel and ignores the reward text on the right.

## Generating Tesseract Training Data

The `/ground-truth` route is a batch labeling tool:

1. Drop one or more breach screenshots onto the upload zone.
2. Click **Analyze All** — each image runs through the full extraction pipeline.
3. For every extracted cell token, press **1–6** to assign a code label (`1C` `55` `7A` `BD` `E9` `FF`) or **S** to skip invalid/blank cells. Arrow keys navigate without labeling.
4. Click **Export ZIP** when done.

The ZIP contains a `ground_truth/` folder with `<stem>.png` + `<stem>.gt.txt` pairs in the format expected by Tesseract's training tools, and a `skipped/` folder with PNG-only files.

## Limitations

- Very dark captures, heavy motion blur, or aggressive JPEG artifacts can still produce OCR mistakes.
- Partial crops work best when the full matrix and sequence panels are visible.
- Buffer size is inferred from the detected buffer panel; that field is the most likely manual correction when the top panel is dim or clipped.
- Tesseract.js may fetch OCR language data on the first recognition pass if it is not already cached by the browser.

## Verification

```bash
npm run lint && npm run typecheck && npm run build
```

The build completes as a static export and writes prerendered output to `out/`.
