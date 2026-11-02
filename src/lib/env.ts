import { z } from "zod";

const schema = z.object({
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_ENVIRONMENT: z.enum(["SANDBOX", "PRODUCTION"]).default("SANDBOX"),
  PAYPAL_SANDBOX_BUYER_EMAIL: z.string().email().optional(),
  ANTHROPIC_API_KEY: z.string().min(1),
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
      `Missing or invalid environment variables: ${missing}. Copy .env.example to .env and fill it in.`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Autonomy limits the agents must respect. Humans own these numbers. */
export function policy() {
  const e = env();
  return {
    autoAcceptCeiling: e.AEGIS_AUTO_ACCEPT_CEILING_USD,
    autoRefundCeiling: e.AEGIS_AUTO_REFUND_CEILING_USD,
    holdThreshold: e.AEGIS_HOLD_THRESHOLD,
  };
}
