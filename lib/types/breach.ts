export const BREACH_CODES = ["1C", "55", "7A", "BD", "E9", "FF"] as const;

export type BreachCode = (typeof BREACH_CODES)[number];
export type CodeValue = BreachCode | "";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditablePuzzle {
  bufferSize: number | null;
  matrix: CodeValue[][];
  sequences: CodeValue[][];
}

export interface ImageSnapshot {
  src: string;
  width: number;
  height: number;
  name?: string;
}

export interface DebugToken {
  row: number;
  col: number;
  rect: Rect;
  center: Point;
  rawText: string;
  value: CodeValue;
  confidence: number;
}

export interface AnalysisDebug {
  panels: {
    matrix?: Rect;
    sequence?: Rect;
    buffer?: Rect;
  };
  matrixTokens: DebugToken[];
  sequenceTokens: DebugToken[];
  bufferSlots: Rect[];
}

export interface AnalysisResult {
  image: ImageSnapshot;
  puzzle: EditablePuzzle;
  debug: AnalysisDebug;
  warnings: string[];
  confidence: number;
}

export interface SolverPathStep {
  row: number;
  col: number;
  value: BreachCode;
}

export interface SolverScore {
  completedCount: number;
  completedTokenCount: number;
  partialProgress: number;
  spareBuffer: number;
}

export interface SolverResult {
  path: SolverPathStep[];
  codeString: BreachCode[];
  matchedSequences: number[];
  score: SolverScore;
  exploredPaths: number;
}

const BREACH_CODE_SET = new Set<BreachCode>(BREACH_CODES);

export function isBreachCode(value: string): value is BreachCode {
  return BREACH_CODE_SET.has(value as BreachCode);
}

export function normalizeCodeValue(value: string): CodeValue {
  const upper = value.trim().toUpperCase();
  return isBreachCode(upper) ? upper : "";
}

export function createEmptyPuzzle(size = 6): EditablePuzzle {
  return {
    bufferSize: null,
    matrix: Array.from({ length: size }, () =>
      Array.from({ length: size }, () => ""),
    ),
    sequences: [["", ""], ["", ""], ["", ""]],
  };
}

export function filledMatrix(matrix: CodeValue[][]): matrix is BreachCode[][] {
  return matrix.every(
    (row) => row.length > 0 && row.every((value) => typeof value === "string" && value !== ""),
  );
}

export function sanitizeSequences(sequences: CodeValue[][]): BreachCode[][] {
  return sequences
    .map((row) => row.filter((value): value is BreachCode => value !== ""))
    .filter((row) => row.length > 0);
}

export function validatePuzzle(puzzle: EditablePuzzle): string[] {
  const issues: string[] = [];

  if (!puzzle.bufferSize || puzzle.bufferSize < 1) {
    issues.push("Set a buffer size before solving.");
  }

  if (puzzle.matrix.length === 0 || puzzle.matrix.some((row) => row.length === 0)) {
    issues.push("Enter a code matrix before solving.");
  }

  if (!filledMatrix(puzzle.matrix)) {
    issues.push("Every matrix cell needs a valid breach code.");
  }

  if (sanitizeSequences(puzzle.sequences).length === 0) {
    issues.push("Add at least one sequence to solve.");
  }

  return issues;
}

export function codeArrayToString(values: readonly string[]): string {
  return values.join(" ");
}
