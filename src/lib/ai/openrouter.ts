import { env, isRealSecret } from "@/lib/env";
import type { AIProvider, GenerateOptions, StructuredOptions, Tier } from "./types";
import type { z } from "zod";

/**
 * Hosted models through OpenRouter (an OpenAI-compatible gateway).
 *
 * Useful for cheap testing - a DeepSeek flash model costs a fraction of a
 * cent per full agent pass - without changing anything else: same interface,
 * chosen by AEGIS_AI_PROVIDER=openrouter. Structured output asks for a JSON
 * Schema response and routes only to providers that honour it
 * (require_parameters); the result is still validated, with one retry that
 * names what failed, because "honours the schema" varies by upstream.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 90_000;

const modelFor = (tier: Tier) =>
  tier === "fast" ? env().OPENROUTER_MODEL_FAST || env().OPENROUTER_MODEL : env().OPENROUTER_MODEL;

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string; code?: number | string };
};

async function chat(body: Record<string, unknown>): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env().OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "X-Title": "Aegis",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let json: ChatResponse;
    try {
      json = JSON.parse(text) as ChatResponse;
    } catch {
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
    }
    // OpenRouter can report an upstream failure inside a 200 body.
    if (!res.ok || json.error) {
      throw new Error(`OpenRouter ${res.status}: ${json.error?.message ?? text.slice(0, 200)}`);
    }
    return (json.choices?.[0]?.message?.content ?? "").trim();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`OpenRouter did not respond within ${TIMEOUT_MS / 1000}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const openrouterProvider: AIProvider = {
  name: "openrouter",

  describe: () => ({
    provider: "openrouter",
    reasoning: env().OPENROUTER_MODEL,
    fast: env().OPENROUTER_MODEL_FAST || env().OPENROUTER_MODEL,
  }),

  async available() {
    return isRealSecret(env().OPENROUTER_API_KEY);
  },

  async generate(opts: GenerateOptions) {
    return chat({
      model: modelFor(opts.tier ?? "reasoning"),
      max_tokens: opts.maxTokens ?? 1500,
      temperature: 0.3,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
    });
  },

  async generateStructured<T extends z.ZodTypeAny>(opts: StructuredOptions<T>): Promise<z.infer<T>> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt++) {
      const content = await chat({
        model: modelFor(opts.tier ?? "reasoning"),
        max_tokens: opts.maxTokens ?? 2000,
        temperature: attempt === 0 ? 0.2 : 0,
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
        response_format: {
          type: "json_schema",
          json_schema: { name: opts.name, strict: false, schema: opts.jsonSchema },
        },
        provider: { require_parameters: true },
      });

      try {
        // Some upstreams wrap JSON in a code fence despite the schema request.
        const raw = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        return opts.schema.parse(JSON.parse(raw));
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(`OpenRouter model could not produce a valid ${opts.name} result: ${String(lastError).slice(0, 300)}`);
  },
};
