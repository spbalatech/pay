import { paypal, PayPalError } from "./client";
import { randomUUID } from "node:crypto";

/* ------------------------------------------------------------------ orders */

export type PayPalOrder = {
  id: string;
  status: string;
  create_time?: string;
  update_time?: string;
  payer?: {
    payer_id?: string;
    email_address?: string;
    address?: { country_code?: string };
  };
  purchase_units?: Array<{
    amount?: { currency_code: string; value: string };
    items?: Array<{ name: string; quantity: string; unit_amount?: { value: string }; sku?: string; category?: string }>;
    shipping?: {
      name?: { full_name?: string };
      address?: {
        address_line_1?: string;
        address_line_2?: string;
        admin_area_2?: string;
        admin_area_1?: string;
        postal_code?: string;
        country_code?: string;
      };
    };
    payments?: {
      captures?: Array<{ id: string; status: string; amount: { value: string; currency_code: string }; create_time: string }>;
      refunds?: Array<{ id: string; status: string; amount: { value: string; currency_code: string } }>;
    };
  }>;
};

export function createOrder(input: {
  amount: string;
  currency?: string;
  items?: Array<{ name: string; quantity: string; unitAmount: string; sku?: string; category?: string }>;
  shipping?: {
    fullName: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    countryCode: string;
  };
}) {
  const currency = input.currency ?? "USD";
  const itemTotal = input.items
    ? input.items
        .reduce((sum, i) => sum + Number(i.unitAmount) * Number(i.quantity), 0)
        .toFixed(2)
    : undefined;

  return paypal<PayPalOrder>("/v2/checkout/orders", {
    method: "POST",
    idempotencyKey: randomUUID(),
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: currency,
            value: input.amount,
            ...(itemTotal
              ? { breakdown: { item_total: { currency_code: currency, value: itemTotal } } }
              : {}),
          },
          ...(input.items
            ? {
                items: input.items.map((i) => ({
                  name: i.name,
                  quantity: i.quantity,
                  unit_amount: { currency_code: currency, value: i.unitAmount },
                  ...(i.sku ? { sku: i.sku } : {}),
                  ...(i.category ? { category: i.category } : {}),
                })),
              }
            : {}),
          ...(input.shipping
            ? {
                shipping: {
                  name: { full_name: input.shipping.fullName },
                  address: {
                    address_line_1: input.shipping.line1,
                    ...(input.shipping.line2 ? { address_line_2: input.shipping.line2 } : {}),
                    admin_area_2: input.shipping.city,
                    admin_area_1: input.shipping.state,
                    postal_code: input.shipping.postalCode,
                    country_code: input.shipping.countryCode,
                  },
                },
              }
            : {}),
        },
      ],
    },
  });
}

export const getOrder = (id: string) => paypal<PayPalOrder>(`/v2/checkout/orders/${id}`);

/* ----------------------------------------------------------------- refunds */

export type PayPalRefund = {
  id: string;
  status: string;
  amount: { value: string; currency_code: string };
};

export function createRefund(captureId: string, amount?: { value: string; currency: string }, note?: string) {
  return paypal<PayPalRefund>(`/v2/payments/captures/${captureId}/refund`, {
    method: "POST",
    idempotencyKey: randomUUID(),
    body: {
      ...(amount ? { amount: { value: amount.value, currency_code: amount.currency } } : {}),
      ...(note ? { note_to_payer: note } : {}),
    },
  });
}

export const getRefund = (id: string) => paypal<PayPalRefund>(`/v2/payments/refunds/${id}`);

/* ---------------------------------------------------------------- disputes */

export type PayPalDispute = {
  dispute_id: string;
  create_time: string;
  update_time?: string;
  status: string;
  reason?: string;
  dispute_state?: string;
  dispute_amount?: { currency_code: string; value: string };
  seller_response_due_date?: string;
  dispute_life_cycle_stage?: string;
  /** What PayPal will accept right now; changes with the lifecycle stage. */
  allowed_response_options?: { allowed_response_options?: string[] };
  disputed_transactions?: Array<{
    seller_transaction_id?: string;
    buyer_transaction_id?: string;
    invoice_number?: string;
    custom?: string;
    seller?: { email?: string; merchant_id?: string };
    buyer?: { email?: string; name?: string };
  }>;
  messages?: Array<{ posted_by: string; content: string; time_posted: string }>;
};

