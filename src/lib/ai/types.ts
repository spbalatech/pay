import type { z } from "zod";

/** Which model tier a call wants. Providers map these to their own models. */
export type Tier = "reasoning" | "fast";

export type ProviderName = "anthropic" | "ollama" | "none";

export type GenerateOptions = {
  system: string;
  prompt: string;
  tier?: Tier;
  maxTokens?: number;
};

export type StructuredOptions<T extends z.ZodTypeAny> = GenerateOptions & {
  schema: T;
  /** JSON Schema for the result. Anthropic uses it as a tool input schema;
   *  Ollama passes it to its constrained-decoding `format` parameter. */
  jsonSchema: Record<string, unknown>;
  name: string;
};

export interface AIProvider {
  readonly name: ProviderName;
  /** Human-readable model identifiers, for the console and the audit log. */
  describe(): { provider: ProviderName; reasoning: string; fast: string };
  /** Is this provider actually reachable right now? */
  available(): Promise<boolean>;
  generate(opts: GenerateOptions): Promise<string>;
  generateStructured<T extends z.ZodTypeAny>(opts: StructuredOptions<T>): Promise<z.infer<T>>;
}

export class NoProviderError extends Error {
  constructor() {
    super(
      "No AI provider is available. Set ANTHROPIC_API_KEY, or run a local model " +
        "with Ollama and set AEGIS_AI_PROVIDER=ollama. Run `npm run ai:check` to diagnose.",
    );
    this.name = "NoProviderError";
  }
}
