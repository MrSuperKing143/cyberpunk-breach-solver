'use client';
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";

import type { DemoSample } from "@/lib/sample-gallery";
import type { AnalysisResult, SolverResult } from "@/lib/types/breach";
import styles from "@/styles/image-workbench.module.scss";

interface PreviewSource {
  src: string;
  name: string;
  origin: "upload" | "sample";
}

interface ImageWorkbenchProps {
  analysis: AnalysisResult | null;
  onFileSelected: (file: File) => void;
  onSelectSample: (sampleId: string) => void;
  preview: PreviewSource | null;
  samples: DemoSample[];
  showDebug: boolean;
  solverResult: SolverResult | null;
  toggleDebug: (next: boolean) => void;
}

function tokenKey(row: number, col: number) {
  return `${row}:${col}`;
}

function boxBorderPoint(
  cx: number, cy: number,
  hw: number, hh: number,
  tx: number, ty: number,
): { x: number; y: number } {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function ImageWorkbench({
  analysis,
  onFileSelected,
  onSelectSample,
  preview,
  samples,
  showDebug,
  solverResult,
  toggleDebug,
}: ImageWorkbenchProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const pathPoints = useMemo(() => {
    if (!analysis || !solverResult) return [];
    const matrixTokens = new Map(
      analysis.debug.matrixTokens.map((t) => [tokenKey(t.row, t.col), t]),
    );
    return solverResult.path
      .map((step) => matrixTokens.get(tokenKey(step.row, step.col)))
      .filter((v): v is NonNullable<typeof v> => Boolean(v));
  }, [analysis, solverResult]);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    onFileSelected(file);
    setFlash("LOADED");
    setTimeout(() => setFlash(null), 1400);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    handleFiles(event.dataTransfer.files);
  };

  const handlePaste = async () => {
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith("image/"));
          if (type) {
            const blob = await item.getType(type);
            const file = new File([blob], "pasted.png", { type });
            onFileSelected(file);
            setFlash("PASTED");
            setTimeout(() => setFlash(null), 1400);
            return;
          }
        }
      }
      setFlash("NO IMG");
      setTimeout(() => setFlash(null), 1400);
    } catch {
      setFlash("NO IMG");
      setTimeout(() => setFlash(null), 1400);
    }
  };

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            onFileSelected(blob);
            setFlash("PASTED");
            setTimeout(() => setFlash(null), 1400);
            e.preventDefault();
            return;
          }
        }
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [onFileSelected]);

  const imageWidth = analysis?.image.width ?? 1600;
  const imageHeight = analysis?.image.height ?? 900;

  const activeSampleId = preview?.origin === "sample" ? preview.name : null;

  const pipelineStatus = analysis
    ? [
        ["LOAD", "OK"],
        ["DETECT", "OK"],
        ["SEGMENT", "OK"],
        ["OCR", `${Math.round(analysis.confidence * 100)}%`],
      ]
    : [
        ["LOAD", preview ? "OK" : "—"],
        ["DETECT", "—"],
        ["SEGMENT", "—"],
        ["OCR", "—"],
      ];

  const fileName = flash ?? (preview ? preview.name.toUpperCase() : "NO IMAGE LOADED");

  return (
    <section className={styles.panel}>
      {/* Title bar */}
      <div className={styles.panelTitle}>
        <div className={styles.panelTitleLeft}>
          <span className={styles.panelId}>A.01</span>
          <span>IMAGE PIPELINE</span>
        </div>
        <div className={styles.panelTitleRight}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleFiles(e.target.files)}
            style={{ display: "none" }}
          />
          <button
            className={`${styles.actionBtn} ${styles.actionBtnHot}`}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            ↑ LOAD IMAGE
          </button>
          <button className={styles.actionBtn} onClick={handlePaste} type="button">
            ⎘ PASTE
          </button>
          {analysis && (
            <label className={styles.debugToggle}>
              <input
                checked={showDebug}
                onChange={(e) => toggleDebug(e.target.checked)}
                type="checkbox"
              />
              <span>DEBUG</span>
            </label>
          )}
          <span className={`${styles.fileNameStatus} ${flash ? styles.flash : ""}`}>
            {fileName}
          </span>
        </div>
      </div>

      {/* Preview area */}
      <div
        className={`${styles.previewArea} ${dragActive ? styles.dragActive : ""}`}
        onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={(e) => { e.preventDefault(); if (e.currentTarget === e.target) setDragActive(false); }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        role="presentation"
      >
        <input
          ref={inputRef}
          accept="image/*"
          hidden
          onChange={(e) => handleFiles(e.target.files)}
          type="file"
        />

        {/* Hatch background */}
        <div className={styles.previewHatch} />

        {preview ? (
          <>
            <img
              alt={preview.name}
              className={styles.previewImage}
              src={preview.src}
            />
            <svg
              aria-hidden="true"
              className={styles.overlay}
              preserveAspectRatio="xMidYMid meet"
              viewBox={`0 0 ${imageWidth} ${imageHeight}`}
            >
              {showDebug &&
                Object.entries(analysis?.debug.panels ?? {}).map(([key, rect]) =>
                  rect ? (
                    <rect
                      className={styles.panelRect}
                      height={rect.height}
                      key={key}
                      width={rect.width}
                      x={rect.x}
                      y={rect.y}
                    />
                  ) : null,
                )}
              {showDebug &&
                analysis?.debug.matrixTokens.map((token) => (
                  <rect
                    className={styles.tokenRect}
                    height={token.rect.height}
                    key={`matrix-${token.row}-${token.col}`}
                    width={token.rect.width}
                    x={token.rect.x}
                    y={token.rect.y}
                  />
                ))}
              {showDebug &&
                analysis?.debug.sequenceTokens.map((token) => (
                  <rect
                    className={styles.sequenceRect}
                    height={token.rect.height}
                    key={`seq-${token.row}-${token.col}`}
                    width={token.rect.width}
                    x={token.rect.x}
                    y={token.rect.y}
                  />
                ))}
              {showDebug &&
                analysis?.debug.bufferSlots.map((slot, slotIdx) => (
                  <rect
                    className={styles.bufferRect}
                    height={slot.height}
                    key={`slot-${slotIdx}`}
                    width={slot.width}
                    x={slot.x}
                    y={slot.y}
                  />
                ))}
              {pathPoints.length > 1 && pathPoints.slice(0, -1).map((from, i) => {
                const to = pathPoints[i + 1];
                const start = boxBorderPoint(
                  from.center.x, from.center.y,
                  from.rect.width * 0.35, from.rect.height * 0.35,
                  to.center.x, to.center.y,
                );
                const end = boxBorderPoint(
                  to.center.x, to.center.y,
                  to.rect.width * 0.35, to.rect.height * 0.35,
                  from.center.x, from.center.y,
                );
                return (
                  <line
                    className={styles.pathLine}
                    key={`line-${i}`}
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                  />
                );
              })}
              {pathPoints.map((p, i) => {
                const cx = p.rect.x + p.rect.width * 0.5;
                const topY = p.rect.y + p.rect.height * 0.15;
                const arrowHW = p.rect.width * 0.14;
                const arrowH = p.rect.height * 0.16;
                return (
                  <g key={`box-${i}`}>
                    {i === 0 && (
                      <polygon
                        className={styles.pathArrow}
                        points={`${cx},${topY} ${cx - arrowHW},${topY - arrowH} ${cx + arrowHW},${topY - arrowH}`}
                      />
                    )}
                    <rect
                      className={styles.pathBox}
                      height={p.rect.height * 0.7}
                      width={p.rect.width * 0.7}
                      x={p.rect.x + p.rect.width * 0.15}
                      y={topY}
                    />
                  </g>
                );
              })}
            </svg>
          </>
        ) : (
          <div
            className={styles.emptyState}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className={styles.emptyInner}>
              <p className={styles.emptyTitle}>Drop screenshot here</p>
              <p className={styles.emptyHint}>Drag & drop · browse · paste</p>
              <button className={styles.uploadButton} type="button">
                CHOOSE FILE
              </button>
            </div>
          </div>
        )}

        {/* Corner labels */}
        <div className={styles.previewMeta}>
          <span>{"// EDGE_DETECT::CANNY (T=80,200)"}</span>
          <span>OCV.JS 4.10 · TESS 5.1</span>
        </div>
      </div>

      {/* Pipeline status strip */}
      <div className={styles.statusStrip}>
        {pipelineStatus.map(([label, value]) => (
          <div className={styles.statusCell} key={label}>
            <span className={styles.statusCellLabel}>{label}</span>
            <span className={value === "—" ? styles.statusCellPending : styles.statusCellValue}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Sample tray */}
      <div className={styles.sampleTray}>
        <div className={styles.sampleTrayLabel}>
          SAMPLES · {samples.length} ENTRIES
        </div>
        <div className={styles.sampleGrid}>
          {samples.map((sample) => (
            <button
              className={`${styles.sampleCard} ${
                activeSampleId === sample.label ? styles.sampleCardActive : ""
              }`}
              key={sample.id}
              onClick={() => onSelectSample(sample.id)}
              type="button"
            >
              <img alt={sample.label} src={sample.src} />
              <span
                className={`${styles.sampleCardLabel} ${
                  activeSampleId === sample.label ? styles.sampleCardLabelActive : ""
                }`}
              >
                {sample.id}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
