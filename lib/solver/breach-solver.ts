import runSolver from "./bruter";
import type { Coord } from "./bruter";
import {
  type BreachCode,
  type EditablePuzzle,
  type SolverPathStep,
  type SolverResult,
  type SolverScore,
  filledMatrix,
  sanitizeSequences,
} from "@/lib/types/breach";

const CODES: BreachCode[] = ["1C", "55", "7A", "BD", "E9", "FF"];
const CODE_TO_NUM = new Map(CODES.map((c, i) => [c, i] as const));

function containsSequence(path: readonly BreachCode[], sequence: readonly BreachCode[]) {
  if (sequence.length > path.length) {
    return false;
  }

  for (let start = 0; start <= path.length - sequence.length; start += 1) {
    let matches = true;
    for (let index = 0; index < sequence.length; index += 1) {
      if (path[start + index] !== sequence[index]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return true;
    }
  }

  return false;
}

function longestSuffixPrefixMatch(
  path: readonly BreachCode[],
  sequence: readonly BreachCode[],
) {
  const maxLength = Math.min(path.length, sequence.length - 1);

  for (let length = maxLength; length > 0; length -= 1) {
    let matches = true;
    for (let index = 0; index < length; index += 1) {
      if (path[path.length - length + index] !== sequence[index]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return length;
    }
  }

  return 0;
}

function scorePath(
  codeString: readonly BreachCode[],
  sequences: readonly BreachCode[][],
  bufferSize: number,
): { matchedSequences: number[]; score: SolverScore } {
  const matchedSequences = sequences
    .map((sequence, index) => ({ index, matched: containsSequence(codeString, sequence) }))
    .filter((entry) => entry.matched)
    .map((entry) => entry.index);

  const completedTokenCount = matchedSequences.reduce(
    (total, index) => total + sequences[index].length,
    0,
  );

  const partialProgress = sequences.reduce((best, sequence, index) => {
    if (matchedSequences.includes(index)) {
      return best;
    }

    return best + longestSuffixPrefixMatch(codeString, sequence);
  }, 0);

  return {
    matchedSequences,
    score: {
      completedCount: matchedSequences.length,
      completedTokenCount,
      partialProgress,
      spareBuffer: Math.max(bufferSize - codeString.length, 0),
    },
  };
}

function coordsToPath(coords: Coord[], matrix: BreachCode[][]): SolverPathStep[] {
  return coords.map(({ x, y }) => ({ row: y, col: x, value: matrix[y][x] }));
}

export function solveBreachPuzzle(puzzle: EditablePuzzle): SolverResult | null {
  if (!puzzle.bufferSize || !filledMatrix(puzzle.matrix)) {
    return null;
  }

  const sequences = sanitizeSequences(puzzle.sequences);
  if (sequences.length === 0) {
    return null;
  }

  const matrix = puzzle.matrix;
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;

  if (!rows || !cols) {
    return null;
  }

  const numMatrix = matrix.map((row) => row.map((c) => CODE_TO_NUM.get(c)!));
  const numSequences = sequences.map((seq) => seq.map((c) => CODE_TO_NUM.get(c)!));

  const result = runSolver(numMatrix, numSequences, puzzle.bufferSize, {
    useSequencePriorityOrder: false,
  });

  if (!result) {
    return null;
  }

  const path = coordsToPath(result.solution, matrix);
  const codeString = path.map((s) => s.value);
  const { matchedSequences, score } = scorePath(codeString, sequences, puzzle.bufferSize);

  return {
    path,
    codeString,
    matchedSequences,
    score,
    exploredPaths: 0,
  };
}
