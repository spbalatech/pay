"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { Icon, NAV_ICON } from "./icons";

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
      <Link href="/" className="brand" aria-label="Aegis home">
        <svg className="brand-logo" viewBox="0 0 24 24" width="26" height="26" aria-hidden>
          <path d="M12 2 3.5 5.5v6c0 5 3.6 9.3 8.5 10.5 4.9-1.2 8.5-5.5 8.5-10.5v-6L12 2Z" fill="var(--prevent)" />
          <path d="m8 12.2 2.7 2.7L16.3 9.3" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>
          <span className="brand-mark">Aegis</span>
          <span className="brand-sub">chargeback defense</span>
        </span>
      </Link>

      {LINKS.map((l) => {
        const active = pathname === l.href;
        const count = "key" in l ? counts[l.key] : undefined;
        return (
          <Link key={l.href} href={l.href} className="navlink" data-active={active}>
            <span className="nav-label">
              <Icon as={NAV_ICON[l.href]} />
              <span>
                {l.label}
                {l.phase ? <div className="phase">{l.phase}</div> : null}
              </span>
            </span>
            {count ? <span className="nav-count">{count}</span> : null}
          </Link>
        );
      })}

      <div className="nav-foot">
        <span className="chip chip-paypal">Built on PayPal sandbox</span>
        <ThemeToggle />
      </div>
    </nav>
  );
}
