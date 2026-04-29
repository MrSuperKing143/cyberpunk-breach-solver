'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { ImageWorkbench } from "@/components/image-workbench";
import { PuzzleEditor } from "@/components/puzzle-editor";
import { SolverResults } from "@/components/solver-results";
import { analyzeBreachImage } from "@/lib/analysis/extract";
import { demoSamples } from "@/lib/sample-gallery";
import { solveBreachPuzzle } from "@/lib/solver/breach-solver";
import {
  type AnalysisResult,
  type EditablePuzzle,
  type SolverResult,
  createEmptyPuzzle,
  validatePuzzle,
} from "@/lib/types/breach";
import styles from "@/styles/breach-protocol-app.module.scss";

interface PreviewSource {
  src: string;
  name: string;
  origin: "upload" | "sample";
}

function resizeMatrix(matrix: EditablePuzzle["matrix"], size: number) {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => matrix[row]?.[col] ?? ""),
  );
}

export function BreachProtocolApp() {
  const [preview, setPreview] = useState<PreviewSource | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [editablePuzzle, setEditablePuzzle] = useState<EditablePuzzle>(
    createEmptyPuzzle(6),
  );
  const [solverResult, setSolverResult] = useState<SolverResult | null>(null);
  const [status, setStatus] = useState("READY");
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [busyAction, setBusyAction] = useState<"analyze" | "solve" | null>(null);
  const [isPending, startTransition] = useTransition();
  const [revealed, setRevealed] = useState(0);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (uploadUrlRef.current) URL.revokeObjectURL(uploadUrlRef.current);
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    };
  }, []);

  const warnings = analysis?.warnings ?? [];
  const canSolve = useMemo(
    () => validatePuzzle(editablePuzzle).length === 0,
    [editablePuzzle],
  );

  const solving = busyAction === "solve";
  const solved = !solving && solverResult !== null && revealed === solverResult.path.length;

  function animateReveal(path: SolverResult["path"], interval = 180) {
    let i = 0;
    function tick() {
      i += 1;
      setRevealed(i);
      if (i < path.length) {
        revealTimerRef.current = setTimeout(tick, interval);
      }
    }
    revealTimerRef.current = setTimeout(tick, interval * 1.6);
  }

  const setPreviewSource = (nextPreview: PreviewSource | null) => {
    if (uploadUrlRef.current && uploadUrlRef.current !== nextPreview?.src) {
      URL.revokeObjectURL(uploadUrlRef.current);
      uploadUrlRef.current = null;
    }
    if (nextPreview?.origin === "upload") uploadUrlRef.current = nextPreview.src;
    setPreview(nextPreview);
  };

  const handleFileSelected = (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    setPreviewSource({ src: objectUrl, name: file.name, origin: "upload" });
    setAnalysis(null);
    setSolverResult(null);
    setRevealed(0);
    setError(null);
    setStatus(`LOADED ${file.name.toUpperCase()}`);
  };

  const handleSelectSample = (sampleId: string) => {
    const sample = demoSamples.find((entry) => entry.id === sampleId);
    if (!sample) return;
    setPreviewSource({ src: sample.src, name: sample.label, origin: "sample" });
    setAnalysis(null);
    setSolverResult(null);
    setRevealed(0);
    setError(null);
    setStatus(`SAMPLE LOADED · ${sample.label.toUpperCase()}`);
  };

  const handleAnalyze = async () => {
    if (!preview) {
      setError("Load a screenshot before running analysis.");
      return;
    }
    setBusyAction("analyze");
    setError(null);
    setSolverResult(null);
    setRevealed(0);

    try {
      const result = await analyzeBreachImage({
        src: preview.src,
        name: preview.name,
        onProgress: (message) => setStatus(message.toUpperCase()),
      });

      startTransition(() => {
        setAnalysis(result);
        setEditablePuzzle(result.puzzle);
        setShowDebug(false);
        setStatus(
          result.warnings.length
            ? "ANALYSIS COMPLETE · WARNINGS DETECTED"
            : "ANALYSIS COMPLETE · READY TO SOLVE",
        );
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "The screenshot could not be analyzed.";
      setError(message);
      setStatus("ANALYSIS FAILED");
    } finally {
      setBusyAction(null);
    }
  };

  const handleSolve = async () => {
    const issues = validatePuzzle(editablePuzzle);
    if (issues.length > 0) {
      setError(issues[0]);
      return;
    }
    setBusyAction("solve");
    setError(null);
    setRevealed(0);

    try {
      const result = solveBreachPuzzle(editablePuzzle);
      if (!result) {
        setError("The solver could not evaluate the current puzzle.");
        return;
      }

      startTransition(() => {
        setSolverResult(result);
        setStatus(
          result.matchedSequences.length > 0
            ? `OPTIMAL · ${result.matchedSequences.length}/${editablePuzzle.sequences.length} SEQUENCES`
            : "NO FULL SEQUENCE · BEST PARTIAL PATH",
        );
      });

      animateReveal(result.path);
    } finally {
      setBusyAction(null);
    }
  };

  const handleReset = () => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    setPreviewSource(null);
    setAnalysis(null);
    setEditablePuzzle(createEmptyPuzzle(6));
    setSolverResult(null);
    setRevealed(0);
    setError(null);
    setShowDebug(false);
    setStatus("READY");
  };

  const handleBlank = () => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    setAnalysis(null);
    setSolverResult(null);
    setRevealed(0);
    setError(null);
    setShowDebug(false);
    setEditablePuzzle(createEmptyPuzzle(6));
    setStatus("MANUAL MODE · READY");
  };

  const handleRestoreExtracted = () => {
    if (!analysis) return;
    setEditablePuzzle(analysis.puzzle);
    setSolverResult(null);
    setRevealed(0);
    setError(null);
    setStatus("RESTORED EXTRACTED VALUES");
  };

  const handleMatrixSizeChange = (size: number) => {
    setEditablePuzzle((current) => ({
      ...current,
      matrix: resizeMatrix(current.matrix, size),
    }));
    setSolverResult(null);
    setRevealed(0);
  };

  const statusText =
    busyAction === "analyze"
      ? "ANALYZING…"
      : busyAction === "solve"
        ? `EVALUATING PATHS`
        : status;

  const hasNotes = warnings.length > 0 || error !== null || isPending;

  return (
    <div className={styles.shell}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          <div className={styles.headerLogo}>▦</div>
          <div className={styles.headerMeta}>
            <span className={styles.headerSub}>{"// BREACH-SOLVER · v0.4.1"}</span>
            <span className={styles.headerTitle}>Matrix Decoder</span>
          </div>
        </div>
        <div className={styles.headerStatus}>
          <div className={styles.headerStatusItem}>
            OCV <strong>READY</strong>
          </div>
        </div>
      </header>

      {/* ── Action Bar ── */}
      <div className={styles.actionBar}>
        <button
          className={styles.actionBtn}
          disabled={!preview || busyAction !== null}
          onClick={handleAnalyze}
          type="button"
        >
          ▸ ANALYZE
        </button>
        <button
          className={`${styles.actionBtn} ${canSolve && !solving ? styles.actionBtnPrimary : ""}`}
          disabled={!canSolve || solving}
          onClick={solved ? handleReset : handleSolve}
          type="button"
        >
          {solving ? "▸ SOLVING…" : solved ? "▸ RESET" : "▸ SOLVE"}
        </button>
        <button
          className={styles.actionBtn}
          onClick={handleBlank}
          type="button"
        >
          BLANK
        </button>
        <button
          className={styles.actionBtn}
          onClick={handleReset}
          type="button"
        >
          RESET
        </button>
        <div className={styles.actionSpacer} />
        <div className={styles.actionStatus}>
          <span
            className={`${styles.statusDot} ${
              solved
                ? styles.statusDotSolved
                : solving || busyAction === "analyze"
                  ? styles.statusDotSolving
                  : ""
            }`}
          />
          <span>{statusText}</span>
        </div>
      </div>

      {/* ── Workspace ── */}
      <div className={styles.workspace}>
        <div className={styles.visualColumn}>
          <ImageWorkbench
            analysis={analysis}
            onFileSelected={handleFileSelected}
            onSelectSample={handleSelectSample}
            preview={preview}
            samples={demoSamples}
            showDebug={showDebug}
            solverResult={solverResult}
            toggleDebug={setShowDebug}
          />
        </div>

        <div className={styles.dataColumn}>
          <SolverResults
            bufferSize={editablePuzzle.bufferSize}
            onBufferSizeChange={(size) => {
              setEditablePuzzle((p) => ({ ...p, bufferSize: size }));
              setSolverResult(null);
              setRevealed(0);
            }}
            revealed={revealed}
            solverResult={solverResult}
          />

          <PuzzleEditor
            analysis={analysis}
            onChange={setEditablePuzzle}
            onMatrixSizeChange={handleMatrixSizeChange}
            onRestoreExtracted={handleRestoreExtracted}
            puzzle={editablePuzzle}
            revealed={revealed}
            solverResult={solverResult}
          />

          {hasNotes && (
            <section className={styles.notesCard}>
              <p className={styles.notesTitle}>Analysis Notes</p>
              {error && <p className={styles.errorText}>{error}</p>}
              {isPending && <p className={styles.pendingText}>Updating workspace…</p>}
              {warnings.length > 0 && (
                <ul className={styles.warningList}>
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className={styles.footer}>
        <span>SESSION 0XA47F · CLIENT-ONLY · STATIC EXPORT</span>
        <span>BREACH-SOLVER · v0.4.1 · {statusText}</span>
      </footer>
    </div>
  );
}
