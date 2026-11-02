import Anthropic from "@anthropic-ai/sdk";
import { env, isRealSecret } from "@/lib/env";
import type { AIProvider, GenerateOptions, StructuredOptions, Tier } from "./types";
import type { z } from "zod";

let client: Anthropic | null = null;

function sdk() {
  if (!client) client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY! });
  return client;
}

const modelFor = (tier: Tier) =>
  tier === "fast" ? env().AEGIS_MODEL_FAST : env().AEGIS_MODEL_REASONING;

export const anthropicProvider: AIProvider = {
  name: "anthropic",

  describe: () => ({
    provider: "anthropic",
    reasoning: env().AEGIS_MODEL_REASONING,
    fast: env().AEGIS_MODEL_FAST,
  }),

  async available() {
    // A placeholder left in .env must not count as configured, or `auto` picks
    // Anthropic and never falls through to a working local model.
    return isRealSecret(env().ANTHROPIC_API_KEY);
  },

  async generate(opts: GenerateOptions) {
    const res = await sdk().messages.create({
      model: modelFor(opts.tier ?? "reasoning"),
      max_tokens: opts.maxTokens ?? 1500,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    });

    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  },

  /**
   * A forced tool call, so a malformed response fails loudly instead of being
   * parsed out of prose.
   */
  async generateStructured<T extends z.ZodTypeAny>(opts: StructuredOptions<T>): Promise<z.infer<T>> {
    const res = await sdk().messages.create({
      model: modelFor(opts.tier ?? "reasoning"),
      max_tokens: opts.maxTokens ?? 2000,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      tools: [
        {
          name: opts.name,
          description: `Return the ${opts.name} result.`,
          input_schema: opts.jsonSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: opts.name },
    });

    const block = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === opts.name,
    );
    if (!block) throw new Error(`Model did not return a ${opts.name} tool call`);

    return opts.schema.parse(block.input);
  },
};
