'use client';
/* eslint-disable @next/next/no-img-element */

import JSZip from "jszip";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { analyzeBreachImage } from "@/lib/analysis/extract";
import { BREACH_CODES, type BreachCode, type CodeValue } from "@/lib/types/breach";
import styles from "@/styles/ground-truth-page.module.scss";

type LabelChoice = BreachCode | "skip";

interface LabeledToken {
  imageStem: string;
  imageFile: string;
  panel: "matrix" | "sequence";
  row: number;
  col: number;
  maskDataUrl: string;
  ocrValue: CodeValue;
  ocrConfidence: number;
  label: LabelChoice | null;
}

type Phase = "upload" | "analyzing" | "labeling" | "done";

const KEY_MAP: Record<string, LabelChoice> = {
  "1": "1C",
  "2": "55",
  "3": "7A",
  "4": "BD",
  "5": "E9",
  "6": "FF",
  s: "skip",
  S: "skip",
};

function stemFromName(name: string): string {
  // FNV-1a 32-bit — short, deterministic, unique per filename
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function tokenFileName(t: LabeledToken): string {
  return `${t.imageStem}_${t.panel}_r${t.row}_c${t.col}`;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export function GroundTruthPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCountRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [tokens, setTokens] = useState<LabeledToken[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [analyzeProgress, setAnalyzeProgress] = useState({ done: 0, total: 0, status: "" });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const addFiles = useCallback((incoming: File[]) => {
    const images = incoming.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      const novel = images.filter((f) => !existing.has(f.name));
      return [...prev, ...novel];
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current++;
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current--;
    if (dragCountRef.current === 0) setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current = 0;
    setDragActive(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    e.target.value = "";
  }, [addFiles]);

  const runAnalysis = useCallback(async () => {
    if (files.length === 0) return;
    setPhase("analyzing");
    setErrorMsg(null);
    setAnalyzeProgress({ done: 0, total: files.length, status: "" });

    const collected: LabeledToken[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const src = URL.createObjectURL(file);
      const stem = stemFromName(file.name);

      try {
        const result = await analyzeBreachImage({
          src,
          name: file.name,
          onProgress: (msg) => setAnalyzeProgress({ done: i, total: files.length, status: msg }),
        });

        for (const t of result.debug.matrixTokens) {
          collected.push({
            imageStem: stem,
            imageFile: file.name,
            panel: "matrix",
            row: t.row,
            col: t.col,
            maskDataUrl: t.maskDataUrl,
            ocrValue: t.value,
            ocrConfidence: t.confidence,
            label: (t.value as BreachCode | "") !== "" ? (t.value as BreachCode) : null,
          });
        }
        for (const t of result.debug.sequenceTokens) {
          collected.push({
            imageStem: stem,
            imageFile: file.name,
            panel: "sequence",
            row: t.row,
            col: t.col,
            maskDataUrl: t.maskDataUrl,
            ocrValue: t.value,
            ocrConfidence: t.confidence,
            label: (t.value as BreachCode | "") !== "" ? (t.value as BreachCode) : null,
          });
        }
      } catch (err) {
        setErrorMsg(`Failed on ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        URL.revokeObjectURL(src);
      }

      setAnalyzeProgress({ done: i + 1, total: files.length, status: "" });
    }

    if (collected.length === 0) {
      setErrorMsg("No cells were extracted from the provided images.");
      setPhase("upload");
      return;
    }

    setTokens(collected);
    setCurrentIndex(0);
    setPhase("labeling");
  }, [files]);

  const applyLabel = useCallback((choice: LabelChoice) => {
    setTokens((prev) => {
      const next = [...prev];
      next[currentIndex] = { ...next[currentIndex], label: choice };
      return next;
    });
    setCurrentIndex((i) => Math.min(i + 1, tokens.length - 1));
  }, [currentIndex, tokens.length]);

  const goToPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  const goToNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, tokens.length - 1));
  }, [tokens.length]);

  const finishLabeling = useCallback(() => {
    setPhase("done");
  }, []);

  useEffect(() => {
    if (phase !== "labeling") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      const choice = KEY_MAP[e.key];
      if (choice) {
        e.preventDefault();
        applyLabel(choice);
        return;
      }
      if (e.key === "ArrowLeft") { e.preventDefault(); goToPrev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); goToNext(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, applyLabel, goToPrev, goToNext]);

  const exportZip = useCallback(async () => {
    setExporting(true);
    try {
      const zip = new JSZip();
      const gtFolder = zip.folder("ground_truth")!;
      const skipFolder = zip.folder("skipped")!;

      const fileMap: Record<string, string> = {};

      await Promise.all(
        tokens.map(async (t) => {
          fileMap[t.imageStem] = t.imageFile;
          const name = tokenFileName(t);
          const blob = await dataUrlToBlob(t.maskDataUrl);
          if (t.label === "skip" || t.label === null) {
            skipFolder.file(`${name}.png`, blob);
          } else {
            gtFolder.file(`${name}.png`, blob);
            gtFolder.file(`${name}.gt.txt`, t.label);
          }
        }),
      );

      zip.file("file-map.json", JSON.stringify(fileMap, null, 2));

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ground_truth.zip";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [tokens]);

  const labeled = tokens.filter((t) => t.label !== null && t.label !== "skip").length;
  const skipped = tokens.filter((t) => t.label === "skip").length;
  const unlabeled = tokens.filter((t) => t.label === null).length;
  const current = tokens[currentIndex];
  const allLabeled = unlabeled === 0;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.panelId}>GT</span>
          <span className={styles.panelTitle}>Ground Truth Generator</span>
        </div>
        <div className={styles.headerRight}>
          <Link href="/" className={styles.btn}>← App</Link>
        </div>
      </header>

      {/* ── Upload phase ─────────────────────────────────────────────────── */}
      {phase === "upload" && (
        <div className={styles.body}>
          <div
            className={`${styles.dropZone} ${dragActive ? styles.dragActive : ""}`}
            onDragEnter={handleDragEnter}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <p className={styles.dropTitle}>Drop breach screenshots here</p>
            <p className={styles.dropHint}>or click to browse — multiple files accepted</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className={styles.hidden}
              onChange={handleFileInput}
            />
          </div>

          {files.length > 0 && (
            <div className={styles.fileList}>
              <div className={styles.fileListHeader}>
                <span>{files.length} image{files.length !== 1 ? "s" : ""} queued</span>
              </div>
              {files.map((f, i) => (
                <div key={f.name} className={styles.fileRow}>
                  <span className={styles.fileName}>{f.name}</span>
                  <button className={styles.removeBtn} onClick={() => removeFile(i)}>✕</button>
                </div>
              ))}
              <div className={styles.fileListFooter}>
                <button className={`${styles.btn} ${styles.btnHot}`} onClick={runAnalysis}>
                  Analyze All →
                </button>
              </div>
            </div>
          )}

          {errorMsg && <div className={styles.errorBar}>{errorMsg}</div>}
        </div>
      )}

      {/* ── Analyzing phase ───────────────────────────────────────────────── */}
      {phase === "analyzing" && (
        <div className={styles.body}>
          <div className={styles.analysisStatus}>
            <p className={styles.analysisTitle}>Analyzing images…</p>
            <p className={styles.analysisSub}>
              {analyzeProgress.done} / {analyzeProgress.total} complete
              {analyzeProgress.status ? ` — ${analyzeProgress.status}` : ""}
            </p>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${(analyzeProgress.done / Math.max(analyzeProgress.total, 1)) * 100}%` }}
              />
            </div>
          </div>
          {errorMsg && <div className={styles.errorBar}>{errorMsg}</div>}
        </div>
      )}

      {/* ── Labeling phase ────────────────────────────────────────────────── */}
      {phase === "labeling" && current && (
        <div className={styles.body}>
          <div className={styles.progressStrip}>
            <span className={styles.progressText}>
              Cell <strong>{currentIndex + 1}</strong> / {tokens.length}
            </span>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${((currentIndex + 1) / tokens.length) * 100}%` }}
              />
            </div>
            <span className={styles.progressMeta}>
              {labeled} labeled · {skipped} skipped · {unlabeled} remaining
            </span>
          </div>

          <div className={styles.labelArea}>
            <div className={styles.cellMeta}>
              <span className={styles.cellStem}>{current.imageStem}</span>
              <span className={styles.cellDot}>·</span>
              <span className={styles.cellPanel}>{current.panel}</span>
              <span className={styles.cellDot}>·</span>
              <span className={styles.cellCoord}>row {current.row} col {current.col}</span>
            </div>

            <div className={styles.cellRow}>
              <div className={styles.cellImageWrap}>
                <img
                  src={current.maskDataUrl}
                  alt={`cell ${current.row},${current.col}`}
                  className={styles.cellImage}
                />
              </div>
              <div className={styles.cellOcr}>
                <span className={styles.ocrLabel}>OCR</span>
                <span className={styles.ocrValue}>{current.ocrValue || "—"}</span>
                <span className={styles.ocrConf}>{Math.round(current.ocrConfidence * 100)}%</span>
              </div>
            </div>

            <div className={styles.codeButtons}>
              {BREACH_CODES.map((code, i) => (
                <button
                  key={code}
                  className={`${styles.codeBtn} ${current.label === code ? styles.codeBtnActive : ""}`}
                  onClick={() => applyLabel(code)}
                >
                  <span className={styles.codeBtnKey}>{i + 1}</span>
                  {code}
                </button>
              ))}
            </div>

            <button
              className={`${styles.skipBtn} ${current.label === "skip" ? styles.skipBtnActive : ""}`}
              onClick={() => applyLabel("skip")}
            >
              <span className={styles.codeBtnKey}>S</span>
              Skip — invalid / blank
            </button>
          </div>

          <div className={styles.navBar}>
            <button className={styles.btn} onClick={goToPrev} disabled={currentIndex === 0}>
              ← Prev
            </button>
            <div className={styles.navSpacer} />
            {allLabeled ? (
              <button className={`${styles.btn} ${styles.btnHot}`} onClick={finishLabeling}>
                Finish & Export →
              </button>
            ) : (
              <button className={styles.btn} onClick={goToNext} disabled={currentIndex === tokens.length - 1}>
                Next →
              </button>
            )}
          </div>

          <div className={styles.keyHint}>
            Keyboard: <kbd>1</kbd>–<kbd>6</kbd> to label · <kbd>S</kbd> to skip · <kbd>←</kbd><kbd>→</kbd> to navigate
          </div>
        </div>
      )}

      {/* ── Done phase ────────────────────────────────────────────────────── */}
      {phase === "done" && (
        <div className={styles.body}>
          <div className={styles.donePanel}>
            <p className={styles.doneTitle}>Labeling complete</p>
            <div className={styles.doneSummary}>
              <div className={styles.doneStat}>
                <span className={styles.doneStatValue}>{labeled}</span>
                <span className={styles.doneStatLabel}>labeled</span>
              </div>
              <div className={styles.doneStat}>
                <span className={styles.doneStatValue}>{skipped}</span>
                <span className={styles.doneStatLabel}>skipped</span>
              </div>
            </div>
            <p className={styles.doneHint}>
              ZIP contains <code>ground_truth/</code> with PNG + <code>.gt.txt</code> pairs
              {skipped > 0 && <> and <code>skipped/</code> with PNG-only files</>}.
            </p>
            <button
              className={`${styles.btn} ${styles.btnHot}`}
              onClick={exportZip}
              disabled={exporting}
            >
              {exporting ? "Building ZIP…" : "Export ZIP"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
