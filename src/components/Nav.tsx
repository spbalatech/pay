"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Overview", phase: "" },
  { href: "/orders", label: "Order risk", phase: "prevent", key: "orders" },
  { href: "/watchlist", label: "Watchlist", phase: "prevent", key: "watches" },
  { href: "/disputes", label: "Disputes", phase: "defend", key: "disputes" },
  { href: "/rulebook", label: "Rulebook", phase: "learn", key: "rules" },
  { href: "/audit", label: "Audit log", phase: "" },
] as const;

export function Nav({ counts }: { counts: Record<string, number> }) {
  const pathname = usePathname();

  return (
    <nav className="sidebar">
      <div className="brand">
        <span className="brand-mark">Aegis</span>
        <span className="brand-sub">chargeback defense</span>
      </div>

      {LINKS.map((l) => {
        const active = pathname === l.href;
        const count = "key" in l ? counts[l.key] : undefined;
        return (
          <Link key={l.href} href={l.href} className="navlink" data-active={active}>
            <span>
              {l.label}
              {l.phase ? <div className="phase">{l.phase}</div> : null}
            </span>
            {count ? <span className="nav-count">{count}</span> : null}
          </Link>
        );
      })}

      <ThemeToggle />
    </nav>
  );
}
