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

interface TokenCandidate {
  rect: Rect;
  centerX: number;
  centerY: number;
}

interface GroupedRow {
  center: number;
  items: TokenCandidate[];
}

const panelPadding: Record<PanelKey, { top: number; right: number; bottom: number; left: number }> =
  {
    // New Canny-based detection returns the exact cell/row area, so minimal insets needed.
    matrix:   { top: 0.03, right: 0.05, bottom: 0.03, left: 0.05 },
    // right=0.68 keeps only the left ~30% of the panel — enough for 4-token sequences
    // while excluding the daemon description column that occupies the right ~65%.
    sequence: { top: 0.05, right: 0.68, bottom: 0.05, left: 0.02 },
    buffer:   { top: 0.22, right: 0.08, bottom: 0.18, left: 0.08 },
  };

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

function insetRect(rect: Rect, padding: { top: number; right: number; bottom: number; left: number }): Rect {
  return integerRect({
    x: rect.x + rect.width * padding.left,
    y: rect.y + rect.height * padding.top,
    width: rect.width * (1 - padding.left - padding.right),
    height: rect.height * (1 - padding.top - padding.bottom),
  });
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

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function dedupeRects(rects: Rect[], distance = 12) {
  const kept: Rect[] = [];

  for (const rect of rects) {
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;

    const duplicate = kept.some((item) => {
      const itemCenterX = item.x + item.width / 2;
      const itemCenterY = item.y + item.height / 2;
      return (
        Math.abs(centerX - itemCenterX) <= distance &&
        Math.abs(centerY - itemCenterY) <= distance
      );
    });

    if (!duplicate) {
      kept.push(rect);
    }
  }

  return kept;
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

function clusterByAxis(values: TokenCandidate[], axis: "centerX" | "centerY", tolerance: number) {
  const sorted = [...values].sort((left, right) => left[axis] - right[axis]);
  const groups: GroupedRow[] = [];

  for (const item of sorted) {
    const last = groups[groups.length - 1];

    if (!last || Math.abs(item[axis] - last.center) > tolerance) {
      groups.push({ center: item[axis], items: [item] });
      continue;
    }

    last.items.push(item);
    last.center =
      last.items.reduce((total, candidate) => total + candidate[axis], 0) / last.items.length;
  }

  return groups;
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

function extractTokenCandidates(cv: any, source: any, rect: Rect, kind: "matrix" | "sequence") {
  const crop = source.roi(new cv.Rect(rect.x, rect.y, rect.width, rect.height));
  const textMask = buildTextMask(cv, crop);
  const merged = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  const mergeWidth = Math.max(Math.round(rect.width / (kind === "matrix" ? 55 : 34)), 4);
  const mergeHeight = Math.max(Math.round(rect.height / 110), 2);
  const mergeKernel = cv.Mat.ones(mergeHeight, mergeWidth, cv.CV_8U);
  const minArea = (rect.width * rect.height) / (kind === "matrix" ? 3000 : 2200);
  const maxWidth = rect.width / (kind === "matrix" ? 3.4 : 1.6);
  const tokenRects: TokenCandidate[] = [];

  try {
    cv.dilate(textMask, merged, mergeKernel);
    cv.findContours(merged, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      try {
        const candidateRect = cv.boundingRect(contour);
        const area = candidateRect.width * candidateRect.height;

        if (
          area < minArea ||
          candidateRect.width < mergeWidth ||
          candidateRect.height < mergeHeight * 3 ||
          candidateRect.width > maxWidth
        ) {
          continue;
        }

        tokenRects.push({
          rect: {
            x: rect.x + candidateRect.x,
            y: rect.y + candidateRect.y,
            width: candidateRect.width,
            height: candidateRect.height,
          },
          centerX: rect.x + candidateRect.x + candidateRect.width / 2,
          centerY: rect.y + candidateRect.y + candidateRect.height / 2,
        });
      } finally {
        contour.delete();
      }
    }
  } finally {
    safeDelete(crop, textMask, merged, contours, hierarchy, mergeKernel);
  }

  return tokenRects.sort((left, right) => left.centerY - right.centerY || left.centerX - right.centerX);
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
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const dilated = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernel = cv.Mat.ones(2, 2, cv.CV_8U);
  const slots: Rect[] = [];

  try {
    cv.cvtColor(crop, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 60, 160);
    cv.dilate(edges, dilated, kernel);
    cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      try {
        const candidateRect = cv.boundingRect(contour);
        const aspect = candidateRect.width / Math.max(candidateRect.height, 1);

        if (
          candidateRect.width < rect.width * 0.04 ||
          candidateRect.width > rect.width * 0.35 ||
          candidateRect.height < rect.height * 0.25 ||
          candidateRect.height > rect.height * 0.93 ||
          aspect < 0.55 ||
          aspect > 1.65
        ) {
          continue;
        }

        slots.push(toRect(candidateRect));
      } finally {
        contour.delete();
      }
    }
  } finally {
    safeDelete(crop, gray, edges, dilated, contours, hierarchy, kernel);
  }

  return absoluteBufferSlots(dedupeRects(slots, 10).sort((left, right) => left.x - right.x), rect);
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

async function recognizeTokens(cv: any, source: any, candidates: TokenCandidate[]) {
  const results: Array<
    Pick<DebugToken, "rect" | "center" | "rawText" | "value" | "confidence">
  > = [];

  for (const candidate of candidates) {
    const canvas = cropForOcr(cv, source, candidate.rect);
    const token = await recognizeCodeToken(canvas);

    results.push({
      rect: candidate.rect,
      center: {
        x: candidate.rect.x + candidate.rect.width / 2,
        y: candidate.rect.y + candidate.rect.height / 2,
      },
      rawText: token.rawText,
      value: token.value,
      confidence: token.confidence,
    });
  }

  return results;
}

function rowsFromCandidates(candidates: TokenCandidate[]) {
  const tolerance = Math.max(median(candidates.map((item) => item.rect.height)) * 0.85, 10);
  return clusterByAxis(candidates, "centerY", tolerance).sort((left, right) => left.center - right.center);
}

function columnsFromCandidates(candidates: TokenCandidate[]) {
  const tolerance = Math.max(median(candidates.map((item) => item.rect.width)) * 1.2, 12);
  return clusterByAxis(candidates, "centerX", tolerance).sort((left, right) => left.center - right.center);
}

function emptyMatrix(rows: number, cols: number) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => "" as CodeValue));
}