export function listDisputes(params: { pageSize?: number; startTime?: string; status?: string } = {}) {
  return paypal<{ items?: PayPalDispute[] }>("/v1/customer/disputes", {
    query: {
      page_size: params.pageSize ?? 50,
      start_time: params.startTime,
      dispute_state: params.status,
    },
  });
}

export const getDispute = (id: string) => paypal<PayPalDispute>(`/v1/customer/disputes/${id}`);

export function acceptDisputeClaim(id: string, note: string, refundAmount?: { value: string; currency: string }) {
  return paypal<{ links?: unknown[] }>(`/v1/customer/disputes/${id}/accept-claim`, {
    method: "POST",
    body: {
      note,
      accept_claim_type: "REFUND",
      ...(refundAmount
        ? { refund_amount: { value: refundAmount.value, currency_code: refundAmount.currency } }
        : {}),
    },
  });
}

/* ------------------------------------------------------------ transactions */

export type PayPalTransaction = {
  transaction_info: {
    transaction_id: string;
    transaction_event_code?: string;
    transaction_initiation_date?: string;
    transaction_updated_date?: string;
    transaction_amount?: { currency_code: string; value: string };
    transaction_status?: string;
    fee_amount?: { currency_code: string; value: string };
  };
  payer_info?: {
    account_id?: string;
    email_address?: string;
    payer_name?: { alternate_full_name?: string };
  };
};

/**
 * Transaction search is the Sentinel's main history source. PayPal caps each
 * request to a 31-day window, so callers hand us a range and we page it.
 */
export class TransactionSearchDisabled extends Error {
  constructor(cause: string) {
    super(
      "Transaction Search is not enabled on this PayPal app. Enable it under " +
        "Apps & Credentials > your app > Features > Transaction search, then wait a few " +
        `minutes. (${cause})`,
    );
    this.name = "TransactionSearchDisabled";
  }
}

export async function listTransactions(startDate: Date, endDate: Date) {
  const all: PayPalTransaction[] = [];
  let cursor = new Date(startDate);

  while (cursor < endDate) {
    const windowEnd = new Date(Math.min(cursor.getTime() + 30 * 86_400_000, endDate.getTime()));
    let page = 1;

    for (;;) {
      try {
        const res = await paypal<{
          transaction_details?: PayPalTransaction[];
          total_pages?: number;
        }>("/v1/reporting/transactions", {
          query: {
            start_date: cursor.toISOString(),
            end_date: windowEnd.toISOString(),
            fields: "transaction_info,payer_info",
            page_size: 100,
            page,
          },
        });

        all.push(...(res.transaction_details ?? []));
        if (!res.total_pages || page >= res.total_pages) break;
        page++;
      } catch (err) {
        if (err instanceof PayPalError && err.status === 403) {
          throw new TransactionSearchDisabled(err.body.replace(/\s+/g, " ").slice(0, 120));
        }
        throw err;
      }
    }

    cursor = new Date(windowEnd.getTime() + 1000);
  }

  return all;
}

/* -------------------------------------------------------- shipment tracking */

export type PayPalTracker = {
  transaction_id: string;
  tracking_number: string;
  status: string;
  carrier?: string;
  shipment_date?: string;
  last_updated_time?: string;
};

export function createShipmentTracking(input: {
  captureId: string;
  trackingNumber: string;
  carrier: string;
  status: string;
  shipDate?: string;
}) {
  return paypal<{ tracker_identifiers?: Array<{ transaction_id: string; tracking_number: string }> }>(
    "/v1/shipping/trackers-batch",
    {
      method: "POST",
      body: {
        trackers: [
          {
            transaction_id: input.captureId,
            tracking_number: input.trackingNumber,
            status: input.status,
            carrier: input.carrier,
            ...(input.shipDate ? { shipment_date: input.shipDate } : {}),
          },
        ],
      },
    },
  );
}

export const getShipmentTracking = (captureId: string, trackingNumber: string) =>
  paypal<PayPalTracker>(`/v1/shipping/trackers/${captureId}-${trackingNumber}`);

