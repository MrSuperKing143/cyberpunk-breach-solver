'use client';

import { useRef, useState } from "react";

import type { AnalysisResult, CodeValue, EditablePuzzle, SolverResult } from "@/lib/types/breach";
import { BREACH_CODES } from "@/lib/types/breach";
import styles from "@/styles/puzzle-editor.module.scss";

const CODES = BREACH_CODES as readonly string[];
// Map first character → full code (each code's first char is unique)
const FIRST_CHAR_MAP: Record<string, CodeValue> = {};
for (const code of BREACH_CODES) {
  FIRST_CHAR_MAP[code[0]] = code;
}

interface PuzzleEditorProps {
  analysis: AnalysisResult | null;
  onChange: (next: EditablePuzzle) => void;
  onMatrixSizeChange: (size: number) => void;
  onRestoreExtracted: () => void;
  puzzle: EditablePuzzle;
  revealed: number;
  solverResult: SolverResult | null;
}

function matrixTokenKey(row: number, col: number) {
  return `${row}:${col}`;
}

// ── SizePicker ────────────────────────────────────────────────────────────────
function SizePicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (v: number) => void;
}) {
  const idx = options.indexOf(value);
  return (
    <span className={styles.sizePicker}>
      <span className={styles.sizePickerLabel}>{label}</span>
      <button
        className={styles.sizePickerBtn}
        disabled={idx <= 0}
        onClick={() => onChange(options[Math.max(0, idx - 1)])}
        type="button"
      >
        −
      </button>
      <span className={styles.sizePickerValue}>{value}</span>
      <button
        className={styles.sizePickerBtn}
        disabled={idx >= options.length - 1}
        onClick={() => onChange(options[Math.min(options.length - 1, idx + 1)])}
        type="button"
      >
        +
      </button>
    </span>
  );
}

