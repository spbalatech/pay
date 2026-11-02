"use client";

import type { ICellRendererParams } from "ag-grid-community";

/**
 * Status is never carried by color alone: every badge ships a glyph and a
 * word, so it survives CVD, grayscale print and forced-colors.
 */
export function TierBadge(p: ICellRendererParams) {
  if (!p.value) return null;
  const map: Record<string, { cls: string; glyph: string }> = {
    HOLD: { cls: "badge-critical", glyph: "■" },
    REVIEW: { cls: "badge-warning", glyph: "▲" },
    CLEAR: { cls: "badge-good", glyph: "●" },
  };
  const s = map[String(p.value)] ?? { cls: "badge-muted", glyph: "·" };
  return (
    <span className={`badge ${s.cls}`}>
      <span aria-hidden>{s.glyph}</span>
      {String(p.value).toLowerCase()}
    </span>
  );
}

export function RecommendationBadge(p: ICellRendererParams) {
  if (!p.value) return null;
  const v = String(p.value);
  const map: Record<string, { cls: string; glyph: string }> = {
    FIGHT: { cls: "badge-warning", glyph: "▲" },
    ACCEPT: { cls: "badge-muted", glyph: "·" },
    HOLD: { cls: "badge-critical", glyph: "■" },
    VERIFY: { cls: "badge-warning", glyph: "▲" },
    SHIP: { cls: "badge-good", glyph: "●" },
  };
  const s = map[v] ?? { cls: "badge-muted", glyph: "·" };
  return (
    <span className={`badge ${s.cls}`}>
      <span aria-hidden>{s.glyph}</span>
      {v.toLowerCase()}
    </span>
  );
}

export function SourceBadge(p: ICellRendererParams) {
  if (p.value === "LIVE_UNCAPTURED")
    return (
      <span
        className="badge badge-sim"
        title="Created at PayPal and fetchable by id, but capture needs browser approval, so the capture id is local."
      >
        live order
      </span>
    );
  if (p.value === "SIMULATED")
    return (
      <span className="badge badge-sim" title="Fixture: the PayPal sandbox cannot originate this record.">
        simulated
      </span>
    );
  return null;
}

/** Days until a dispute response deadline, with urgency as text, not hue. */
export function DueCell(p: ICellRendererParams) {
  if (!p.value) return <span style={{ color: "var(--ink-muted)" }}>—</span>;
  const days = Math.ceil((new Date(String(p.value)).getTime() - Date.now()) / 86_400_000);
  if (days < 0)
    return (
      <span className="badge badge-critical">
        <span aria-hidden>■</span>overdue
      </span>
    );
  if (days <= 2)
    return (
      <span className="badge badge-critical">
        <span aria-hidden>■</span>
        {days}d left
      </span>
    );
  if (days <= 5)
    return (
      <span className="badge badge-warning">
        <span aria-hidden>▲</span>
        {days}d left
      </span>
    );
  return <span style={{ color: "var(--ink-secondary)" }}>{days}d left</span>;
}

/** 0-100 meter. Track is a faint neutral so the fill carries the severity. */
export function ScoreCell(p: ICellRendererParams) {
  if (p.value === null || p.value === undefined) return null;
  const v = Number(p.value);
  const fill = v >= 70 ? "var(--critical)" : v >= 45 ? "var(--warning)" : "var(--good)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "100%" }}>
      <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 22, fontSize: 12 }}>{v}</span>
      <span
        style={{
          position: "relative",
          flex: 1,
          height: 4,
          borderRadius: 999,
          background: "color-mix(in srgb, var(--ink-muted) 22%, transparent)",
          overflow: "hidden",
        }}
      >
        <span
          style={{ position: "absolute", inset: 0, width: `${v}%`, borderRadius: 999, background: fill }}
        />
      </span>
    </span>
  );
}
