import { env } from "@/lib/env";
import { callTool } from "./mcp";
import * as rest from "./api";
import { TransactionSearchDisabled } from "./api";
import type { PayPalDispute, PayPalRefund, PayPalInvoice, PayPalTransaction } from "./api";

/**
 * Transport-neutral PayPal operations.
 *
 * The same call goes over the REST client or PayPal's official MCP server
 * depending on AEGIS_PAYPAL_TRANSPORT. Only the operations PayPal's MCP
 * server actually exposes are routed; everything else (transaction search,
 * webhook management, shipment tracker updates) stays on REST, which is why
 * REST remains the default rather than a fallback.
 */

export type Transport = "rest" | "mcp";
export type { PayPalDispute } from "./api";

export const activeTransport = (): Transport => env().AEGIS_PAYPAL_TRANSPORT;

/** Which operations can go either way. Everything else is REST-only. */
export const MCP_BACKED_OPERATIONS = [
  "listDisputes",
  "getDispute",
  "createRefund",
  "createInvoice",
  "listTransactions",
] as const;

export async function listDisputes(
  params: { pageSize?: number } = {},
  transport: Transport = activeTransport(),
): Promise<{ items?: PayPalDispute[]; via: Transport }> {
  if (transport === "mcp") {
    const { data } = await callTool<{ items?: PayPalDispute[] }>("list_disputes", {
      page_size: params.pageSize ?? 50,
    });
    return { items: data?.items ?? [], via: "mcp" };
  }
  const res = await rest.listDisputes(params);
  return { items: res.items ?? [], via: "rest" };
}

export async function getDispute(
  id: string,
  transport: Transport = activeTransport(),
): Promise<{ dispute: PayPalDispute | null; via: Transport }> {
  if (transport === "mcp") {
    const { data } = await callTool<PayPalDispute>("get_dispute", { dispute_id: id });
    return { dispute: data, via: "mcp" };
  }
  return { dispute: await rest.getDispute(id), via: "rest" };
}

export async function createRefund(
  captureId: string,
  amount: { value: string; currency: string },
  note: string,
  transport: Transport = activeTransport(),
): Promise<{ refund: PayPalRefund | null; via: Transport }> {
  if (transport === "mcp") {
    const { data } = await callTool<PayPalRefund>("create_refund", {
      capture_id: captureId,
      amount: { value: amount.value, currency_code: amount.currency },
      note_to_payer: note,
    });
    return { refund: data, via: "mcp" };
  }
  return { refund: await rest.createRefund(captureId, amount, note), via: "rest" };
}

/**
 * PayPal's MCP tools are not the REST bodies: create_invoice flattens
 * detail.currency_code to the top level, so each transport gets the shape its
 * own side expects. Both produce the same invoice.
 */
export async function createInvoice(
  input: { recipientEmail: string; amount: string; currency?: string; itemName: string },
  transport: Transport = activeTransport(),
): Promise<{ invoice: PayPalInvoice | null; via: Transport }> {
  const currency = input.currency ?? "USD";

  if (transport === "mcp") {
    const { data } = await callTool<PayPalInvoice & { href?: string }>("create_invoice", {
      currency_code: currency,
      primary_recipients: [{ billing_info: { email_address: input.recipientEmail } }],
      items: [
        {
          name: input.itemName,
          quantity: "1",
          unit_amount: { currency_code: currency, value: input.amount },
        },
      ],
    });

    // Like the REST endpoint, this answers with a link object rather than the
    // invoice, so the id is parsed out and the invoice fetched.
    if (data?.id) return { invoice: data, via: "mcp" };
    const id = data?.href?.split("/").filter(Boolean).pop();
    return { invoice: id ? await rest.getInvoice(id) : null, via: "mcp" };
  }

  return {
    invoice: await rest.createInvoice({
      recipientEmail: input.recipientEmail,
      amount: input.amount,
      currency,
      itemName: input.itemName,
    }),
    via: "rest",
  };
}

/**
 * Transaction history for one payer.
 *
 * Transaction Search is a per-app feature that is off by default, so this
 * reports unavailability rather than throwing: a dispute assessment must not
 * fail because an optional evidence source is switched off.
 */
export type PayerHistoryResult =
  | { available: true; transactions: PayPalTransaction[]; via: Transport }
  | { available: false; reason: string };

let transactionSearchOff: string | null = null;

export async function payerTransactionHistory(
  payerEmail: string,
  since: Date,
  until: Date = new Date(),
  transport: Transport = activeTransport(),
): Promise<PayerHistoryResult> {
  // Once PayPal has said the feature is off, stop asking on every dispute.
  if (transactionSearchOff) return { available: false, reason: transactionSearchOff };

  try {
    if (transport === "mcp") {
      const { data } = await callTool<{ transaction_details?: PayPalTransaction[] }>("list_transactions", {
        start_date: since.toISOString(),
        end_date: until.toISOString(),
        fields: "transaction_info,payer_info",
      });
      const all = data?.transaction_details ?? [];
      return { available: true, transactions: all.filter((t) => matchesPayer(t, payerEmail)), via: "mcp" };
    }

    const all = await rest.listTransactions(since, until);
    return { available: true, transactions: all.filter((t) => matchesPayer(t, payerEmail)), via: "rest" };
  } catch (err) {
    if (err instanceof TransactionSearchDisabled) {
      transactionSearchOff = err.message;
      return { available: false, reason: err.message };
    }
    return { available: false, reason: String(err).slice(0, 160) };
  }
}

const matchesPayer = (t: PayPalTransaction, email: string) =>
  (t.payer_info?.email_address ?? "").toLowerCase() === email.toLowerCase();
