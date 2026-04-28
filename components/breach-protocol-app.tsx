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
  const [status, setStatus] = useState(
    "Load a screenshot or choose a demo sample to begin.",
  );
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [busyAction, setBusyAction] = useState<"analyze" | "solve" | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const uploadUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (uploadUrlRef.current) {
        URL.revokeObjectURL(uploadUrlRef.current);
      }
    };
  }, []);

  const warnings = analysis?.warnings ?? [];
  const canSolve = useMemo(
    () => validatePuzzle(editablePuzzle).length === 0,
    [editablePuzzle],
  );

  const setPreviewSource = (nextPreview: PreviewSource | null) => {
    if (uploadUrlRef.current && uploadUrlRef.current !== nextPreview?.src) {
      URL.revokeObjectURL(uploadUrlRef.current);
      uploadUrlRef.current = null;
    }

    if (nextPreview?.origin === "upload") {
      uploadUrlRef.current = nextPreview.src;
    }

    setPreview(nextPreview);
  };

  const handleFileSelected = (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    setPreviewSource({ src: objectUrl, name: file.name, origin: "upload" });
    setAnalysis(null);
    setSolverResult(null);
    setError(null);
    setStatus(`Loaded ${file.name}. Run analysis when you're ready.`);
  };

  const handleSelectSample = (sampleId: string) => {
    const sample = demoSamples.find((entry) => entry.id === sampleId);
    if (!sample) {
      return;
    }

    setPreviewSource({ src: sample.src, name: sample.label, origin: "sample" });
    setAnalysis(null);
    setSolverResult(null);
    setError(null);
    setStatus(`${sample.label} is loaded. Run analysis to extract the puzzle.`);
  };

  const handleAnalyze = async () => {
    if (!preview) {
      setError("Load a screenshot before running analysis.");
      return;
    }

    setBusyAction("analyze");
    setError(null);
    setSolverResult(null);

    try {
      const result = await analyzeBreachImage({
        src: preview.src,
        name: preview.name,
        onProgress: (message) => setStatus(message),
      });

      startTransition(() => {
        setAnalysis(result);
        setEditablePuzzle(result.puzzle);
        setShowDebug(false);
        setStatus(
          result.warnings.length
            ? "Analysis completed with warnings. Review the extracted puzzle before solving."
            : "Analysis completed. Review the extracted puzzle and run the solver.",
        );
      });
    } catch (analysisError) {
      const message =
        analysisError instanceof Error
          ? analysisError.message
          : "The screenshot could not be analyzed.";
      setError(message);
      setStatus("Analysis failed. Try another crop or correct the puzzle manually.");
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
            ? `Solved. ${result.matchedSequences.length} sequence(s) can be completed within the buffer.`
            : "Solved. No full sequence fits the current buffer, but the best partial path is shown.",
        );
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleReset = () => {
    setPreviewSource(null);
    setAnalysis(null);
    setEditablePuzzle(createEmptyPuzzle(6));
    setSolverResult(null);
    setError(null);
    setShowDebug(false);
    setStatus("State reset. Load a screenshot or choose a demo sample.");
  };

  const handleCreateManual = () => {
    setAnalysis(null);
    setSolverResult(null);
    setError(null);
    setShowDebug(false);
    setEditablePuzzle(createEmptyPuzzle(6));
    setStatus("Manual puzzle mode is ready. Fill in the matrix, sequences, and buffer size.");
  };

  const handleRestoreExtracted = () => {
    if (!analysis) {
      return;
    }

    setEditablePuzzle(analysis.puzzle);
    setSolverResult(null);
    setError(null);
    setStatus("Restored the latest extracted values.");
  };

  const handleMatrixSizeChange = (size: number) => {
    setEditablePuzzle((current) => ({
      ...current,
      matrix: resizeMatrix(current.matrix, size),
    }));
    setSolverResult(null);
  };

  return (
    <main className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Static Export Next.js Tool</p>
          <h1>Cyberpunk 2077 Breach Protocol Solver</h1>
          <p className={styles.heroText}>
            Upload a breach screenshot, extract the buffer, matrix, and daemon
            sequences fully in the browser, then solve the best legal path with
            editable fallback controls when OCR needs help.
          </p>
        </div>
        <div className={styles.heroStats}>
          <div>
            <span>Pipeline</span>
            <strong>OpenCV.js + OCR</strong>
          </div>
          <div>
            <span>Runtime</span>
            <strong>Client-only</strong>
          </div>
          <div>
            <span>Export</span>
            <strong>Static</strong>
          </div>
        </div>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.actions}>
          <button
            className={styles.primaryButton}
            disabled={!preview || busyAction !== null}
            onClick={handleAnalyze}
            type="button"
          >
            {busyAction === "analyze" ? "Analyzing..." : "Analyze Screenshot"}
          </button>
          <button
            className={styles.secondaryButton}
            disabled={!canSolve || busyAction !== null}
            onClick={handleSolve}
            type="button"
          >
            {busyAction === "solve" ? "Solving..." : "Solve Best Path"}
          </button>
          <button className={styles.ghostButton} onClick={handleCreateManual} type="button">
            Blank Puzzle
          </button>
          <button className={styles.ghostButton} onClick={handleReset} type="button">
            Reset
          </button>
        </div>
        <div className={styles.statusArea}>
          <span className={styles.statusLabel}>Status</span>
          <span className={styles.statusValue}>{status}</span>
        </div>
      </section>

      <section className={styles.workspace}>
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
          <PuzzleEditor
            analysis={analysis}
            onChange={setEditablePuzzle}
            onMatrixSizeChange={handleMatrixSizeChange}
            onRestoreExtracted={handleRestoreExtracted}
            puzzle={editablePuzzle}
          />

          <SolverResults analysis={analysis} puzzle={editablePuzzle} solverResult={solverResult} />

          {(warnings.length > 0 || error || isPending) && (
            <section className={styles.notesCard}>
              <header className={styles.sectionHeader}>
                <h2>Analysis Notes</h2>
              </header>
              {error && <p className={styles.errorText}>{error}</p>}
              {isPending && <p className={styles.pendingText}>Updating the workspace...</p>}
              {warnings.length > 0 && (
                <ul className={styles.warningList}>
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </section>
    </main>
  );
}
