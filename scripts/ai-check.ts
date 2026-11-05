/**
 * Diagnoses model provider configuration.
 *
 *   npm run ai:check
 */
import "dotenv/config";
import { env } from "../src/lib/env";
import { aiStatus, resolveProvider, generate } from "../src/lib/ai";
import { anthropicProvider } from "../src/lib/ai/anthropic";
import { ollamaProvider } from "../src/lib/ai/ollama";
import { openrouterProvider } from "../src/lib/ai/openrouter";

async function main() {
  const e = env();
  console.log(`\nAEGIS_AI_PROVIDER = ${e.AEGIS_AI_PROVIDER}\n`);

  const anthropicOk = await anthropicProvider.available();
  console.log(`anthropic  ${anthropicOk ? "key set" : "no key"} · ${e.AEGIS_MODEL_REASONING} / ${e.AEGIS_MODEL_FAST}`);

  const openrouterOk = await openrouterProvider.available();
  console.log(
    `openrouter ${openrouterOk ? "key set" : "no key"} · ${e.OPENROUTER_MODEL}` +
      (e.OPENROUTER_MODEL_FAST ? ` / ${e.OPENROUTER_MODEL_FAST}` : ""),
  );

  const ollamaOk = await ollamaProvider.available();
  console.log(`ollama     ${ollamaOk ? "reachable" : "not reachable"} at ${e.OLLAMA_BASE_URL} · ${e.OLLAMA_MODEL}`);

  if (ollamaOk) {
    try {
      const res = await fetch(`${e.OLLAMA_BASE_URL.replace(/\/$/, "")}/api/tags`);
      const { models } = (await res.json()) as { models?: Array<{ name: string }> };
      const names = (models ?? []).map((m) => m.name);
      console.log(`           models: ${names.length ? names.join(", ") : "none pulled"}`);
      if (names.length && !names.includes(e.OLLAMA_MODEL)) {
        console.log(`           ! ${e.OLLAMA_MODEL} is not pulled. Run: ollama pull ${e.OLLAMA_MODEL}`);
      }
    } catch {
      /* listing is a convenience; availability already proved the server */
    }
  }

  const status = await aiStatus();
  console.log(`\nselected   ${status.provider}${status.hint ? ` — ${status.hint}` : ""}`);

  if (!(await resolveProvider())) {
    console.log("\nThe three scoring agents still run without a provider. Only the Learner stops.\n");
    return;
  }

  process.stdout.write("\nround trip… ");
  const reply = await generate({
    tier: "fast",
    maxTokens: 40,
    system: "Reply with exactly three words.",
    prompt: "Say that you are working.",
  });
  console.log(`ok → "${reply}"\n`);
}

main().catch((err) => {
  console.error(`\nfailed: ${err}\n`);
  process.exit(1);
});
