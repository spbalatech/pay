"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Right-hand panel for a selected grid row. Keeps the queue visible beside the
 * detail instead of pushing the detail below a tall grid. Esc or the backdrop
 * closes it; focus moves into the panel so keyboard users land on it.
 */
export function Drawer({
  open,
  onClose,
  title,
  kicker,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  kicker?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Details" tabIndex={-1} ref={panel}>
        <header className="drawer-head">
          <div>
            {kicker ? <div className="drawer-kicker">{kicker}</div> : null}
            <h2 className="drawer-title">{title}</h2>
          </div>
          <button className="btn drawer-close" onClick={onClose} aria-label="Close panel">
            ✕
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <footer className="drawer-foot">{footer}</footer> : null}
      </aside>
    </>
  );
}
