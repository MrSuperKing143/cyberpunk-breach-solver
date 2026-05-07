/* eslint-disable @typescript-eslint/no-explicit-any */
import { recognizeCodeToken } from "@/lib/analysis/ocr";
import { loadOpenCv } from "@/lib/analysis/opencv";
import {
  type PanelRects,
  buildEdgeMask,
  centersToBounds,
  detectBufferSlots,
  estimateBufferRect,
  findPanelByAnchor,
  findPeaks,
  findSequenceContentWidth,
  groupPeaks,
  integerRect,
  matColSums,
  matRowSums,
  preprocessCellMat,
  preprocessEdgesForGrid,
  safeDelete,
  trimEdgeNoise,
} from "@/lib/analysis/extract-core";
import {
  type AnalysisResult,
  type CodeValue,
  type DebugToken,
  type EditablePuzzle,
  type Rect,
  createEmptyPuzzle,
} from "@/lib/types/breach";

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

function cropForOcr(cv: any, source: any, rect: Rect) {
  const mat = preprocessCellMat(cv, source, rect);
  const canvas = createCanvas(mat.cols, mat.rows);
  cv.imshow(canvas, mat);
  mat.delete();
  return canvas;
}

async function recognizeCellRect(
  cv: any,
  source: any,
  row: number,
  col: number,
  rect: Rect,
): Promise<{ value: CodeValue; debugToken: DebugToken }> {
  const canvas = cropForOcr(cv, source, rect);
  const maskDataUrl = canvas.toDataURL("image/png");
  const token = await recognizeCodeToken(canvas);
  return {
    value: token.value,
    debugToken: {
      row,
      col,
      rect,
      center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      rawText: token.rawText,
      value: token.value,
      confidence: token.confidence,
      maskDataUrl,
    },
  };
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
  const matrix: CodeValue[][] = Array.from({ length: nRows }, () =>
    Array.from({ length: nCols }, () => "" as CodeValue),
  );
  const debugTokens: DebugToken[] = [];

  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const cellRect = integerRect({
        x: contentRect.x + colBounds[c],
        y: contentRect.y + rowBounds[r],
        width: colBounds[c + 1] - colBounds[c],
        height: rowBounds[r + 1] - rowBounds[r],
      });
      const { value, debugToken } = await recognizeCellRect(cv, source, r, c, cellRect);
      matrix[r][c] = value;
      debugTokens.push(debugToken);
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
      const { value, debugToken } = await recognizeCellRect(cv, source, r, c, cellRect);
      sequences[r].push(value);
      debugTokens.push(debugToken);
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
