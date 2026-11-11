import { env } from "@/lib/env";
import type { AIProvider, GenerateOptions, StructuredOptions, Tier } from "./types";
import type { z } from "zod";

/**
 * Models via Ollama: a local server, or Ollama's cloud (OLLAMA_BASE_URL=https://ollama.com
 * plus OLLAMA_API_KEY), which speaks the same API.
 *
 * Aegis is deliberately usable with no API key and no network: the three
 * scoring agents never needed a model, and the two jobs that do — drafting
 * and rule proposal — are small enough for an 8B class model to handle on a
 * laptop. Structured output uses Ollama's `format` parameter, which
 * constrains decoding to the JSON Schema rather than asking politely for
 * JSON, so small models stay on-schema.
 */

const baseUrl = () => env().OLLAMA_BASE_URL.replace(/\/$/, "");
const modelFor = (tier: Tier) =>
  tier === "fast" ? env().OLLAMA_MODEL_FAST || env().OLLAMA_MODEL : env().OLLAMA_MODEL;

const headers = (): Record<string, string> => {
  const key = env().OLLAMA_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
};

type ChatResponse = { message?: { content?: string }; error?: string };

async function chat(body: Record<string, unknown>, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers() },
      body: JSON.stringify({ stream: false, ...body }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    const json = (await res.json()) as ChatResponse;
    if (json.error) throw new Error(`Ollama: ${json.error}`);
    return (json.message?.content ?? "").trim();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Ollama did not respond within ${Math.round(timeoutMs / 1000)}s. A local model on CPU can be slow; ` +
          `raise AEGIS_OLLAMA_TIMEOUT_MS or use a smaller model.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const ollamaProvider: AIProvider = {
  name: "ollama",

  describe: () => ({
    provider: "ollama",
    reasoning: env().OLLAMA_MODEL,
    fast: env().OLLAMA_MODEL_FAST || env().OLLAMA_MODEL,
  }),

  async available() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${baseUrl()}/api/tags`, { headers: headers(), signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  },

  async generate(opts: GenerateOptions) {
    return chat(
      {
        model: modelFor(opts.tier ?? "reasoning"),
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.prompt },
        ],
        options: { temperature: 0.3, num_predict: opts.maxTokens ?? 1500 },
      },
      env().AEGIS_OLLAMA_TIMEOUT_MS,
    );
  },

  async generateStructured<T extends z.ZodTypeAny>(opts: StructuredOptions<T>): Promise<z.infer<T>> {
    // Two attempts: constrained decoding keeps the shape, but a small model can
    // still emit a semantically wrong value (a field name it invented, a number
    // as a string). The second pass gets told exactly what failed.
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt++) {
      const content = await chat(
        {
          model: modelFor(opts.tier ?? "reasoning"),
          messages: [
            { role: "system", content: opts.system },
            {
              role: "user",
              content:
                attempt === 0
                  ? opts.prompt
                  : `${opts.prompt}\n\nYour previous answer was rejected: ${String(lastError).slice(0, 300)}\nReturn only valid JSON matching the schema.`,
            },
          ],
          format: opts.jsonSchema,
          options: { temperature: attempt === 0 ? 0.2 : 0, num_predict: opts.maxTokens ?? 2000 },
        },
        env().AEGIS_OLLAMA_TIMEOUT_MS,
      );

      try {
        return opts.schema.parse(JSON.parse(content));
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(
      `Local model could not produce a valid ${opts.name} result: ${String(lastError).slice(0, 300)}`,
    );
  },
};
