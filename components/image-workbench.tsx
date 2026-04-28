'use client';
/* eslint-disable @next/next/no-img-element */

import { useMemo, useRef, useState } from "react";

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
  const [dragActive, setDragActive] = useState(false);

  const pathPoints = useMemo(() => {
    if (!analysis || !solverResult) {
      return [];
    }

    const matrixTokens = new Map(
      analysis.debug.matrixTokens.map((token) => [tokenKey(token.row, token.col), token.center]),
    );

    return solverResult.path
      .map((step) => matrixTokens.get(tokenKey(step.row, step.col)))
      .filter((value): value is { x: number; y: number } => Boolean(value));
  }, [analysis, solverResult]);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) {
      return;
    }

    onFileSelected(file);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    handleFiles(event.dataTransfer.files);
  };

  const imageWidth = analysis?.image.width ?? 1600;
  const imageHeight = analysis?.image.height ?? 900;

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Image Input</p>
          <h2>Screenshot Workbench</h2>
        </div>
        {analysis && (
          <label className={styles.debugToggle}>
            <input
              checked={showDebug}
              onChange={(event) => toggleDebug(event.target.checked)}
              type="checkbox"
            />
            <span>Debug overlay</span>
          </label>
        )}
      </header>

      <div
        className={`${styles.stage} ${dragActive ? styles.stageActive : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget === event.target) {
            setDragActive(false);
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        role="presentation"
      >
        <input
          accept="image/*"
          hidden
          onChange={(event) => handleFiles(event.target.files)}
          ref={inputRef}
          type="file"
        />

        {preview ? (
          <div className={styles.previewFrame}>
            <img alt={preview.name} className={styles.previewImage} src={preview.src} />
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
                    key={`sequence-${token.row}-${token.col}`}
                    width={token.rect.width}
                    x={token.rect.x}
                    y={token.rect.y}
                  />
                ))}

              {showDebug &&
                analysis?.debug.bufferSlots.map((slot, index) => (
                  <rect
                    className={styles.bufferRect}
                    height={slot.height}
                    key={`slot-${index}`}
                    width={slot.width}
                    x={slot.x}
                    y={slot.y}
                  />
                ))}

              {pathPoints.length > 1 && (
                <polyline
                  className={styles.pathLine}
                  points={pathPoints.map((point) => `${point.x},${point.y}`).join(" ")}
                />
              )}

              {pathPoints.map((point, index) => (
                <g key={`point-${index}`}>
                  <circle className={styles.pathDot} cx={point.x} cy={point.y} r={18} />
                  <text className={styles.pathLabel} x={point.x} y={point.y + 5}>
                    {index + 1}
                  </text>
                </g>
              ))}
            </svg>

            <div className={styles.previewMeta}>
              <span>{preview.origin === "sample" ? "Demo sample" : "Uploaded file"}</span>
              <strong>{preview.name}</strong>
            </div>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <p className={styles.emptyTitle}>Drop a breach screenshot here</p>
            <p className={styles.emptyText}>
              Drag and drop an image, browse your files, or pick one of the
              bundled samples below.
            </p>
            <button className={styles.uploadButton} type="button">
              Choose Screenshot
            </button>
          </div>
        )}
      </div>

      <div className={styles.sampleRail}>
        {samples.map((sample) => (
          <button
            className={styles.sampleCard}
            key={sample.id}
            onClick={() => onSelectSample(sample.id)}
            type="button"
          >
            <img alt={sample.label} src={sample.src} />
            <span>{sample.label}</span>
            <small>{sample.hint}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
