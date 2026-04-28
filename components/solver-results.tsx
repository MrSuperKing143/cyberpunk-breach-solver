'use client';

import type { AnalysisResult, EditablePuzzle, SolverResult } from "@/lib/types/breach";
import { codeArrayToString, sanitizeSequences } from "@/lib/types/breach";
import styles from "@/styles/solver-results.module.scss";

interface SolverResultsProps {
  analysis: AnalysisResult | null;
  puzzle: EditablePuzzle;
  solverResult: SolverResult | null;
}

export function SolverResults({
  analysis,
  puzzle,
  solverResult,
}: SolverResultsProps) {
  const sanitizedSequences = sanitizeSequences(puzzle.sequences);

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Solver Output</p>
          <h2>Best Valid Path</h2>
        </div>
        {analysis && (
          <div className={styles.analysisBadge}>
            Extracted from <strong>{analysis.image.name ?? "screenshot"}</strong>
          </div>
        )}
      </header>

      {solverResult ? (
        <>
          <div className={styles.metricRow}>
            <div className={styles.metric}>
              <span>Sequences matched</span>
              <strong>{solverResult.matchedSequences.length}</strong>
            </div>
            <div className={styles.metric}>
              <span>Buffer used</span>
              <strong>
                {solverResult.path.length}
                {puzzle.bufferSize ? ` / ${puzzle.bufferSize}` : ""}
              </strong>
            </div>
            <div className={styles.metric}>
              <span>Paths explored</span>
              <strong>{solverResult.exploredPaths}</strong>
            </div>
          </div>

          <div className={styles.codeString}>
            <span>Final code string</span>
            <strong>{codeArrayToString(solverResult.codeString)}</strong>
          </div>

          <div className={styles.section}>
            <h3>Matched Sequences</h3>
            <ul className={styles.sequenceList}>
              {sanitizedSequences.map((sequence, index) => (
                <li
                  className={
                    solverResult.matchedSequences.includes(index)
                      ? styles.sequenceMatched
                      : styles.sequenceMissed
                  }
                  key={`${sequence.join("-")}-${index}`}
                >
                  <span>{codeArrayToString(sequence)}</span>
                  <strong>
                    {solverResult.matchedSequences.includes(index) ? "Matched" : "Not matched"}
                  </strong>
                </li>
              ))}
            </ul>
          </div>

          <div className={styles.section}>
            <h3>Path</h3>
            <ol className={styles.pathList}>
              {solverResult.path.map((step, index) => (
                <li key={`${step.row}-${step.col}-${index}`}>
                  <span>{step.value}</span>
                  <small>
                    Row {step.row + 1}, Col {step.col + 1}
                  </small>
                </li>
              ))}
            </ol>
          </div>
        </>
      ) : (
        <div className={styles.emptyState}>
          <p>Run the solver after analysis or after entering a manual puzzle.</p>
        </div>
      )}
    </section>
  );
}
