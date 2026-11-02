import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { env } from "@/lib/env";
import { currentAccessToken } from "./client";

/**
 * A client for PayPal's official MCP server (`@paypal/mcp`).
 *
 * Aegis can reach PayPal two ways: its own REST client, or PayPal's MCP
 * server, selected by AEGIS_PAYPAL_TRANSPORT. This mirrors how the model
 * provider works - Claude or a local Llama behind one interface - so both of
 * the system's external dependencies are swappable rather than assumed.
 *
 * The server is launched over stdio and takes a bearer token, so it reuses
 * the token the REST client already caches instead of minting a second one.
 * Tokens last 3-8 hours in sandbox; a tool call that fails on auth
 * reconnects once with a fresh token.
 */

let client: Client | null = null;
let transport: StdioClientTransport | null = null;
let connecting: Promise<Client> | null = null;

async function connect(): Promise<Client> {
  const token = await currentAccessToken();

  transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@paypal/mcp", "--tools=all"],
    env: {
      ...(process.env as Record<string, string>),
      PAYPAL_ACCESS_TOKEN: token,
      PAYPAL_ENVIRONMENT: env().PAYPAL_ENVIRONMENT,
    },
  });

  const c = new Client({ name: "aegis", version: "0.1.0" }, { capabilities: {} });
  await c.connect(transport);
  client = c;
  return c;
}

export async function mcp(): Promise<Client> {
  if (client) return client;
  if (!connecting) {
    connecting = connect().finally(() => {
      connecting = null;
    });
  }
  return connecting;
}

export async function disconnectMcp() {
  try {
    await client?.close();
  } catch {
    /* already gone */
  }
  client = null;
  transport = null;
}

export async function listMcpTools(): Promise<Array<{ name: string; description?: string }>> {
  const c = await mcp();
  const res = await c.listTools();
  return res.tools.map((t) => ({ name: t.name, description: t.description }));
}

type ToolContent = Array<{ type: string; text?: string }>;

/**
 * Calls a tool and returns its payload.
 *
 * MCP tool results are content blocks, not typed objects, so the JSON PayPal
 * returns arrives as text and has to be parsed back out. Where a tool answers
 * in prose the raw text is returned instead of guessing at a shape.
 */
export async function callTool<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
  opts: { retryOnAuthFailure?: boolean } = {},
): Promise<{ data: T | null; text: string; isError: boolean }> {
  const c = await mcp();

  let res;
  try {
    res = await c.callTool({ name, arguments: args });
  } catch (err) {
    // A dead child process or an expired token both surface here. Reconnect
    // once with a fresh token before giving up.
    if (opts.retryOnAuthFailure === false) throw err;
    await disconnectMcp();
    return callTool<T>(name, args, { retryOnAuthFailure: false });
  }

  const content = (res.content ?? []) as ToolContent;
  const text = content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n")
    .trim();

  let data: T | null = null;
  try {
    data = JSON.parse(text) as T;
  } catch {
    const match = text.match(/[{[][\s\S]*[}\]]/);
    if (match) {
      try {
        data = JSON.parse(match[0]) as T;
      } catch {
        /* genuinely not JSON */
      }
    }
  }

  return { data, text, isError: res.isError === true };
}

/** Is the MCP server usable right now? Used by diagnostics and the console. */
export async function mcpAvailable(): Promise<{ ok: boolean; tools: number; error?: string }> {
  try {
    const tools = await listMcpTools();
    return { ok: true, tools: tools.length };
  } catch (err) {
    return { ok: false, tools: 0, error: String(err).slice(0, 200) };
  }
}