export const updateShipmentTracking = (
  captureId: string,
  trackingNumber: string,
  patch: { status: string; carrier: string; last_updated_time?: string },
) =>
  paypal<void>(`/v1/shipping/trackers/${captureId}-${trackingNumber}`, {
    method: "PUT",
    body: { transaction_id: captureId, tracking_number: trackingNumber, ...patch },
  });

/* ---------------------------------------------------------------- invoices */

export type PayPalInvoice = {
  id: string;
  status: string;
  detail?: { invoice_number?: string; invoice_date?: string; payment_term?: { due_date?: string } };
  amount?: { currency_code: string; value: string };
  primary_recipients?: Array<{ billing_info?: { email_address?: string } }>;
};

/**
 * Creates a draft invoice.
 *
 * Note: this endpoint does NOT return the invoice. It returns a link object
 * ({rel, href, method}) whose href ends in the new invoice id, so the id is
 * parsed out and the invoice fetched. Reading `.id` off the POST response
 * silently yields undefined.
 */
export async function createInvoice(input: {
  recipientEmail: string;
  amount: string;
  currency?: string;
  itemName: string;
  dueDate?: string;
}): Promise<PayPalInvoice> {
  const currency = input.currency ?? "USD";
  const created = await paypal<PayPalInvoice & { href?: string }>("/v2/invoicing/invoices", {
    method: "POST",
    idempotencyKey: randomUUID(),
    body: {
      detail: {
        currency_code: currency,
        ...(input.dueDate
          ? { payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: input.dueDate } }
          : {}),
      },
      primary_recipients: [{ billing_info: { email_address: input.recipientEmail } }],
      items: [
        {
          name: input.itemName,
          quantity: "1",
          unit_amount: { currency_code: currency, value: input.amount },
        },
      ],
    },
  });

  if (created.id) return created;

  const id = created.href?.split("/").filter(Boolean).pop();
  if (!id) throw new Error(`Invoice created but no id could be resolved from ${JSON.stringify(created)}`);

  return getInvoice(id);
}

export const getInvoice = (id: string) => paypal<PayPalInvoice>(`/v2/invoicing/invoices/${id}`);

export const sendInvoice = (id: string) =>
  paypal<{ href?: string }>(`/v2/invoicing/invoices/${id}/send`, {
    method: "POST",
    body: { send_to_recipient: true },
  });

export const listInvoices = (pageSize = 100) =>
  paypal<{ items?: PayPalInvoice[] }>("/v2/invoicing/invoices", {
    query: { page_size: pageSize, total_required: "true" },
  });

/* ----------------------------------------------------------- subscriptions */

export type PayPalSubscription = {
  id: string;
  plan_id: string;
  status: string;
  start_time?: string;
  subscriber?: { payer_id?: string; email_address?: string };
  billing_info?: {
    last_payment?: { amount?: { value: string; currency_code: string }; time?: string };
    next_billing_time?: string;
  };
};

export const getSubscription = (id: string) =>
  paypal<PayPalSubscription>(`/v1/billing/subscriptions/${id}`);

export const cancelSubscription = (id: string, reason: string) =>
  paypal<void>(`/v1/billing/subscriptions/${id}/cancel`, { method: "POST", body: { reason } });

export const suspendSubscription = (id: string, reason: string) =>
  paypal<void>(`/v1/billing/subscriptions/${id}/suspend`, { method: "POST", body: { reason } });

export function createProduct(input: { name: string; description: string; type?: string }) {
  return paypal<{ id: string; name: string }>("/v1/catalogs/products", {
    method: "POST",
    idempotencyKey: randomUUID(),
    body: {
      name: input.name,
      description: input.description,
      type: input.type ?? "PHYSICAL",
      category: "MERCHANDISE",
    },
  });
}

export function createSubscriptionPlan(input: { productId: string; name: string; amount: string; currency?: string }) {
  return paypal<{ id: string; name: string; status: string }>("/v1/billing/plans", {
    method: "POST",
    idempotencyKey: randomUUID(),
    body: {
      product_id: input.productId,
      name: input.name,
      status: "ACTIVE",
      billing_cycles: [
        {
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: { value: input.amount, currency_code: input.currency ?? "USD" },
          },
        },
      ],
      payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: "CONTINUE" },
    },
  });
}
