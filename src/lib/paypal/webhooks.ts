import { paypal } from "./client";
import { env } from "@/lib/env";

/**
 * Webhook signature verification.
 *
 * An unverified endpoint accepts a POST from anyone, not just PayPal — and
 * this one creates disputes and can trigger refunds, so it is the single
 * most security-sensitive surface in the app.
 */

export const SIGNATURE_HEADERS = [
  "paypal-auth-algo",
  "paypal-cert-url",
  "paypal-transmission-id",
  "paypal-transmission-sig",
  "paypal-transmission-time",
] as const;

export type SignatureHeaders = Record<(typeof SIGNATURE_HEADERS)[number], string>;

export function readSignatureHeaders(headers: Headers): SignatureHeaders | null {
  const out = {} as SignatureHeaders;
  for (const h of SIGNATURE_HEADERS) {
    const v = headers.get(h);
    if (!v) return null; // a delivery missing any of the five is not from PayPal
    out[h] = v;
  }
  return out;
}

/**
 * @param rawBody the request body EXACTLY as received. Re-serializing the
 * JSON — even just changing whitespace — changes the bytes the signature was
 * computed over and verification will fail.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  headers: SignatureHeaders,
): Promise<boolean> {
  const webhookId = env().PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;

  try {
    const res = await paypal<{ verification_status?: string }>(
      "/v1/notifications/verify-webhook-signature",
      {
        method: "POST",
        body: {
          auth_algo: headers["paypal-auth-algo"],
          cert_url: headers["paypal-cert-url"],
          transmission_id: headers["paypal-transmission-id"],
          transmission_sig: headers["paypal-transmission-sig"],
          transmission_time: headers["paypal-transmission-time"],
          webhook_id: webhookId,
          // Parsed, not re-stringified: PayPal's own API wants the event as
          // JSON here, and this is the one place the raw bytes are not used.
          webhook_event: JSON.parse(rawBody),
        },
      },
    );
    return res.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}

/* ---------------------------------------------------- subscription management */

export type WebhookSubscription = {
  id: string;
  url: string;
  event_types: Array<{ name: string }>;
};

/** The events Aegis acts on. Explicit, not a wildcard: fewer irrelevant deliveries. */
export const SUBSCRIBED_EVENTS = [
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.RESOLVED",
  "CUSTOMER.DISPUTE.UPDATED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
  "PAYMENT.SALE.COMPLETED",
] as const;

export const listWebhooks = () =>
  paypal<{ webhooks?: WebhookSubscription[] }>("/v1/notifications/webhooks");

export const createWebhook = (url: string) =>
  paypal<WebhookSubscription>("/v1/notifications/webhooks", {
    method: "POST",
    body: { url, event_types: SUBSCRIBED_EVENTS.map((name) => ({ name })) },
  });

export const deleteWebhook = (id: string) =>
  paypal<void>(`/v1/notifications/webhooks/${id}`, { method: "DELETE" });

export const simulateEvent = (webhookId: string, eventType: string) =>
  paypal<{ id: string; event_type: string }>("/v1/notifications/simulate-event", {
    method: "POST",
    body: { webhook_id: webhookId, event_type: eventType },
  });
