import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { z } from "zod";

let client: Anthropic | null = null;

function anthropic() {
  if (!client) client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  return client;
}

export type Tier = "reasoning" | "fast";

function modelFor(tier: Tier) {
  const e = env();
  return tier === "reasoning" ? e.AEGIS_MODEL_REASONING : e.AEGIS_MODEL_FAST;
}

/** Free-text generation: rebuttal drafts, buyer outreach, risk narratives. */
export async function generate(opts: {
  system: string;
  prompt: string;
  tier?: Tier;
  maxTokens?: number;
}): Promise<string> {
  const res = await anthropic().messages.create({
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
}

/**
 * Structured generation via a forced tool call. We use this wherever a
 * downstream decision depends on the shape of the output, so a malformed
 * response fails loudly instead of being parsed out of prose.
 */
export async function generateStructured<T extends z.ZodTypeAny>(opts: {
  system: string;
  prompt: string;
  schema: T;
  jsonSchema: Record<string, unknown>;
  name: string;
  tier?: Tier;
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const res = await anthropic().messages.create({
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
}
