/* eslint-disable @typescript-eslint/no-explicit-any */
import { type Rect } from "@/lib/types/breach";

export type PanelKey = "matrix" | "sequence" | "buffer";

export interface PanelRects {
  matrix?: Rect;
  sequence?: Rect;
  buffer?: Rect;
}

// Fractional [x, y] anchor points within each panel's content area.
// The detection finds the smallest contour that contains the anchor point.
export const panelAnchorPoints: Record<PanelKey, [number, number]> = {
  matrix:   [0.25, 0.40],
  sequence: [0.55, 0.35],
  buffer:   [0.50, 0.20],
};

export function safeDelete(...values: unknown[]) {
  for (const value of values) {
    if (value && typeof value === "object" && "delete" in value) {
      try {
        (value as { delete: () => void }).delete();
      } catch {
        // OpenCV.js throws if a Mat has already been deleted. Ignore cleanup races.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rect helpers
// ---------------------------------------------------------------------------

export function integerRect(rect: Rect): Rect {
  return {
    x: Math.max(Math.round(rect.x), 0),
    y: Math.max(Math.round(rect.y), 0),
    width: Math.max(Math.round(rect.width), 1),
    height: Math.max(Math.round(rect.height), 1),
  };
}

export function toRect(rect: { x: number; y: number; width: number; height: number }): Rect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

export function unionRect(left: Rect, right: Rect): Rect {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: maxX - x, height: maxY - y };
}

// ---------------------------------------------------------------------------
// Projection-based grid helpers
// ---------------------------------------------------------------------------

export function matColSums(mat: any): number[] {
  const { rows, cols } = mat;
  const data = mat.data as Uint8Array;
  const sums = new Array<number>(cols).fill(0);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) sums[c] += data[r * cols + c];
  return sums;
}

export function matRowSums(mat: any): number[] {
  const { rows, cols } = mat;
  const data = mat.data as Uint8Array;
  const sums = new Array<number>(rows).fill(0);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) sums[r] += data[r * cols + c];
  return sums;
}

export function findPeaks(projection: number[], thresholdRatio = 0.5): number[] {
  const threshold = Math.max(...projection) * thresholdRatio;
  return projection.reduce<number[]>((acc, v, i) => { if (v > threshold) acc.push(i); return acc; }, []);
}

export function groupPeaks(peaks: number[], minGap = 5): number[] {
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

export function centersToBounds(centers: number[], maxVal: number): number[] {
  if (centers.length < 2) return [0, maxVal];
  const bounds = [Math.max(0, centers[0] - Math.floor((centers[1] - centers[0]) / 2))];
  for (let i = 0; i < centers.length - 1; i++) bounds.push(Math.floor((centers[i] + centers[i + 1]) / 2));
  bounds.push(Math.min(maxVal, centers[centers.length - 1] + Math.floor((centers[centers.length - 1] - centers[centers.length - 2]) / 2)));
  return bounds;
}

// Scan colSums for the first wide (≥15 col) near-zero valley past the left 20% — the gap
// between hex-code cells and daemon descriptions.
export function findSequenceContentWidth(colSums: number[], totalWidth: number): number {
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

// ---------------------------------------------------------------------------
// OpenCV-dependent helpers — no browser APIs, cv is passed as a parameter
// ---------------------------------------------------------------------------

export function buildEdgeMask(cv: any, source: any): any {
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

// Trim rows/cols where Canny edge density exceeds 2× the median — removes frame borders.
export function trimEdgeNoise(cv: any, source: any, rect: Rect, maxInset = 20): Rect {
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
export function preprocessEdgesForGrid(cv: any, source: any, rect: Rect): any {
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

export function findPanelByAnchor(
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

export function estimateBufferRect(panels: PanelRects, width: number): Rect | undefined {
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

function absoluteBufferSlots(rects: Rect[], panelRect: Rect): Rect[] {
  return rects.map((rect) => integerRect({
    x: panelRect.x + rect.x,
    y: panelRect.y + rect.y,
    width: rect.width,
    height: rect.height,
  }));
}

export function detectBufferSlots(cv: any, source: any, rect: Rect): Rect[] {
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
