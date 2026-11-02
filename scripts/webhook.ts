/**
 * Manage the PayPal webhook subscription.
 *
 *   npm run webhook -- list
 *   npm run webhook -- register https://<your-tunnel>/api/webhooks/paypal
 *   npm run webhook -- simulate CUSTOMER.DISPUTE.CREATED
 *   npm run webhook -- delete <webhook-id>
 *
 * PayPal must be able to reach the URL from the public internet, so for local
 * development put a tunnel in front of it (ngrok, cloudflared) and register
 * the tunnel's URL.
 */
import "dotenv/config";
import { env, hasPayPal } from "../src/lib/env";
import { listWebhooks, createWebhook, deleteWebhook, simulateEvent, SUBSCRIBED_EVENTS } from "../src/lib/paypal/webhooks";

async function main() {
  if (!hasPayPal()) {
    console.log("\nNo PayPal credentials configured.\n");
    process.exit(1);
  }

  const [cmd, arg] = process.argv.slice(2);

  switch (cmd) {
    case "list": {
      const { webhooks } = await listWebhooks();
      if (!webhooks?.length) {
        console.log("\nNo webhooks registered. Register one with:\n  npm run webhook -- register <url>\n");
        return;
      }
      for (const w of webhooks) {
        console.log(`\n  ${w.id}\n  ${w.url}\n  ${w.event_types.length} event types subscribed`);
      }
      console.log(`\nPut the id in .env as PAYPAL_WEBHOOK_ID.\n`);
      return;
    }

    case "register": {
      if (!arg) throw new Error("Usage: npm run webhook -- register <public-url>");
      const w = await createWebhook(arg);
      console.log(`\n  created ${w.id}\n  ${w.url}\n  ${SUBSCRIBED_EVENTS.length} event types\n`);
      console.log(`Add to .env:\n  PAYPAL_WEBHOOK_ID=${w.id}\n`);
      return;
    }

    case "simulate": {
      const webhookId = env().PAYPAL_WEBHOOK_ID;
      if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID is not set in .env");
      const type = arg ?? "CUSTOMER.DISPUTE.CREATED";
      const r = await simulateEvent(webhookId, type);
      console.log(`\n  sent ${r.event_type} (${r.id})`);
      console.log(
        `\n  Note: a simulated event can never pass real signature verification.\n` +
          `  Set AEGIS_WEBHOOK_ALLOW_UNVERIFIED=true to let the handler act on it locally.\n`,
      );
      return;
    }

    case "delete": {
      if (!arg) throw new Error("Usage: npm run webhook -- delete <webhook-id>");
      await deleteWebhook(arg);
      console.log(`\n  deleted ${arg}\n`);
      return;
    }

    default:
      console.log(`\nUsage:\n  npm run webhook -- list\n  npm run webhook -- register <public-url>\n  npm run webhook -- simulate [EVENT.TYPE]\n  npm run webhook -- delete <id>\n`);
  }
}

main().catch((err) => {
  console.error(`\nfailed: ${err}\n`);
  process.exit(1);
});
