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
  /** PayPal's own correlation id. The first thing their support asks for. */
  readonly debugId?: string;
  /** The machine-readable issue code, e.g. PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING. */
  readonly issue?: string;

  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    const { debugId, issue } = parseErrorBody(body);
    super([message, issue && `issue=${issue}`, debugId && `debug_id=${debugId}`].filter(Boolean).join(" "));
    this.name = "PayPalError";
    this.debugId = debugId;
    this.issue = issue;
  }
}

function parseErrorBody(body: string): { debugId?: string; issue?: string } {
  try {
    const json = JSON.parse(body) as {
      debug_id?: string;
      name?: string;
      details?: Array<{ issue?: string }>;
    };
    return { debugId: json.debug_id, issue: json.details?.[0]?.issue ?? json.name };
  } catch {
    return {};
  }
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /**
   * Multipart body, for the few endpoints that take files (dispute evidence).
   * Sent as-is so fetch sets the multipart boundary; `body` is ignored.
   */
  form?: FormData;
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
  const { method = "GET", body, form, query, idempotencyKey, headers = {} } = opts;

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
        ...(form ? {} : { "Content-Type": "application/json" }),
        ...(idempotencyKey ? { "PayPal-Request-Id": idempotencyKey } : {}),
        ...headers,
      },
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
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

/**
 * The cached bearer token, for consumers that need to hand it to something
 * else - PayPal's MCP server takes PAYPAL_ACCESS_TOKEN rather than a client
 * id and secret, so it reuses this rather than minting a second one.
 */
export const currentAccessToken = () => accessToken();