// ── TokenSequenceField ────────────────────────────────────────────────────────
// Chip input: type first char of a code to append it, Backspace removes last.
function TokenSequenceField({
  tokens,
  onChange,
}: {
  tokens: CodeValue[];
  onChange: (next: CodeValue[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");

  const onDraftChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    for (const ch of e.target.value.toUpperCase()) {
      const code = FIRST_CHAR_MAP[ch];
      if (code) { onChange([...tokens, code]); setDraft(""); return; }
    }
    setDraft("");
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && draft === "" && tokens.length > 0) {
      e.preventDefault();
      onChange(tokens.slice(0, -1));
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = (e.clipboardData.getData("text") || "").toUpperCase();
    const next: CodeValue[] = [];
    let i = 0;
    while (i < text.length) {
      const two = text.slice(i, i + 2);
      if (CODES.includes(two)) { next.push(two as CodeValue); i += 2; continue; }
      const code = FIRST_CHAR_MAP[text[i]];
      if (code) { next.push(code); i += 1; continue; }
      i += 1;
    }
    if (next.length) onChange([...tokens, ...next]);
  };

  return (
    <div
      className={styles.tokenField}
      onClick={() => inputRef.current?.focus()}
    >
      {tokens.length === 0 && draft === "" && (
        <span className={styles.tokenPlaceholder}>type 1·5·7·B·E·F</span>
      )}
      {tokens.map((t, i) => (
        <span className={styles.tokenChip} key={i}>{t}</span>
      ))}
      <input
        ref={inputRef}
        className={styles.tokenInput}
        value={draft}
        onChange={onDraftChange}
        onKeyDown={onInputKeyDown}
        onPaste={onPaste}
      />
    </div>
  );
}

// ── PuzzleEditor ──────────────────────────────────────────────────────────────
export function PuzzleEditor({
  analysis,
  onChange,
  onMatrixSizeChange,
  onRestoreExtracted,
  puzzle,
  revealed,
  solverResult,
}: PuzzleEditorProps) {
  const lowConfidenceMatrix = new Set(
    analysis?.debug.matrixTokens
      .filter((t) => t.confidence < 0.55)
      .map((t) => matrixTokenKey(t.row, t.col)) ?? [],
  );

  const N = puzzle.matrix.length;
  const pathStepMap = new Map<string, number>();
  if (solverResult) {
    solverResult.path.forEach((step, idx) => {
      pathStepMap.set(matrixTokenKey(step.row, step.col), idx);
    });
  }

  const updateMatrixCell = (row: number, col: number, value: CodeValue) => {
    onChange({
      ...puzzle,
      matrix: puzzle.matrix.map((r, ri) =>
        ri === row ? r.map((v, ci) => (ci === col ? value : v)) : r,
      ),
    });
  };

  const updateSequence = (rowIndex: number, tokens: CodeValue[]) => {
    onChange({
      ...puzzle,
      sequences: puzzle.sequences.map((seq, i) => (i === rowIndex ? tokens : seq)),
    });
  };

  const seqStatus = (idx: number): "matched" | "partial" | "pending" => {
    if (!solverResult || revealed < solverResult.path.length) return "pending";
    if (solverResult.matchedSequences.includes(idx)) return "matched";
    return "pending";
  };

  // Build SVG path segments for the matrix
  const pathSegs: Array<{ x1: number; y1: number; x2: number; y2: number; last: boolean }> = [];
  if (solverResult) {
    const pts = solverResult.path.slice(0, revealed);
    const INSET = 0.31;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const ax = a.col + 0.5, ay = a.row + 0.5;
      const bx = b.col + 0.5, by = b.row + 0.5;
      let x1 = ax, y1 = ay, x2 = bx, y2 = by;
      if (a.row === b.row) {
        x1 = ax + (b.col > a.col ? INSET : -INSET);
        x2 = bx + (b.col > a.col ? -INSET : INSET);
      } else {
        y1 = ay + (b.row > a.row ? INSET : -INSET);
        y2 = by + (b.row > a.row ? -INSET : INSET);
      }
      pathSegs.push({ x1, y1, x2, y2, last: i === pts.length - 2 });
    }
  }

  return (
    <>
      {/* ── B.02 CODE MATRIX ── */}
      <section className={styles.panel}>
        <div className={styles.panelTitle}>
          <span>
            <span className={styles.panelId}>B.02</span>
            CODE MATRIX · {N}×{N}
          </span>
          <div className={styles.panelTitleRight}>
            {analysis && (
              <button
                style={{
                  background: "transparent",
                  border: "1px solid var(--line)",
                  color: "var(--muted)",
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  padding: "3px 8px",
                  cursor: "pointer",
                }}
                onClick={onRestoreExtracted}
                type="button"
              >
                RESTORE
              </button>
            )}
            <SizePicker
              label="SIZE"
              value={N}
              options={[4, 5, 6, 7, 8]}
              onChange={onMatrixSizeChange}
            />
          </div>
        </div>

        <div className={styles.matrixWrap}>
          <div
            className={styles.matrixGrid}
            style={{ gridTemplateColumns: `repeat(${N}, var(--matrix-cell-size))` }}
          >
            {puzzle.matrix.map((row, rowIdx) =>
              row.map((value, colIdx) => {
                const key = matrixTokenKey(rowIdx, colIdx);
                const stepIdx = pathStepMap.get(key);
                const inPath = stepIdx !== undefined && stepIdx < revealed;
                const isLowConf = lowConfidenceMatrix.has(key);

                return (
                  <div
                    key={key}
                    className={`${styles.matrixCell} ${inPath ? styles.matrixCellInPath : ""} ${isLowConf ? styles.lowConfidence : ""}`}
                    style={{
                      borderRight: colIdx < N - 1 ? "1px solid var(--line)" : "none",
                      borderBottom: rowIdx < N - 1 ? "1px solid var(--line)" : "none",
                    }}
                  >
                    {inPath && <span className={styles.pathBorder} />}
                    {inPath && (
                      <span className={styles.stepNumber}>
                        {String((stepIdx ?? 0) + 1).padStart(2, "0")}
                      </span>
                    )}
                    <select
                      className={styles.matrixSelect}
                      onChange={(e) => updateMatrixCell(rowIdx, colIdx, e.target.value as CodeValue)}
                      value={value}
                    >
                      <option value="">--</option>
                      {BREACH_CODES.map((code) => (
                        <option key={code} value={code}>{code}</option>
                      ))}
                    </select>
                  </div>
                );
              }),
            )}

            {/* SVG path overlay */}
            <svg
              className={styles.matrixSvg}
              style={{
                gridColumn: `1 / ${N + 1}`,
                gridRow: `1 / ${N + 1}`,
                position: "absolute",
                inset: 0,
              }}
            >
              <defs>
                <marker
                  id="arrowCyan"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#5ee9f2" />
                </marker>
              </defs>
              {pathSegs.map((seg, i) => (
                <line
                  key={i}
                  x1={`${(seg.x1 * 100) / N}%`}
                  y1={`${(seg.y1 * 100) / N}%`}
                  x2={`${(seg.x2 * 100) / N}%`}
                  y2={`${(seg.y2 * 100) / N}%`}
                  stroke="#5ee9f2"
                  strokeWidth={5}
                  strokeLinecap="square"
                />
              ))}
            </svg>
          </div>
        </div>
      </section>

      {/* ── B.03 DAEMONS ── */}
      <section className={styles.daemonsPanel}>
        <div className={styles.panelTitle}>
          <span>
            <span className={styles.panelId}>B.03</span>
            DAEMONS
          </span>
          <div className={styles.panelTitleRight}>
            <SizePicker
              label="COUNT"
              value={puzzle.sequences.length}
              options={[1, 2, 3, 4, 5]}
              onChange={(count) => {
                const current = puzzle.sequences;
                if (count > current.length) {
                  onChange({
                    ...puzzle,
                    sequences: [...current, ...Array.from({ length: count - current.length }, () => ["", ""] as CodeValue[])],
                  });
                } else {
                  onChange({ ...puzzle, sequences: current.slice(0, count) });
                }
              }}
            />
          </div>
        </div>

        {puzzle.sequences.map((seq, idx) => {
          const validTokens = seq.filter((t): t is CodeValue => t !== "");
          const status = seqStatus(idx);
          return (
            <div className={styles.sequenceRow} key={`seq-${idx}`}>
              <span className={styles.sequenceNum}>§{String(idx + 1).padStart(2, "0")}</span>
              <TokenSequenceField
                tokens={validTokens}
                onChange={(next) => {
                  const padded = [...next, ...Array.from<CodeValue>({ length: Math.max(0, seq.length - next.length) }).fill("")];
                  updateSequence(idx, next.length >= seq.length ? next : padded);
                }}
              />
              <span
                className={`${styles.statusBadge} ${
                  status === "matched"
                    ? styles.statusMatched
                    : status === "partial"
                      ? styles.statusPartial
                      : styles.statusPending
                }`}
              >
                {status.toUpperCase()}
              </span>
            </div>
          );
        })}
      </section>
    </>
  );
}
