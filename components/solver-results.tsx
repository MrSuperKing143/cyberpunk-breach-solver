'use client';

import type { SolverResult } from "@/lib/types/breach";
import styles from "@/styles/solver-results.module.scss";

interface SolverResultsProps {
  bufferSize: number | null;
  onBufferSizeChange: (size: number) => void;
  revealed: number;
  solverResult: SolverResult | null;
}

const BUFFER_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12];

export function SolverResults({
  bufferSize,
  onBufferSizeChange,
  revealed,
  solverResult,
}: SolverResultsProps) {
  const effectiveSize = bufferSize ?? 8;
  const tokens = solverResult?.path.slice(0, revealed).map((s) => s.value) ?? [];
  const sizeIdx = BUFFER_OPTIONS.indexOf(effectiveSize);

  return (
    <section className={styles.panel}>
      {/* Title bar */}
      <div className={styles.panelTitle}>
        <span>
          <span className={styles.panelId}>B.01</span>
          BUFFER
        </span>
        <div className={styles.panelTitleRight}>
          <span>{revealed} / {effectiveSize}</span>
          <span className={styles.sizePicker}>
            <span className={styles.sizePickerLabel}>SIZE</span>
            <button
              className={styles.sizePickerBtn}
              disabled={sizeIdx <= 0}
              onClick={() => onBufferSizeChange(BUFFER_OPTIONS[Math.max(0, sizeIdx - 1)])}
              type="button"
            >
              −
            </button>
            <span className={styles.sizePickerValue}>{effectiveSize}</span>
            <button
              className={styles.sizePickerBtn}
              disabled={sizeIdx >= BUFFER_OPTIONS.length - 1}
              onClick={() => onBufferSizeChange(BUFFER_OPTIONS[Math.min(BUFFER_OPTIONS.length - 1, sizeIdx + 1)])}
              type="button"
            >
              +
            </button>
          </span>
        </div>
      </div>

      {/* Buffer slots */}
      <div className={styles.bufferWrap}>
        <div
          className={styles.bufferGrid}
          style={{ gridTemplateColumns: `repeat(${effectiveSize}, 1fr)` }}
        >
          {Array.from({ length: effectiveSize }).map((_, i) => {
            const filled = i < revealed;
            return (
              <div
                key={i}
                className={`${styles.bufferSlot} ${filled ? styles.bufferSlotFilled : ""}`}
              >
                {filled ? tokens[i] : "··"}
                <span className={`${styles.bufferSlotNum} ${filled ? styles.bufferSlotNumFilled : ""}`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Metrics strip — shown after solve completes */}
      {solverResult && revealed === solverResult.path.length && (
        <div className={styles.metricsRow}>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>SEQUENCES</span>
            <span className={styles.metricValue}>
              {solverResult.matchedSequences.length}
            </span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>BUFFER USED</span>
            <span className={styles.metricValue}>
              {solverResult.path.length}/{effectiveSize}
            </span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>PATHS</span>
            <span className={styles.metricValue}>
              {solverResult.exploredPaths.toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
