"use client";

import type { ICellRendererParams } from "ag-grid-community";
import { Minus } from "lucide-react";
import { Icon, BADGE_ICON } from "../icons";

/**
 * Status is never carried by color alone: every badge ships an icon and a
 * word, so it survives CVD, grayscale print and forced-colors. The icon also
 * says what the state means (a hand for hold, a truck for ship), not just how
 * severe it is.
 */
function Badge({ cls, code, label }: { cls: string; code: string; label: string }) {
  return (
    <span className={`badge ${cls}`}>
      <Icon as={BADGE_ICON[code] ?? Minus} size={12} />
      {label}
    </span>
  );
}

export function TierBadge(p: ICellRendererParams) {
  if (!p.value) return null;
  const cls: Record<string, string> = { HOLD: "badge-critical", REVIEW: "badge-warning", CLEAR: "badge-good" };
  const v = String(p.value);
  return <Badge cls={cls[v] ?? "badge-muted"} code={v} label={v.toLowerCase()} />;
}

export function RecommendationBadge(p: ICellRendererParams) {
  if (!p.value) return null;
  const v = String(p.value);
  const cls: Record<string, string> = {
    FIGHT: "badge-warning",
    ACCEPT: "badge-muted",
    HOLD: "badge-critical",
    VERIFY: "badge-warning",
    SHIP: "badge-good",
  };
  return <Badge cls={cls[v] ?? "badge-muted"} code={v} label={v.toLowerCase()} />;
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
  if (days < 0) return <Badge cls="badge-critical" code="OVERDUE" label="overdue" />;
  if (days <= 2) return <Badge cls="badge-critical" code="DUE_SOON" label={`${days}d left`} />;
  if (days <= 5) return <Badge cls="badge-warning" code="DUE_SOON" label={`${days}d left`} />;
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

/** Dispute lifecycle as a word plus icon: open cases are the ones to act on. */
export function StatusCell(p: ICellRendererParams) {
  if (!p.value) return null;
  const v = String(p.value);
  const map: Record<string, { cls: string; label: string }> = {
    OPEN: { cls: "badge-warning", label: "open" },
    WON: { cls: "badge-good", label: "won" },
    LOST: { cls: "badge-critical", label: "lost" },
    ACCEPTED: { cls: "badge-muted", label: "accepted" },
    WITH_PAYPAL: { cls: "badge-warning", label: "with PayPal" },
  };
  const s = map[v] ?? { cls: "badge-muted", label: v.toLowerCase() || "closed" };
  return <Badge cls={s.cls} code={v} label={s.label} />;
}
