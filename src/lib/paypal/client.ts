import { env, hasPayPal } from "@/lib/env";

const HOSTS = {
  SANDBOX: "https://api-m.sandbox.paypal.com",
  PRODUCTION: "https://api-m.paypal.com",
} as const;

type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

function host() {
  return HOSTS[env().PAYPAL_ENVIRONMENT];
}

async function accessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;

  if (!hasPayPal()) {
    throw new PayPalCredentialsMissing();
  }

  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = env();
  const basic = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");

  const res = await fetch(`${host()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new PayPalError(`OAuth failed (${res.status})`, res.status, await res.text());
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return tokenCache.token;
}

/** Thrown instead of a 401 when no sandbox credentials are configured yet. */
export class PayPalCredentialsMissing extends Error {
  constructor() {
    super(
      "PayPal sandbox credentials are not configured. Set PAYPAL_CLIENT_ID and " +
        "PAYPAL_CLIENT_SECRET in .env, or run the seeder with --offline.",
    );
    this.name = "PayPalCredentialsMissing";
  }
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** PayPal requires this on order/refund creation to make retries safe. */
  idempotencyKey?: string;
  headers?: Record<string, string>;
};

/**
 * Single entry point for every PayPal REST call. Retries 429 and 5xx with
 * backoff; everything else surfaces as a PayPalError so the agents can
 * record a failure rather than silently skipping a step.
 */
export async function paypal<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, idempotencyKey, headers = {} } = opts;

  const url = new URL(`${host()}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await accessToken();
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "PayPal-Request-Id": idempotencyKey } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 204) return undefined as T;

    if (res.ok) return (await res.json()) as T;

    const text = await res.text();

    if (res.status === 401 && attempt === 0) {
      tokenCache = null; // token rejected; refresh once and retry
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      lastError = new PayPalError(`${method} ${path} failed (${res.status})`, res.status, text);
      await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
      continue;
    }

    throw new PayPalError(`${method} ${path} failed (${res.status})`, res.status, text);
  }

  throw lastError ?? new Error(`${method} ${path} failed after retries`);
}

export const paypalEnvironment = () => env().PAYPAL_ENVIRONMENT;
