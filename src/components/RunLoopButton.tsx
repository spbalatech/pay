"use client";

import { useState, useTransition } from "react";
import { runLoopAction } from "@/app/actions";

export function RunLoopButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="btn-row" style={{ alignItems: "center" }}>
      <button
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            const r = await runLoopAction();
            setResult(`${r.scored} orders scored · ${r.watches} watches · ${r.decisions} disputes assessed`);
          })
        }
      >
        {pending ? "Running…" : "Run one pass"}
      </button>
      {result ? <span className="tile-note">{result}</span> : null}
    </div>
  );
}
