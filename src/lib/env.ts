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
const schema = z.object({
  PAYPAL_CLIENT_ID: z.string().min(1).optional(),
  PAYPAL_CLIENT_SECRET: z.string().min(1).optional(),
  PAYPAL_ENVIRONMENT: z.enum(["SANDBOX", "PRODUCTION"]).default("SANDBOX"),
  PAYPAL_SANDBOX_BUYER_EMAIL: z.string().email().optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AEGIS_MODEL_REASONING: z.string().default("claude-opus-5"),
  AEGIS_MODEL_FAST: z.string().default("claude-haiku-5-5"),
  DATABASE_URL: z.string().min(1),
  AEGIS_AUTO_ACCEPT_CEILING_USD: z.coerce.number().default(35),
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
const real = (v: string | undefined) =>
  !!v && v.length > 8 && !/^(placeholder|changeme|your[-_]?|xxx|todo)/i.test(v);

export type Capabilities = {
  paypal: boolean;
  ai: boolean;
  missing: string[];
};

export function capabilities(): Capabilities {
  const e = env();
  const paypal = real(e.PAYPAL_CLIENT_ID) && real(e.PAYPAL_CLIENT_SECRET);
  const ai = real(e.ANTHROPIC_API_KEY);

  const missing: string[] = [];
  if (!paypal) missing.push("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET");
  if (!ai) missing.push("ANTHROPIC_API_KEY");

  return { paypal, ai, missing };
}

export const hasPayPal = () => capabilities().paypal;
export const hasAI = () => capabilities().ai;

/** Autonomy limits the agents must respect. Humans own these numbers. */
export function policy() {
  const e = env();
  return {
    autoAcceptCeiling: e.AEGIS_AUTO_ACCEPT_CEILING_USD,
    autoRefundCeiling: e.AEGIS_AUTO_REFUND_CEILING_USD,
    holdThreshold: e.AEGIS_HOLD_THRESHOLD,
  };
}
