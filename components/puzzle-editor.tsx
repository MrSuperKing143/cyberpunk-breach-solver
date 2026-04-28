'use client';

import type { AnalysisResult, CodeValue, EditablePuzzle } from "@/lib/types/breach";
import { BREACH_CODES } from "@/lib/types/breach";
import styles from "@/styles/puzzle-editor.module.scss";

interface PuzzleEditorProps {
  analysis: AnalysisResult | null;
  onChange: (next: EditablePuzzle) => void;
  onMatrixSizeChange: (size: number) => void;
  onRestoreExtracted: () => void;
  puzzle: EditablePuzzle;
}

function matrixTokenKey(row: number, col: number) {
  return `${row}:${col}`;
}

function nextSequenceLength(row: CodeValue[]) {
  return Math.min(Math.max(row.length + 1, 1), 6);
}

export function PuzzleEditor({
  analysis,
  onChange,
  onMatrixSizeChange,
  onRestoreExtracted,
  puzzle,
}: PuzzleEditorProps) {
  const lowConfidenceMatrix = new Set(
    analysis?.debug.matrixTokens
      .filter((token) => token.confidence < 0.55)
      .map((token) => matrixTokenKey(token.row, token.col)) ?? [],
  );

  const updateBufferSize = (value: number) => {
    onChange({
      ...puzzle,
      bufferSize: Number.isFinite(value) && value > 0 ? value : null,
    });
  };

  const updateMatrixCell = (row: number, col: number, value: CodeValue) => {
    onChange({
      ...puzzle,
      matrix: puzzle.matrix.map((matrixRow, rowIndex) =>
        rowIndex === row
          ? matrixRow.map((cellValue, colIndex) => (colIndex === col ? value : cellValue))
          : matrixRow,
      ),
    });
  };

  const updateSequenceToken = (row: number, col: number, value: CodeValue) => {
    onChange({
      ...puzzle,
      sequences: puzzle.sequences.map((sequenceRow, rowIndex) =>
        rowIndex === row
          ? sequenceRow.map((tokenValue, colIndex) => (colIndex === col ? value : tokenValue))
          : sequenceRow,
      ),
    });
  };

  const addSequenceRow = () => {
    onChange({
      ...puzzle,
      sequences: [...puzzle.sequences, ["", ""]],
    });
  };

  const removeSequenceRow = (row: number) => {
    onChange({
      ...puzzle,
      sequences: puzzle.sequences.filter((_, rowIndex) => rowIndex !== row),
    });
  };

  const addSequenceToken = (row: number) => {
    onChange({
      ...puzzle,
      sequences: puzzle.sequences.map((sequenceRow, rowIndex) =>
        rowIndex === row
          ? [
              ...sequenceRow,
              ...Array.from(
                { length: nextSequenceLength(sequenceRow) - sequenceRow.length },
                () => "" as CodeValue,
              ),
            ]
          : sequenceRow,
      ),
    });
  };

  const removeSequenceToken = (row: number, col: number) => {
    onChange({
      ...puzzle,
      sequences: puzzle.sequences.map((sequenceRow, rowIndex) =>
        rowIndex === row
          ? sequenceRow.filter((_, colIndex) => colIndex !== col)
          : sequenceRow,
      ),
    });
  };

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Editable Puzzle</p>
          <h2>Extraction Results</h2>
        </div>
        {analysis && (
          <button className={styles.restoreButton} onClick={onRestoreExtracted} type="button">
            Restore Extracted
          </button>
        )}
      </header>

      <div className={styles.metaRow}>
        <label className={styles.field}>
          <span>Buffer Size</span>
          <input
            max={12}
            min={1}
            onChange={(event) => updateBufferSize(Number(event.target.value))}
            type="number"
            value={puzzle.bufferSize ?? ""}
          />
        </label>

        <label className={styles.field}>
          <span>Matrix Size</span>
          <select
            onChange={(event) => onMatrixSizeChange(Number(event.target.value))}
            value={puzzle.matrix.length}
          >
            {[4, 5, 6, 7, 8].map((size) => (
              <option key={size} value={size}>
                {size} x {size}
              </option>
            ))}
          </select>
        </label>

        {analysis && (
          <div className={styles.confidenceBadge}>
            OCR confidence <strong>{Math.round(analysis.confidence * 100)}%</strong>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Code Matrix</h3>
        </div>
        <div
          className={styles.matrixGrid}
          style={{
            gridTemplateColumns: `repeat(${puzzle.matrix[0]?.length ?? 0}, minmax(0, 1fr))`,
          }}
        >
          {puzzle.matrix.map((row, rowIndex) =>
            row.map((value, colIndex) => (
              <select
                className={`${styles.codeSelect} ${
                  lowConfidenceMatrix.has(matrixTokenKey(rowIndex, colIndex))
                    ? styles.lowConfidence
                    : ""
                }`}
                key={matrixTokenKey(rowIndex, colIndex)}
                onChange={(event) =>
                  updateMatrixCell(rowIndex, colIndex, event.target.value as CodeValue)
                }
                value={value}
              >
                <option value="">--</option>
                {BREACH_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            )),
          )}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Sequences</h3>
          <button className={styles.inlineButton} onClick={addSequenceRow} type="button">
            Add Sequence
          </button>
        </div>
        <div className={styles.sequenceList}>
          {puzzle.sequences.map((sequenceRow, rowIndex) => (
            <div className={styles.sequenceRow} key={`sequence-${rowIndex}`}>
              <span className={styles.sequenceLabel}>Row {rowIndex + 1}</span>
              <div className={styles.sequenceTokens}>
                {sequenceRow.map((value, colIndex) => (
                  <div className={styles.sequenceToken} key={`token-${rowIndex}-${colIndex}`}>
                    <select
                      className={styles.codeSelect}
                      onChange={(event) =>
                        updateSequenceToken(rowIndex, colIndex, event.target.value as CodeValue)
                      }
                      value={value}
                    >
                      <option value="">--</option>
                      {BREACH_CODES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                    {sequenceRow.length > 1 && (
                      <button
                        className={styles.removeTokenButton}
                        onClick={() => removeSequenceToken(rowIndex, colIndex)}
                        type="button"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className={styles.sequenceActions}>
                <button
                  className={styles.inlineButton}
                  onClick={() => addSequenceToken(rowIndex)}
                  type="button"
                >
                  Add Token
                </button>
                {puzzle.sequences.length > 1 && (
                  <button
                    className={styles.removeRowButton}
                    onClick={() => removeSequenceRow(rowIndex)}
                    type="button"
                  >
                    Remove Row
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