async function extractMatrix(
  cv: any,
  source: any,
  panelRect: Rect,
): Promise<{ matrix: CodeValue[][]; debugTokens: DebugToken[]; warnings: string[] }> {
  const contentRect = insetRect(panelRect, panelPadding.matrix);
  const candidates = extractTokenCandidates(cv, source, contentRect, "matrix");
  const warnings: string[] = [];

  if (candidates.length === 0) {
    warnings.push("Could not detect any code matrix tokens.");
    return { matrix: createEmptyPuzzle(6).matrix, debugTokens: [], warnings };
  }

  const rowGroups = rowsFromCandidates(candidates);
  const columnGroups = columnsFromCandidates(candidates);
  const matrix = emptyMatrix(rowGroups.length, columnGroups.length);
  const debugTokens: DebugToken[] = [];

  const recognized = await recognizeTokens(cv, source, candidates);

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const recognizedToken = recognized[index];
    const row = rowGroups.findIndex((group) => group.items.includes(candidate));
    const col = columnGroups.findIndex((group) => group.items.includes(candidate));

    if (row < 0 || col < 0) {
      continue;
    }

    matrix[row][col] = recognizedToken.value;
    debugTokens.push({
      row,
      col,
      rect: candidate.rect,
      center: recognizedToken.center,
      rawText: recognizedToken.rawText,
      value: recognizedToken.value,
      confidence: recognizedToken.confidence,
    });
  }

  console.log(`[matrix] candidates=${candidates.length} rows=${rowGroups.length} cols=${columnGroups.length}`,
    'rowCenters:', rowGroups.map(function(g){return Math.round(g.center)}).join(','),
    'colCenters:', columnGroups.map(function(g){return Math.round(g.center)}).join(','));

  if (rowGroups.length < 4 || rowGroups.length > 8 || columnGroups.length < 4 || columnGroups.length > 8) {
    warnings.push("Matrix grid size looks unusual. Review the extracted cells before solving.");
  }

  return { matrix, debugTokens, warnings };
}

async function extractSequences(
  cv: any,
  source: any,
  panelRect: Rect,
): Promise<{ sequences: CodeValue[][]; debugTokens: DebugToken[]; warnings: string[] }> {
  const contentRect = insetRect(panelRect, panelPadding.sequence);
  const candidates = extractTokenCandidates(cv, source, contentRect, "sequence");
  const warnings: string[] = [];

  if (candidates.length === 0) {
    warnings.push("Could not detect any sequence tokens.");
    return { sequences: createEmptyPuzzle(6).sequences, debugTokens: [], warnings };
  }

  const rowGroups = rowsFromCandidates(candidates);
  const recognized = await recognizeTokens(cv, source, candidates);
  const sequences: CodeValue[][] = rowGroups.map(() => []);
  const debugTokens: DebugToken[] = [];
  const tokensByRow = rowGroups.map(() => [] as Array<{
    candidate: TokenCandidate;
    token: Pick<DebugToken, "center" | "rawText" | "value" | "confidence">;
  }>);

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const recognizedToken = recognized[index];
    const row = rowGroups.findIndex((group) => group.items.includes(candidate));

    if (row < 0) {
      continue;
    }

    tokensByRow[row].push({ candidate, token: recognizedToken });
  }

  tokensByRow.forEach((rowEntries, rowIndex) => {
    rowEntries.sort((left, right) => left.candidate.centerX - right.candidate.centerX);

    rowEntries.forEach((entry, colIndex) => {
      sequences[rowIndex].push(entry.token.value);
      debugTokens.push({
        row: rowIndex,
        col: colIndex,
        rect: entry.candidate.rect,
        center: entry.token.center,
        rawText: entry.token.rawText,
        value: entry.token.value,
        confidence: entry.token.confidence,
      });
    });
  });

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
