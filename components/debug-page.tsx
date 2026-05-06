'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { analyzeBreachImage } from "@/lib/analysis/extract";
import type { AnalysisResult, DebugToken } from "@/lib/types/breach";
import styles from "@/styles/debug-page.module.scss";

type TokenPanel = "matrix" | "sequence";
interface SelectedToken { panel: TokenPanel; row: number; col: number }

function confColor(c: number): string {
  if (c >= 0.8) return "#d0ed57";
  if (c >= 0.5) return "#e8b020";
  return "#e84040";
}

function tokenKey(panel: string, row: number, col: number) {
  return `${panel}|${row}|${col}`;
}

function isSel(sel: SelectedToken | null, panel: TokenPanel, row: number, col: number) {
  return sel?.panel === panel && sel.row === row && sel.col === col;
}

export function DebugPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const dragCountRef = useRef(0);

  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    return () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); };
  }, []);

  const runAnalysis = useCallback(async (file: File) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const src = URL.createObjectURL(file);
    objectUrlRef.current = src;
    setPreview({ src, name: file.name });
    setBusy(true);
    setErrorMsg(null);
    setAnalysis(null);
    setSelected(null);
    setStatusMsg("");
    try {
      const result = await analyzeBreachImage({
        src,
        name: file.name,
        onProgress: (msg) => setStatusMsg(msg.toUpperCase()),
      });
      setAnalysis(result);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStatusMsg("");
    }
  }, []);

  const handleFiles = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (file) runAnalysis(file);
  }, [runAnalysis]);

  const handlePaste = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          const blob = await item.getType(type);
          runAnalysis(new File([blob], "pasted.png", { type }));
          return;
        }
      }
    } catch { /* clipboard access denied */ }
  }, [runAnalysis]);

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) { runAnalysis(blob); e.preventDefault(); return; }
        }
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [runAnalysis]);

  const copyJson = useCallback(() => {
    if (!analysis) return;
    navigator.clipboard.writeText(JSON.stringify(analysis.debug, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [analysis]);

  const selectToken = (panel: TokenPanel, row: number, col: number) => {
    setSelected((prev) => isSel(prev, panel, row, col) ? null : { panel, row, col });
  };

  useEffect(() => {
    if (!selected) return;
    const key = tokenKey(selected.panel, selected.row, selected.col);
    cardRefs.current[key]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const matrixDims = useMemo(() => {
    const tokens = analysis?.debug.matrixTokens;
    if (!tokens?.length) return null;
    return {
      rows: Math.max(...tokens.map((t) => t.row)) + 1,
      cols: Math.max(...tokens.map((t) => t.col)) + 1,
    };
  }, [analysis]);

  const seqRows = useMemo(() => {
    if (!analysis) return [];
    return analysis.debug.sequenceTokens.reduce<DebugToken[][]>((acc, t) => {
      (acc[t.row] ??= []).push(t);
      return acc;
    }, []);
  }, [analysis]);

  const imgW = analysis?.image.width ?? 1920;
  const imgH = analysis?.image.height ?? 1080;

  const stats: { label: string; value: string; color?: string }[] = analysis ? [
    { label: "CONFIDENCE", value: `${Math.round(analysis.confidence * 100)}%`, color: confColor(analysis.confidence) },
    { label: "MATRIX TOKENS", value: String(analysis.debug.matrixTokens.length) },
    { label: "SEQ TOKENS", value: String(analysis.debug.sequenceTokens.length) },
    { label: "BUFFER SLOTS", value: String(analysis.debug.bufferSlots.length) },
    { label: "WARNINGS", value: String(analysis.warnings.length), color: analysis.warnings.length ? "#e8b020" : undefined },
  ] : [];

  return (
    <div className={styles.root}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.panelId}>D.01</span>
          <span className={styles.panelTitle}>DEBUG PIPELINE</span>
          {busy && <span className={styles.badge}>{statusMsg || "ANALYZING…"}</span>}
          {errorMsg && <span className={`${styles.badge} ${styles.badgeErr}`}>{errorMsg}</span>}
        </div>
        <div className={styles.headerRight}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            className={`${styles.btn} ${styles.btnHot}`}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            ↑ LOAD IMAGE
          </button>
          <button className={styles.btn} onClick={handlePaste} type="button">
            ⎘ PASTE
          </button>
          <Link className={styles.btn} href="/">← MAIN APP</Link>
        </div>
      </div>

      {/* ── Image + overlay ── */}
      <div
        className={`${styles.imageArea} ${dragActive ? styles.dragActive : ""}`}
        onDragEnter={(e) => { e.preventDefault(); dragCountRef.current++; setDragActive(true); }}
        onDragLeave={(e) => { e.preventDefault(); dragCountRef.current--; if (dragCountRef.current === 0) setDragActive(false); }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); dragCountRef.current = 0; setDragActive(false); handleFiles(e.dataTransfer.files); }}
      >
        <div className={styles.hatch} />
        {preview ? (
          <>
            <img alt={preview.name} className={styles.previewImg} src={preview.src} />
            {analysis && (
              <svg
                aria-hidden
                className={styles.overlay}
                preserveAspectRatio="xMidYMid meet"
                viewBox={`0 0 ${imgW} ${imgH}`}
              >
                {/* Panel bounding boxes */}
                {Object.entries(analysis.debug.panels).map(([key, rect]) =>
                  rect ? (
                    <g key={key}>
                      <rect
                        x={rect.x} y={rect.y} width={rect.width} height={rect.height}
                        fill="none" stroke="#d0ed57" strokeWidth={3}
                        vectorEffect="non-scaling-stroke"
                      />
                      <text
                        x={rect.x + 6} y={rect.y + 15}
                        fill="#d0ed57" fontSize={13}
                        fontFamily="monospace" fontWeight="bold"
                        style={{ pointerEvents: "none" }}
                      >
                        {key.toUpperCase()}
                      </text>
                    </g>
                  ) : null
                )}
                {/* Buffer slots */}
                {analysis.debug.bufferSlots.map((slot, i) => (
                  <rect
                    key={`buf-${i}`}
                    x={slot.x} y={slot.y} width={slot.width} height={slot.height}
                    fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {/* Matrix tokens */}
                {analysis.debug.matrixTokens.map((t) => {
                  const sel = isSel(selected, "matrix", t.row, t.col);
                  const color = confColor(t.confidence);
                  return (
                    <g
                      key={`m-${t.row}-${t.col}`}
                      onClick={() => selectToken("matrix", t.row, t.col)}
                      style={{ cursor: "pointer" }}
                    >
                      <image
                        x={t.rect.x} y={t.rect.y} width={t.rect.width} height={t.rect.height}
                        href={t.maskDataUrl}
                        preserveAspectRatio="xMidYMid meet"
                        style={{ imageRendering: "pixelated", pointerEvents: "none" }}
                      />
                      <rect
                        x={t.rect.x} y={t.rect.y} width={t.rect.width} height={t.rect.height}
                        fill="none"
                        stroke={sel ? "#ffffff" : color}
                        strokeWidth={sel ? 2.5 : 1.5}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })}
                {/* Sequence tokens */}
                {analysis.debug.sequenceTokens.map((t) => {
                  const sel = isSel(selected, "sequence", t.row, t.col);
                  const color = confColor(t.confidence);
                  return (
                    <g
                      key={`s-${t.row}-${t.col}`}
                      onClick={() => selectToken("sequence", t.row, t.col)}
                      style={{ cursor: "pointer" }}
                    >
                      <image
                        x={t.rect.x} y={t.rect.y} width={t.rect.width} height={t.rect.height}
                        href={t.maskDataUrl}
                        preserveAspectRatio="xMidYMid meet"
                        style={{ imageRendering: "pixelated", pointerEvents: "none" }}
                      />
                      <rect
                        x={t.rect.x} y={t.rect.y} width={t.rect.width} height={t.rect.height}
                        fill="none"
                        stroke={sel ? "#ffffff" : color}
                        strokeWidth={sel ? 2.5 : 1.5}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })}
              </svg>
            )}
          </>
        ) : (
          <div
            className={styles.emptyState}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          >
            <p className={styles.emptyTitle}>Drop a screenshot here</p>
            <p className={styles.emptyHint}>Drag & drop · browse · paste</p>
          </div>
        )}
        <div className={styles.legend}>
          <span style={{ color: "#d0ed57" }}>■ ≥80%</span>
          <span style={{ color: "#e8b020" }}>■ 50–79%</span>
          <span style={{ color: "#e84040" }}>■ &lt;50%</span>
        </div>
      </div>

      {/* ── Stats strip ── */}
      {analysis && (
        <div className={styles.statsStrip}>
          {stats.map(({ label, value, color }) => (
            <div className={styles.statCell} key={label}>
              <span className={styles.statLabel}>{label}</span>
              <span className={styles.statValue} style={color ? { color } : undefined}>{value}</span>
            </div>
          ))}
          <div className={styles.statCellEnd}>
            <button className={styles.btn} onClick={copyJson} type="button">
              {copied ? "✓ COPIED" : "⎘ COPY JSON"}
            </button>
          </div>
        </div>
      )}

      {/* ── Warnings ── */}
      {analysis && analysis.warnings.length > 0 && (
        <div className={styles.warningsBar}>
          {analysis.warnings.map((w, i) => (
            <div className={styles.warningRow} key={i}>⚠ {w}</div>
          ))}
        </div>
      )}

      {/* ── Token card grids ── */}
      {analysis && (
        <div className={styles.tokenPanels}>
          <div className={styles.tokenSection}>
            <div className={styles.sectionHeader}>
              <span>MATRIX TOKENS</span>
              {matrixDims && (
                <span className={styles.sectionDim}>{matrixDims.rows}×{matrixDims.cols}</span>
              )}
              <span className={styles.sectionCount}>{analysis.debug.matrixTokens.length}</span>
            </div>
            <div
              className={styles.matrixGrid}
              style={{ "--n-cols": matrixDims?.cols ?? 6 } as React.CSSProperties}
            >
              {analysis.debug.matrixTokens.map((t) => {
                const key = tokenKey("matrix", t.row, t.col);
                return (
                  <TokenCard
                    key={key}
                    token={t}
                    panel="matrix"
                    selected={selected}
                    onSelect={selectToken}
                    cardRef={(el) => { cardRefs.current[key] = el; }}
                  />
                );
              })}
            </div>
          </div>

          <div className={styles.tokenSection}>
            <div className={styles.sectionHeader}>
              <span>SEQUENCE TOKENS</span>
              <span className={styles.sectionCount}>{analysis.debug.sequenceTokens.length}</span>
            </div>
            {seqRows.map((row, seqIdx) => (
              <div key={seqIdx} className={styles.seqRow}>
                <div className={styles.seqLabel}>SEQ {seqIdx}</div>
                <div className={styles.seqCards}>
                  {row.map((t) => {
                    const key = tokenKey("sequence", t.row, t.col);
                    return (
                      <TokenCard
                        key={key}
                        token={t}
                        panel="sequence"
                        selected={selected}
                        onSelect={selectToken}
                        cardRef={(el) => { cardRefs.current[key] = el; }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface TokenCardProps {
  token: DebugToken;
  panel: TokenPanel;
  selected: SelectedToken | null;
  onSelect: (panel: TokenPanel, row: number, col: number) => void;
  cardRef: (el: HTMLDivElement | null) => void;
}

function TokenCard({ token, panel, selected, onSelect, cardRef }: TokenCardProps) {
  const sel = isSel(selected, panel, token.row, token.col);
  const color = confColor(token.confidence);
  const pct = Math.round(token.confidence * 100);

  return (
    <div
      ref={cardRef}
      className={`${styles.card} ${sel ? styles.cardSel : ""}`}
      style={{ "--conf-color": color } as React.CSSProperties}
      onClick={() => onSelect(panel, token.row, token.col)}
      title={`[${token.row},${token.col}] raw:"${token.rawText}" → ${token.value || "?"} (${pct}%)`}
    >
      <img alt="" src={token.maskDataUrl} className={styles.cardMask} />
      <div className={styles.cardMeta}>
        <span className={styles.cardValue} style={{ color }}>{token.value || "—"}</span>
        <span className={styles.cardPct} style={{ color }}>{pct}%</span>
      </div>
    </div>
  );
}
