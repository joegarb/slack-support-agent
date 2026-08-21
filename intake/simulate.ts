import "dotenv/config";
import { enqueueRequest } from "./queue";
import { parseDirectMessage } from "./message";

// Inject a fake direct message through the real parse + enqueue path — no Slack
// credentials needed. No channel, so the worker logs the reply instead of posting it.
async function main() {
  const fakeSlackMessage = {
    type: "message",
    user: "user_12345",
    ts: (Date.now() / 1000).toFixed(6),
    text: [
      "🎫 New Zendesk ticket #48213",
      "Customer: user_12345 (Pro plan)",
      "Subject: Charged twice for my subscription",
      "Tracking issue: https://linear.app/acme/issue/ENG-4210",
      "Body: I was billed £29 twice this month and my balance looks wrong — looks like a duplicate charge.",
    ].join("\n"),
  };

  const request = parseDirectMessage(fakeSlackMessage);
  if (!request) {
    console.error("[simulate] could not parse the fake Slack message");
    process.exit(1);
  }

  const jobId = await enqueueRequest(request);
  console.log(`[simulate] enqueued job ${jobId} for ${request.requestId}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
