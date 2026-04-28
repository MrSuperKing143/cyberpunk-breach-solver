# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Session Setup

When starting work on this Next.js project, ALWAYS call the `init` tool from next-devtools-mcp FIRST to set up proper context and establish documentation requirements. Do this automatically without being asked.

## Commands

```bash
npm run dev        # start dev server at http://localhost:3000
npm run build      # static export to out/
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
```

There are no tests. Verification is `npm run lint && npm run typecheck && npm run build`.

## Architecture

Pure client-side static-export Next.js 16 app (`output: "export"` in `next.config.ts`). No server routes, no API. Everything runs in the browser.

**Data flow:**

1. User uploads a screenshot or picks a demo sample (`lib/sample-gallery.ts` maps filenames in `sample-images/` to gallery entries)
2. `BreachProtocolApp` (`components/breach-protocol-app.tsx`) orchestrates all state — preview, analysis result, editable puzzle, solver result
3. "Analyze Screenshot" calls `analyzeBreachImage` (`lib/analysis/extract.ts`) which:
   - Lazy-loads OpenCV.js via `lib/analysis/opencv.ts`
   - Downsamples input to ≤1920px, builds a Canny edge mask, then locates each panel by finding the smallest contour containing a per-panel fractional anchor point (`panelAnchorPoints` in `extract.ts`)
   - Trims frame borders via `trimEdgeNoise`, then finds grid lines via column/row projection sums (`matColSums`/`matRowSums` → `findPeaks` → `groupPeaks` → `centersToBounds`)
   - Crops each cell, builds a neon-hue HSV + brightness binary mask, upscales 5×, and OCRs via Tesseract.js (`lib/analysis/ocr.ts`)
   - Fuzzy-maps raw OCR text onto the six allowed codes: `1C 55 7A BD E9 FF`
4. Result populates an `EditablePuzzle` that the user can correct in `PuzzleEditor`
5. "Solve Best Path" calls `solveBreachPuzzle` (`lib/solver/breach-solver.ts`) — pure synchronous DFS that enforces alternating row/column traversal and scores by completed sequences, then partial tokens, then spare buffer

**Key types** (`lib/types/breach.ts`): `EditablePuzzle`, `AnalysisResult`, `SolverResult`, `BreachCode` (the six-value union), `DebugToken`.

**Panel detection tuning** lives in `extract.ts`: `panelAnchorPoints` maps each panel key (`matrix`, `sequence`, `buffer`) to a fractional `[x, y]` coordinate within the expected panel region. If the buffer contour is not found, `estimateBufferRect` derives it geometrically from the matrix and sequence rects. These constants were tuned against the screenshots in `sample-images/`.

**Styling**: SCSS modules per component under `styles/`, global styles in `styles/globals.scss`. Uses a custom cyberpunk font from `public/fonts/`.

**OpenCV.js** is bundled at `public/vendor/opencv.js` (client-side only; loaded lazily on first analysis call). Tesseract.js fetches language data from its CDN on first run unless already browser-cached.
