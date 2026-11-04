"use client";

import { useState, useTransition } from "react";
import { runLoopAction } from "@/app/actions";

export function RunLoopButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="run-loop">
      <button
        className="btn btn-primary btn-lg"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            const r = await runLoopAction();
            setResult(`Done: ${r.scored} new orders checked · ${r.watches} warnings · ${r.decisions} disputes assessed`);
          })
        }
      >
        {pending ? "Agents working…" : "▶ Run the agents"}
      </button>
      <span className="tile-note" role="status" aria-live="polite">
        {result ?? "Checks new orders, watches shipments and judges disputes"}
      </span>
    </div>
  );
}
