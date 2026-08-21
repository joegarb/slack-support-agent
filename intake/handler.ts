import type { App } from "@slack/bolt";
import { enqueueRequest } from "./queue";
import { parseMention, parseDirectMessage } from "./message";

// The agent is triggered explicitly: an @mention in a channel (investigate the thread it's
// mentioned in), or any direct message. Replies always go in-thread.
export function registerHandler(app: App): void {
  app.event("app_mention", async ({ event, client }) => {
    const request = await parseMention(event, client);
    if (!request) return;
    const jobId = await enqueueRequest(request);
    console.log(`[intake] enqueued job ${jobId} (${request.requestId}) from ${event.channel}`);
  });

  app.message(async ({ message }) => {
    const m = message as { subtype?: string; channel_type?: string; bot_id?: string };
    if (m.subtype || m.bot_id) return; // skip edits/joins and any bot post
    if (m.channel_type !== "im") return; // channels are handled by app_mention

    const request = parseDirectMessage(message);
    if (!request) return;
    const jobId = await enqueueRequest(request);
    console.log(`[intake] enqueued job ${jobId} (${request.requestId}) from DM`);
  });
}
