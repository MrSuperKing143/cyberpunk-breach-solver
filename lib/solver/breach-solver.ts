import {
  type BreachCode,
  type EditablePuzzle,
  type SolverPathStep,
  type SolverResult,
  type SolverScore,
  filledMatrix,
  sanitizeSequences,
} from "@/lib/types/breach";

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

function compareScores(left: SolverScore, right: SolverScore) {
  return (
    left.completedCount - right.completedCount ||
    left.completedTokenCount - right.completedTokenCount ||
    left.partialProgress - right.partialProgress ||
    left.spareBuffer - right.spareBuffer
  );
}

function cellKey(row: number, col: number) {
  return `${row}:${col}`;
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

  let exploredPaths = 0;
  let bestResult: SolverResult | null = null;

  const updateBest = (path: SolverPathStep[], codeString: BreachCode[]) => {
    const { matchedSequences, score } = scorePath(codeString, sequences, puzzle.bufferSize!);

    const candidate: SolverResult = {
      path: [...path],
      codeString: [...codeString],
      matchedSequences,
      score,
      exploredPaths,
    };

    if (!bestResult || compareScores(score, bestResult.score) > 0) {
      bestResult = candidate;
      return;
    }

    if (
      bestResult &&
      compareScores(score, bestResult.score) === 0 &&
      candidate.path.length < bestResult.path.length
    ) {
      bestResult = candidate;
    }
  };

  const traverse = (
    path: SolverPathStep[],
    codeString: BreachCode[],
    used: Set<string>,
    nextAxis: "row" | "column",
  ) => {
    exploredPaths += 1;
    updateBest(path, codeString);

    if (path.length >= puzzle.bufferSize!) {
      return;
    }

    if (bestResult?.matchedSequences.length === sequences.length) {
      return;
    }

    const current = path[path.length - 1];
    if (!current) {
      return;
    }

    if (nextAxis === "column") {
      for (let row = 0; row < rows; row += 1) {
        const key = cellKey(row, current.col);
        if (used.has(key)) {
          continue;
        }

        const value = matrix[row][current.col];
        const nextStep: SolverPathStep = { row, col: current.col, value };
        const nextUsed = new Set(used);
        nextUsed.add(key);
        traverse([...path, nextStep], [...codeString, value], nextUsed, "row");
      }

      return;
    }

    for (let col = 0; col < cols; col += 1) {
      const key = cellKey(current.row, col);
      if (used.has(key)) {
        continue;
      }

      const value = matrix[current.row][col];
      const nextStep: SolverPathStep = { row: current.row, col, value };
      const nextUsed = new Set(used);
      nextUsed.add(key);
      traverse([...path, nextStep], [...codeString, value], nextUsed, "column");
    }
  };

  for (let col = 0; col < cols; col += 1) {
    const value = matrix[0][col];
    const start: SolverPathStep = { row: 0, col, value };
    traverse([start], [value], new Set([cellKey(0, col)]), "column");
  }

  if (!bestResult) {
    return null;
  }

  const finalResult = bestResult as SolverResult;
  finalResult.exploredPaths = exploredPaths;
  return finalResult;
}
