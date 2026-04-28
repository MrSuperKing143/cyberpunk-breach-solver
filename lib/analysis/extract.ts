/* eslint-disable @typescript-eslint/no-explicit-any */
import { recognizeCodeToken } from "@/lib/analysis/ocr";
import { loadOpenCv, safeDelete } from "@/lib/analysis/opencv";
import {
  type AnalysisResult,
  type CodeValue,
  type DebugToken,
  type EditablePuzzle,
  type Rect,
  createEmptyPuzzle,
} from "@/lib/types/breach";

type PanelKey = "matrix" | "sequence" | "buffer";

interface PanelRects {
  matrix?: Rect;
  sequence?: Rect;
  buffer?: Rect;
}


// Fractional [x, y] anchor points within each panel's content area.
// The detection finds the smallest contour that contains the anchor point.
const panelAnchorPoints: Record<PanelKey, [number, number]> = {
  matrix:   [0.25, 0.40],
  sequence: [0.55, 0.35],
  buffer:   [0.50, 0.20],
};

function loadImage(src: string, name?: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image${name ? `: ${name}` : ""}.`));
    image.src = src;
  });
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function integerRect(rect: Rect): Rect {
  return {
    x: Math.max(Math.round(rect.x), 0),
    y: Math.max(Math.round(rect.y), 0),
    width: Math.max(Math.round(rect.width), 1),
    height: Math.max(Math.round(rect.height), 1),
  };
}

function toRect(rect: { x: number; y: number; width: number; height: number }): Rect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function unionRect(left: Rect, right: Rect): Rect {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);

  return {
    x,
    y,
    width: maxX - x,
    height: maxY - y,
  };
}

// ---------------------------------------------------------------------------
// Projection-based grid helpers
// ---------------------------------------------------------------------------

function matColSums(mat: any): number[] {
  const { rows, cols } = mat;
  const data = mat.data as Uint8Array;
  const sums = new Array<number>(cols).fill(0);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) sums[c] += data[r * cols + c];
  return sums;
}

function matRowSums(mat: any): number[] {
  const { rows, cols } = mat;
  const data = mat.data as Uint8Array;
  const sums = new Array<number>(rows).fill(0);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) sums[r] += data[r * cols + c];
  return sums;
}

function findPeaks(projection: number[], thresholdRatio = 0.5): number[] {
  const threshold = Math.max(...projection) * thresholdRatio;
  return projection.reduce<number[]>((acc, v, i) => { if (v > threshold) acc.push(i); return acc; }, []);
}

function groupPeaks(peaks: number[], minGap = 5): number[] {
  if (peaks.length === 0) return [];
  const groups: number[] = [];
  let current = [peaks[0]];
  for (const p of peaks.slice(1)) {
    if (p - current[current.length - 1] <= minGap) current.push(p);
    else { groups.push(Math.floor(current.reduce((a, b) => a + b, 0) / current.length)); current = [p]; }
  }
  groups.push(Math.floor(current.reduce((a, b) => a + b, 0) / current.length));
  return groups;
}

function centersToBounds(centers: number[], maxVal: number): number[] {
  if (centers.length < 2) return [0, maxVal];
  const bounds = [Math.max(0, centers[0] - Math.floor((centers[1] - centers[0]) / 2))];
  for (let i = 0; i < centers.length - 1; i++) bounds.push(Math.floor((centers[i] + centers[i + 1]) / 2));
  bounds.push(Math.min(maxVal, centers[centers.length - 1] + Math.floor((centers[centers.length - 1] - centers[centers.length - 2]) / 2)));
  return bounds;
}

// Trim rows/cols where Canny edge density exceeds 2× the median — removes frame borders.
function trimEdgeNoise(cv: any, source: any, rect: Rect, maxInset = 20): Rect {
  const crop = source.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  try {
    cv.cvtColor(crop, gray, cv.COLOR_RGBA2GRAY);
    cv.Canny(gray, edges, 50, 150);
    const { rows, cols } = edges;
    const rowSums = matRowSums(edges);
    const colSums = matColSums(edges);
    const rowMedian = [...rowSums].sort((a, b) => a - b)[Math.floor(rows / 2)];
    const colMedian = [...colSums].sort((a, b) => a - b)[Math.floor(cols / 2)];
    const rowThreshold = rowMedian * 2;
    const colThreshold = colMedian * 2;
    let top = 0;       while (top < maxInset          && rowSums[top]        > rowThreshold) top++;
    let bottom = rows; while (bottom > rows - maxInset && rowSums[bottom - 1] > rowThreshold) bottom--;
    let left = 0;      while (left < maxInset          && colSums[left]       > colThreshold) left++;
    let right = cols;  while (right > cols - maxInset  && colSums[right - 1]  > colThreshold) right--;
    return integerRect({ x: rect.x + left, y: rect.y + top, width: right - left, height: bottom - top });
  } finally {
    safeDelete(crop, gray, edges);
  }
}

// Gaussian blur → Canny → 5-iteration dilation; caller must delete the returned Mat.
function preprocessEdgesForGrid(cv: any, source: any, rect: Rect): any {
  const crop = source.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const edges = new cv.Mat();
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  const dilated = new cv.Mat();
  try {
    cv.cvtColor(crop, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0);
    cv.Canny(blur, edges, 50, 150);
    cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), 5);
    safeDelete(crop, gray, blur, edges, kernel);
    return dilated;
  } catch (error) {
    safeDelete(crop, gray, blur, edges, kernel, dilated);
    throw error;
  }
}

// Scan colSums for the first wide (≥15 col) near-zero valley past the left 20% — the gap
// between hex-code cells and daemon descriptions.
function findSequenceContentWidth(colSums: number[], totalWidth: number): number {
  const valleyThreshold = Math.max(...colSums) * 0.05;
  let gapStart: number | null = null;
  for (let x = Math.floor(totalWidth / 5); x < totalWidth; x++) {
    if (colSums[x] <= valleyThreshold) {
      if (gapStart === null) gapStart = x;
      else if (x - gapStart >= 15) return gapStart;
    } else {
      gapStart = null;
    }
  }
  return totalWidth;
}

function buildEdgeMask(cv: any, source: any): any {
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const edges = new cv.Mat();

  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0);
    cv.Canny(blur, edges, 30, 120);
    safeDelete(gray, blur);
    return edges;
  } catch (error) {
    safeDelete(gray, blur, edges);
    throw error;
  }
}

function findPanelByAnchor(
  cv: any,
  edges: any,
  key: PanelKey,
  width: number,
  height: number,
): Rect | undefined {
  const [fx, fy] = panelAnchorPoints[key];
  const px = fx * width;
  const py = fy * height;
  const imgArea = width * height;

  // findContours modifies the source image, so work on a copy.
  const edgesCopy = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let result: Rect | undefined;

  try {
    edges.copyTo(edgesCopy);
    cv.findContours(edgesCopy, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    let bestArea = Infinity;

    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i);
      const approx = new cv.Mat();
      try {
        const r = cv.boundingRect(contour);
        const area = r.width * r.height;

        if (area < 10000 || area > imgArea * 0.5) continue;

        cv.approxPolyDP(contour, approx, 0.02 * cv.arcLength(contour, true), true);
        if (approx.rows < 4) continue;

        if (cv.pointPolygonTest(contour, { x: px, y: py }, false) < 0) continue;

        if (area < bestArea) {
          bestArea = area;
          result = integerRect({ x: r.x, y: r.y, width: r.width, height: r.height });
        }
      } finally {
        contour.delete();
        approx.delete();
      }
    }

    if (result) {
      console.log(`[panel:${key}] detected`, JSON.stringify(result), `img=${width}x${height}`);
    } else {
      console.warn(`[panel:${key}] no containing contour for anchor (${Math.round(px)}, ${Math.round(py)})`);
    }
  } finally {
    safeDelete(edgesCopy, contours, hierarchy);
  }

  return result;
}

function estimateBufferRect(panels: PanelRects, width: number) {
  if (!panels.matrix || !panels.sequence) {
    return undefined;
  }

  const frame = unionRect(panels.matrix, panels.sequence);
  return integerRect({
    x: frame.x + frame.width * 0.42,
    y: Math.max(frame.y - frame.height * 0.22, 0),
    width: Math.min(frame.width * 0.19, width * 0.26),
    height: frame.height * 0.16,
  });
}

function buildTextMask(cv: any, source: any) {
  const rgb = new cv.Mat();
  const hsv = new cv.Mat();
  const gray = new cv.Mat();
  const hueMask = new cv.Mat();
  const brightnessMask = new cv.Mat();
  const combined = new cv.Mat();
  const kernel = cv.Mat.ones(2, 2, cv.CV_8U);
  let hueLower: any = null;
  let hueUpper: any = null;

  try {
    cv.cvtColor(source, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
    hueLower = cv.matFromArray(1, 1, hsv.type(), [15, 18, 110]);
    hueUpper = cv.matFromArray(1, 1, hsv.type(), [68, 255, 255]);
    cv.inRange(hsv, hueLower, hueUpper, hueMask);
    cv.threshold(gray, brightnessMask, 135, 255, cv.THRESH_BINARY);
    cv.bitwise_or(hueMask, brightnessMask, combined);
    cv.morphologyEx(combined, combined, cv.MORPH_OPEN, kernel);
    safeDelete(rgb, hsv, gray, hueMask, brightnessMask, kernel, hueLower, hueUpper);
    return combined;
  } catch (error) {
    safeDelete(rgb, hsv, gray, hueMask, brightnessMask, combined, kernel, hueLower, hueUpper);
    throw error;
  }
}

function absoluteBufferSlots(rects: Rect[], panelRect: Rect) {
  return rects.map((rect) => integerRect({
    x: panelRect.x + rect.x,
    y: panelRect.y + rect.y,
    width: rect.width,
    height: rect.height,
  }));
}

function detectBufferSlots(cv: any, source: any, rect: Rect) {
  const crop = source.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
  const { rows: bufH, cols: bufW } = crop;
  const bufArea = bufH * bufW;
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const dilated = new cv.Mat();
  const processed = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);

  try {
    cv.cvtColor(crop, gray, cv.COLOR_RGBA2GRAY);
    cv.Canny(gray, edges, 30, 150);
    cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), 3);
    cv.morphologyEx(dilated, processed, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);
    cv.findContours(processed, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const boxes: Rect[] = [];
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      try {
        const r = cv.boundingRect(contour);
        const area = r.width * r.height;
        const aspect = r.height > 0 ? r.width / r.height : 0;
        if (aspect > 0.5 && aspect < 2.5 && area / bufArea > 0.005 && area / bufArea < 0.5)
          boxes.push(toRect(r));
      } finally {
        contour.delete();
      }
    }

    boxes.sort((a, b) => a.x - b.x);
    const merged: Rect[] = [];
    for (const box of boxes) {
      const prev = merged[merged.length - 1];
      if (!prev || box.x > prev.x + prev.width * 0.5) merged.push(box);
    }

    return absoluteBufferSlots(merged, rect);
  } finally {
    safeDelete(crop, gray, edges, dilated, processed, contours, hierarchy, kernel);
  }
}

function cropForOcr(cv: any, source: any, rect: Rect) {
  const paddedRect = {
    x: Math.max(Math.floor(rect.x - 4), 0),
    y: Math.max(Math.floor(rect.y - 4), 0),
    width: Math.min(Math.ceil(rect.width + 8), source.cols - Math.max(Math.floor(rect.x - 4), 0)),
    height: Math.min(
      Math.ceil(rect.height + 8),
      source.rows - Math.max(Math.floor(rect.y - 4), 0),
    ),
  };
  const crop = source.roi(
    new cv.Rect(paddedRect.x, paddedRect.y, paddedRect.width, paddedRect.height),
  );
  const mask = buildTextMask(cv, crop);
  const dilated = new cv.Mat();
  const resized = new cv.Mat();
  const inverted = new cv.Mat();
  const kernel = cv.Mat.ones(2, 2, cv.CV_8U);

  try {
    cv.dilate(mask, dilated, kernel);
    cv.resize(
      dilated,
      resized,
      new cv.Size(Math.max(dilated.cols * 5, 72), Math.max(dilated.rows * 5, 54)),
      0,
      0,
      cv.INTER_NEAREST,
    );
    cv.bitwise_not(resized, inverted);

    const canvas = createCanvas(inverted.cols, inverted.rows);
    cv.imshow(canvas, inverted);
    return canvas;
  } finally {
    safeDelete(crop, mask, dilated, resized, inverted, kernel);
  }
}

function emptyMatrix(rows: number, cols: number) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => "" as CodeValue));
}

async function extractMatrix(
  cv: any,
  source: any,
  panelRect: Rect,
): Promise<{ matrix: CodeValue[][]; debugTokens: DebugToken[]; warnings: string[] }> {
  const warnings: string[] = [];
  const contentRect = trimEdgeNoise(cv, source, panelRect);
  const edgeMat = preprocessEdgesForGrid(cv, source, contentRect);

  const colCenters = groupPeaks(findPeaks(matColSums(edgeMat)));
  const rowCenters = groupPeaks(findPeaks(matRowSums(edgeMat)));
  const { rows: edgeH, cols: edgeW } = edgeMat;
  safeDelete(edgeMat);

  console.log(`[matrix] grid: ${rowCenters.length}r × ${colCenters.length}c`,
    'rows:', rowCenters.join(','), 'cols:', colCenters.join(','));

  if (colCenters.length === 0 || rowCenters.length === 0) {
    warnings.push("Could not detect grid in code matrix.");
    return { matrix: createEmptyPuzzle(6).matrix, debugTokens: [], warnings };
  }

  const colBounds = centersToBounds(colCenters, edgeW);
  const rowBounds = centersToBounds(rowCenters, edgeH);
  const nRows = rowBounds.length - 1;
  const nCols = colBounds.length - 1;
  const matrix = emptyMatrix(nRows, nCols);
  const debugTokens: DebugToken[] = [];

  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const cellRect = integerRect({
        x: contentRect.x + colBounds[c],
        y: contentRect.y + rowBounds[r],
        width: colBounds[c + 1] - colBounds[c],
        height: rowBounds[r + 1] - rowBounds[r],
      });
      const canvas = cropForOcr(cv, source, cellRect);
      const token = await recognizeCodeToken(canvas);
      matrix[r][c] = token.value;
      debugTokens.push({
        row: r,
        col: c,
        rect: cellRect,
        center: { x: cellRect.x + cellRect.width / 2, y: cellRect.y + cellRect.height / 2 },
        rawText: token.rawText,
        value: token.value,
        confidence: token.confidence,
      });
    }
  }

  if (nRows < 4 || nRows > 8 || nCols < 4 || nCols > 8) {
    warnings.push("Matrix grid size looks unusual. Review the extracted cells before solving.");
  }

  return { matrix, debugTokens, warnings };
}

async function extractSequences(
  cv: any,
  source: any,
  panelRect: Rect,
): Promise<{ sequences: CodeValue[][]; debugTokens: DebugToken[]; warnings: string[] }> {
  const warnings: string[] = [];
  const trimmedRect = trimEdgeNoise(cv, source, panelRect);
  const edgeFull = preprocessEdgesForGrid(cv, source, trimmedRect);

  // Clip right side to exclude daemon description column.
  const contentWidth = findSequenceContentWidth(matColSums(edgeFull), edgeFull.cols);
  const edgeView = edgeFull.roi(new cv.Rect(0, 0, contentWidth, edgeFull.rows));
  const edgeContent = new cv.Mat();
  edgeView.copyTo(edgeContent);
  safeDelete(edgeView, edgeFull);

  const contentRect: Rect = integerRect({
    x: trimmedRect.x,
    y: trimmedRect.y,
    width: contentWidth,
    height: trimmedRect.height,
  });

  const rowCenters = groupPeaks(findPeaks(matRowSums(edgeContent)));
  console.log(`[sequence] rows: ${rowCenters.length}`, rowCenters.join(','));

  if (rowCenters.length === 0) {
    safeDelete(edgeContent);
    warnings.push("Could not detect any sequence rows.");
    return { sequences: createEmptyPuzzle(6).sequences, debugTokens: [], warnings };
  }

  const rowBounds = centersToBounds(rowCenters, edgeContent.rows);
  const nRows = rowBounds.length - 1;
  const sequences: CodeValue[][] = Array.from({ length: nRows }, () => []);
  const debugTokens: DebugToken[] = [];

  for (let r = 0; r < nRows; r++) {
    // Column projection on this row's slice to find individual token boundaries.
    const rowSlice = edgeContent.roi(new cv.Rect(0, rowBounds[r], contentWidth, rowBounds[r + 1] - rowBounds[r]));
    const colCenters = groupPeaks(findPeaks(matColSums(rowSlice)));
    rowSlice.delete();

    if (colCenters.length === 0) continue;
    const colBounds = centersToBounds(colCenters, contentWidth);

    for (let c = 0; c < colBounds.length - 1; c++) {
      const cellRect = integerRect({
        x: contentRect.x + colBounds[c],
        y: contentRect.y + rowBounds[r],
        width: colBounds[c + 1] - colBounds[c],
        height: rowBounds[r + 1] - rowBounds[r],
      });
      const canvas = cropForOcr(cv, source, cellRect);
      const token = await recognizeCodeToken(canvas);
      sequences[r].push(token.value);
      debugTokens.push({
        row: r,
        col: c,
        rect: cellRect,
        center: { x: cellRect.x + cellRect.width / 2, y: cellRect.y + cellRect.height / 2 },
        rawText: token.rawText,
        value: token.value,
        confidence: token.confidence,
      });
    }
  }

  safeDelete(edgeContent);

  if (sequences.some((row) => row.length === 0)) {
    warnings.push("One or more sequences looked incomplete.");
  }

  return { sequences, debugTokens, warnings };
}

export async function analyzeBreachImage({
  src,
  name,
  onProgress,
}: {
  src: string;
  name?: string;
  onProgress?: (message: string) => void;
}): Promise<AnalysisResult> {
  onProgress?.("Loading image");
  const [cv, image] = await Promise.all([loadOpenCv(), loadImage(src, name)]);

  // Downsample to at most 1920px on the longest side so that all detection
  // parameters, which were tuned at 1080p, remain valid at higher resolutions.
  const maxDim = 1920;
  const srcLong = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = srcLong > maxDim ? maxDim / srcLong : 1;
  const processWidth = Math.round(image.naturalWidth * scale);
  const processHeight = Math.round(image.naturalHeight * scale);

  const canvas = createCanvas(processWidth, processHeight);
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context is not available in this browser.");
  }

  context.drawImage(image, 0, 0, processWidth, processHeight);

  onProgress?.("Detecting puzzle panels");
  const source = cv.imread(canvas);
  const edges = buildEdgeMask(cv, source);

  const panels: PanelRects = {
    matrix: findPanelByAnchor(cv, edges, "matrix", source.cols, source.rows),
    sequence: findPanelByAnchor(cv, edges, "sequence", source.cols, source.rows),
    buffer: findPanelByAnchor(cv, edges, "buffer", source.cols, source.rows),
  };

  if (!panels.buffer) {
    panels.buffer = estimateBufferRect(panels, source.cols);
  }

  const warnings: string[] = [];
  const debug = {
    panels,
    matrixTokens: [] as DebugToken[],
    sequenceTokens: [] as DebugToken[],
    bufferSlots: [] as Rect[],
  };

  try {
    const puzzle: EditablePuzzle = createEmptyPuzzle(6);

    if (panels.buffer) {
      onProgress?.("Counting buffer slots");
      const slots = detectBufferSlots(cv, source, panels.buffer);
      debug.bufferSlots = slots;
      puzzle.bufferSize = slots.length > 0 ? slots.length : null;

      if (slots.length === 0) {
        warnings.push("Buffer slots were not detected confidently.");
      }
    } else {
      warnings.push("Buffer panel was not detected.");
    }

    if (panels.matrix) {
      onProgress?.("Extracting matrix codes");
      const matrixResult = await extractMatrix(cv, source, panels.matrix);
      puzzle.matrix = matrixResult.matrix;
      debug.matrixTokens = matrixResult.debugTokens;
      warnings.push(...matrixResult.warnings);
    } else {
      warnings.push("Code matrix panel was not detected.");
    }

    if (panels.sequence) {
      onProgress?.("Extracting daemon sequences");
      const sequenceResult = await extractSequences(cv, source, panels.sequence);
      puzzle.sequences = sequenceResult.sequences;
      debug.sequenceTokens = sequenceResult.debugTokens;
      warnings.push(...sequenceResult.warnings);
    } else {
      warnings.push("Sequence panel was not detected.");
    }

    const confidences = [
      ...debug.matrixTokens.map((token) => token.confidence),
      ...debug.sequenceTokens.map((token) => token.confidence),
      ...(puzzle.bufferSize ? [0.92] : []),
    ];
    const confidence =
      confidences.length > 0
        ? confidences.reduce((total, value) => total + value, 0) / confidences.length
        : 0;

    return {
      image: {
        src,
        width: processWidth,
        height: processHeight,
        name,
      },
      puzzle,
      debug,
      warnings,
      confidence,
    };
  } finally {
    safeDelete(source, edges);
  }
}
