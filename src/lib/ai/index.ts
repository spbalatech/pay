import { env } from "@/lib/env";
import { anthropicProvider } from "./anthropic";
import { ollamaProvider } from "./ollama";
import { NoProviderError, type AIProvider, type GenerateOptions, type ProviderName, type StructuredOptions } from "./types";
import type { z } from "zod";

export type { Tier, ProviderName } from "./types";
export { NoProviderError } from "./types";

/**
 * Provider selection.
 *
 * `auto` prefers a configured Anthropic key, falls back to a local Ollama if
 * one is running, and otherwise reports that no provider is available — which
 * is a supported state, not an error, because only two of the four agents
 * need a model at all.
 */
let cached: { provider: AIProvider | null; at: number } | null = null;
const TTL_MS = 30_000;

export async function resolveProvider(force = false): Promise<AIProvider | null> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.provider;

  const choice = env().AEGIS_AI_PROVIDER;
  let provider: AIProvider | null = null;

  if (choice === "anthropic") {
    provider = (await anthropicProvider.available()) ? anthropicProvider : null;
  } else if (choice === "ollama") {
    provider = (await ollamaProvider.available()) ? ollamaProvider : null;
  } else if (choice === "auto") {
    if (await anthropicProvider.available()) provider = anthropicProvider;
    else if (await ollamaProvider.available()) provider = ollamaProvider;
  }

  cached = { provider, at: Date.now() };
  return provider;
}

export async function aiAvailable(): Promise<boolean> {
  return (await resolveProvider()) !== null;
}

export type AIStatus = {
  available: boolean;
  provider: ProviderName;
  reasoning: string | null;
  fast: string | null;
  /** Why nothing is available, phrased for the person reading the console. */
  hint: string | null;
};

export async function aiStatus(): Promise<AIStatus> {
  const p = await resolveProvider();
  if (!p) {
    const choice = env().AEGIS_AI_PROVIDER;
    return {
      available: false,
      provider: "none",
      reasoning: null,
      fast: null,
      hint:
        choice === "ollama"
          ? `No Ollama server at ${env().OLLAMA_BASE_URL}. Start it with \`ollama serve\` and pull a model.`
          : choice === "anthropic"
            ? "ANTHROPIC_API_KEY is not set."
            : "Set ANTHROPIC_API_KEY, or run Ollama locally and set AEGIS_AI_PROVIDER=ollama.",
    };
  }
  const d = p.describe();
  return { available: true, provider: d.provider, reasoning: d.reasoning, fast: d.fast, hint: null };
}

/* ------------------------------------------------------- call surface */

export async function generate(opts: GenerateOptions): Promise<string> {
  const p = await resolveProvider();
  if (!p) throw new NoProviderError();
  return p.generate(opts);
}

export async function generateStructured<T extends z.ZodTypeAny>(
  opts: StructuredOptions<T>,
): Promise<z.infer<T>> {
  const p = await resolveProvider();
  if (!p) throw new NoProviderError();
  return p.generateStructured(opts);
}
