import { z } from "zod";

/**
 * Credentials are optional at boot.
 *
 * A contributor who has not got PayPal sandbox access yet (approval and phone
 * verification can take days, and fail outright in some countries) must still
 * be able to run the whole console, seed data and exercise all four agents.
 * So the app starts without credentials and degrades in a named way:
 * `capabilities()` says what is switched off, and the console shows it rather
 * than failing at the first API call.
 */
/**
 * An empty value in a .env file (`ANTHROPIC_API_KEY=`) is present but blank.
 * Treat it as absent, so commenting a credential out by clearing it works the
 * way everyone expects instead of failing validation.
 */
const optionalStr = () =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().min(1).optional());

const schema = z.object({
  PAYPAL_CLIENT_ID: optionalStr(),
  PAYPAL_CLIENT_SECRET: optionalStr(),
  PAYPAL_ENVIRONMENT: z.enum(["SANDBOX", "PRODUCTION"]).default("SANDBOX"),
  PAYPAL_SANDBOX_BUYER_EMAIL: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().email().optional()),

  // How Aegis reaches PayPal. "rest" is its own client; "mcp" routes the
  // supported operations through PayPal's official MCP server (@paypal/mcp),
  // launched over stdio. Both hit the same PayPal APIs.
  AEGIS_PAYPAL_TRANSPORT: z.enum(["rest", "mcp"]).default("rest"),

  // Which MCP server to use when the transport is "mcp": PayPal's hosted one
  // over SSE, or @paypal/mcp launched locally over stdio. Same tools either way.
  AEGIS_PAYPAL_MCP_MODE: z.enum(["remote", "local"]).default("local"),
  AEGIS_PAYPAL_MCP_SSE_URL: z.string().default("https://mcp.sandbox.paypal.com/sse"),
  // Which model provider to use. "auto" prefers Anthropic when a key is set
  // and falls back to a local Ollama server when one is running.
  AEGIS_AI_PROVIDER: z.enum(["auto", "anthropic", "ollama", "none"]).default("auto"),

  ANTHROPIC_API_KEY: optionalStr(),
  AEGIS_MODEL_REASONING: z.string().default("claude-opus-5"),
  AEGIS_MODEL_FAST: z.string().default("claude-haiku-5-5"),

  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("llama3.1:8b"),
  OLLAMA_MODEL_FAST: optionalStr(),
  AEGIS_OLLAMA_TIMEOUT_MS: z.coerce.number().default(120_000),
  DATABASE_URL: z.string().min(1),

  // From the webhook you register in the PayPal dashboard. Required to verify
  // signatures; without it the receiver rejects everything.
  PAYPAL_WEBHOOK_ID: optionalStr(),
  // LOCAL TESTING ONLY. PayPal's simulate-event endpoint emits events that can
  // never pass real signature verification, so exercising the handler against
  // it requires explicitly accepting unverified deliveries.
  //
  // NOT z.coerce.boolean(). That is Boolean(value), so every non-empty string
  // is true - including the string "false". A flag that disables signature
  // verification on an endpoint which creates disputes must never be able to
  // fail open, so only the literal strings are accepted and anything else
  // stops the process at boot.
  // An empty value counts as absent, matching optionalStr() elsewhere: a
  // blank line left in .env should not crash the app, and "unset" for this
  // flag means off, which is the safe answer anyway. Any other junk still
  // stops the process rather than being guessed at.
  AEGIS_WEBHOOK_ALLOW_UNVERIFIED: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.enum(["true", "false"]).default("false"),
    )
    .transform((v) => v === "true"),
  // Off by default: PayPal's guidance is never to accept a claim without
  // review. A merchant can opt in by setting a ceiling above zero.
  AEGIS_AUTO_ACCEPT_CEILING_USD: z.coerce.number().default(0),
  AEGIS_AUTO_REFUND_CEILING_USD: z.coerce.number().default(25),
  AEGIS_HOLD_THRESHOLD: z.coerce.number().default(70),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(
      `Invalid environment: ${missing}. Copy .env.example to .env. Only DATABASE_URL is required to start.`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Placeholders are treated as absent, so a half-filled .env fails honestly. */
export const isRealSecret = (v: string | undefined) =>
  !!v && v.length > 8 && !/^(placeholder|changeme|your[-_]?|xxx|todo)/i.test(v);

export type Capabilities = {
  paypal: boolean;
  /** Sync best guess only - a local Ollama has to be probed, so the console
   *  uses the async aiStatus() from @/lib/ai for the authoritative answer. */
  aiConfigured: boolean;
  missing: string[];
};

export function capabilities(): Capabilities {
  const e = env();
  const paypal = isRealSecret(e.PAYPAL_CLIENT_ID) && isRealSecret(e.PAYPAL_CLIENT_SECRET);
  const aiConfigured =
    isRealSecret(e.ANTHROPIC_API_KEY) || e.AEGIS_AI_PROVIDER === "ollama" || e.AEGIS_AI_PROVIDER === "auto";

  const missing: string[] = [];
  if (!paypal) missing.push("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET");
  if (!isRealSecret(e.PAYPAL_WEBHOOK_ID)) missing.push("PAYPAL_WEBHOOK_ID");

  return { paypal, aiConfigured, missing };
}

export const hasPayPal = () => capabilities().paypal;

/** Autonomy limits the agents must respect. Humans own these numbers. */
export function policy() {
  const e = env();
  return {
    autoAcceptCeiling: e.AEGIS_AUTO_ACCEPT_CEILING_USD,
    autoRefundCeiling: e.AEGIS_AUTO_REFUND_CEILING_USD,
    holdThreshold: e.AEGIS_HOLD_THRESHOLD,
  };
}
