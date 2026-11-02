/**
 * Proves Aegis can drive PayPal through PayPal's own MCP server.
 *
 *   npm run mcp:check
 *
 * Launches @paypal/mcp over stdio with a token minted by the REST client,
 * lists its tools, and makes real calls against the sandbox.
 */
import "dotenv/config";
import { hasPayPal, env } from "../src/lib/env";
import { listMcpTools, callTool, disconnectMcp, mcpMode } from "../src/lib/paypal/mcp";
import { listDisputes } from "../src/lib/paypal/transport";

async function main() {
  if (!hasPayPal()) {
    console.log("\nNo PayPal credentials configured.\n");
    process.exit(1);
  }

  const where =
    mcpMode() === "remote"
      ? `hosted · ${env().AEGIS_PAYPAL_MCP_SSE_URL}`
      : "local · npx @paypal/mcp over stdio";
  console.log(`\nPayPal MCP server · ${env().PAYPAL_ENVIRONMENT} · ${where}\n`);

  const tools = await listMcpTools();
  console.log(
    `  connected over ${mcpMode() === "remote" ? "SSE" : "stdio"} — ${tools.length} tools exposed`,
  );
  const names = tools.map((t) => t.name);
  const used = ["list_disputes", "get_dispute", "accept_dispute_claim", "create_refund", "create_invoice", "list_transactions"];
  console.log(`  tools Aegis maps: ${used.filter((u) => names.includes(u)).join(", ")}\n`);

  // A real call, through the MCP server, against the sandbox.
  await step("read: list_disputes", async () => {
    const r = await listDisputes({ pageSize: 5 }, "mcp");
    return `${r.items?.length ?? 0} dispute(s), via ${r.via}`;
  });

  // Note the shape: PayPal's MCP tools are NOT the REST bodies. create_invoice
  // flattens detail.currency_code up to the top level, so a REST payload fails
  // validation here. The schemas come from tools/list, not from the REST docs.
  await step("write: create_invoice", async () => {
    const { data, text, isError } = await callTool<{ id?: string; status?: string }>("create_invoice", {
      currency_code: "USD",
      note: "Created through PayPal's MCP server by Aegis.",
      primary_recipients: [{ billing_info: { email_address: "dana.whitfield@example.com" } }],
      items: [
        { name: "MCP round trip", quantity: "1", unit_amount: { currency_code: "USD", value: "25.00" } },
      ],
    });
    if (isError) throw new Error(text.slice(0, 160));
    return data?.id ? `${data.id} ${data.status ?? ""}` : text.slice(0, 120);
  });

  // Same operation both ways, to show the transport is interchangeable.
  await step("same read over REST", async () => {
    const r = await listDisputes({ pageSize: 5 }, "rest");
    return `${r.items?.length ?? 0} dispute(s), via ${r.via}`;
  });

  console.log("");
}

async function step(name: string, fn: () => Promise<string>) {
  try {
    console.log(`  ok    ${name.padEnd(26)} ${await fn()}`);
  } catch (err) {
    console.log(`  FAIL  ${name.padEnd(26)} ${String(err).replace(/\s+/g, " ").slice(0, 170)}`);
  }
}

main()
  .catch((err) => {
    console.error(`\nfailed: ${err}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMcp();
    process.exit();
  });
