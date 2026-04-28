# Cyberpunk 2077 Breach Protocol Solver

Static-export Next.js 16 app for analyzing Cyberpunk 2077 Breach Protocol screenshots fully in the browser. The app can:

- upload or drag-drop a screenshot
- use bundled demo samples from `sample-images/`
- detect the buffer size, code matrix, and daemon sequences
- let you correct any extracted values manually
- solve the best legal path using the actual row/column traversal rules

## Stack

- Next.js 16 + App Router + TypeScript
- static export only via `output: "export"`
- SCSS styles under [`styles/`](/styles)
- OpenCV.js loaded client-side from [`public/vendor/opencv.js`](/public/vendor/opencv.js)
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

## How The Extraction Pipeline Works

The browser analysis flow is implemented in [`lib/analysis/`](/lib/analysis):

1. Load the screenshot into a canvas and OpenCV mat.
2. Threshold the neon UI palette to isolate the Breach Protocol panels.
3. Detect the matrix, sequence, and buffer panels by contour size/aspect.
4. Normalize inner panel regions with padding tuned from the bundled samples.
5. Segment likely code tokens with OpenCV morphology and contour grouping.
6. OCR each token crop with a whitelist restricted to Cyberpunk breach codes.
7. Fuzzily map OCR output onto the allowed token set: `1C`, `55`, `7A`, `BD`, `E9`, `FF`.
8. Count buffer slots from the top panel outline shapes.
9. Return extracted puzzle data, confidence values, warnings, and debug overlays.

The UI always exposes the extracted puzzle as editable controls so failed or low-confidence tokens can be corrected before solving.

## Solver Logic

The solver lives separately in [`lib/solver/breach-solver.ts`](/lib/solver/breach-solver.ts).

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
components/
  breach-protocol-app.tsx
  image-workbench.tsx
  puzzle-editor.tsx
  solver-results.tsx
lib/
  analysis/
  solver/
  types/
  sample-gallery.ts
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

- The detector is tuned for the standard Breach Protocol layout: matrix on the left, daemon list on the right, buffer at the top.
- The sample gallery is built from the repo's `sample-images/` files so you can regression-test against the same screenshots used during implementation.
- Matrix extraction groups token blobs into row and column clusters instead of relying on fixed pixel coordinates.
- Sequence extraction only reads the left token column of the daemon panel and ignores the reward text on the right.

## Limitations

- Very dark captures, heavy motion blur, or aggressive JPEG artifacts can still produce OCR mistakes.
- Partial crops work best when the full matrix and sequence panels are visible.
- Buffer size is inferred from slot outlines, so that field is the most likely manual correction when the top panel is dim or clipped.
- Tesseract.js may fetch OCR language data on the first recognition pass if it is not already cached by the browser.

## Verification

Verified locally with:

- `npm run lint`
- `npm run typecheck`
- `npm run build`

The build completes as a static export and writes the prerendered output to `out/`.
