import "dotenv/config";
import { App } from "@slack/bolt";
import { registerHandler } from "./handler";

// Listens for Slack messages over Socket Mode or HTTP, depending on env vars provided.
async function main() {
  const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET } = process.env;
  const port = Number(process.env.PORT) || 8080;

  if (!SLACK_BOT_TOKEN || (!SLACK_APP_TOKEN && !SLACK_SIGNING_SECRET)) {
    console.log("[intake] No Slack credentials set — the listener will not start.");
    console.log("[intake] Set SLACK_BOT_TOKEN plus either SLACK_APP_TOKEN (Socket Mode) or");
    console.log("[intake] SLACK_SIGNING_SECRET (Events API) — or run `npm run simulate` to inject a test ticket.");
    return;
  }

  if (SLACK_APP_TOKEN) {
    const app = new App({ token: SLACK_BOT_TOKEN, socketMode: true, appToken: SLACK_APP_TOKEN });
    registerHandler(app);
    await app.start();
    console.log("⚡ [intake] running (Socket Mode)");
  } else {
    const app = new App({ token: SLACK_BOT_TOKEN, signingSecret: SLACK_SIGNING_SECRET });
    registerHandler(app);
    await app.start(port);
    console.log(`⚡ [intake] listening on :${port} (Events API / HTTP)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
