import type { ReactNode } from "react";

export function Hero({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="hero">
      <div className="hero-label">{label}</div>
      {/* Proportional figures: tabular-nums looks loose at display sizes. */}
      <div className="hero-value">{value}</div>
      {note ? <div className="hero-note">{note}</div> : null}
    </div>
  );
}

export function Tile({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {note ? <div className="tile-note">{note}</div> : null}
    </div>
  );
}

/**
 * Tall segmented bar: one whole (value protected) split into its two parts.
 * No baseline, so no end is square; a part at zero draws nothing. The legend
 * names the parts and repeats no numbers.
 */
export function SegmentedBar({
  parts,
}: {
  parts: Array<{ name: string; value: number; color: string }>;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) {
    return <div className="empty">Nothing protected yet. Run the agents to populate this.</div>;
  }

  return (
    <>
      <div className="segbar" role="img" aria-label={parts.map((p) => `${p.name}: $${p.value.toFixed(0)}`).join("; ")}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => {
            const share = p.value / total;
            return (
              <div
                key={p.name}
                className="segbar-part"
                style={{ flex: `${share} 1 0`, background: p.color }}
                title={`${p.name}: $${p.value.toLocaleString()} (${(share * 100).toFixed(0)}%)`}
              >
                {share > 0.14 ? `$${Math.round(p.value).toLocaleString()}` : null}
              </div>
            );
          })}
      </div>
      <div className="segbar-legend">
        {parts.map((p) => (
          <span key={p.name} className="segbar-key">
            <span className="segbar-swatch" style={{ background: p.color }} />
            {p.name}
          </span>
        ))}
      </div>
    </>
  );
}

export const money = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 10_000
      ? `$${(n / 1000).toFixed(1)}K`
      : `$${Math.round(n).toLocaleString()}`;

export const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
