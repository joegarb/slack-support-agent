import { WebClient } from "@slack/web-api";
import { IssueLink } from "../shared";

let _slack: WebClient | null = null;
function slack(): WebClient | null {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;
  return (_slack ??= new WebClient(token));
}

// Always a threaded reply. A missing thread_ts would post to the channel root, so bail
// rather than emit a detached top-level message. Also falls back to logging with no token.
export async function postToSlack(args: { channel?: string; threadTs?: string; text: string }): Promise<void> {
  const client = slack();
  if (!client) {
    console.log(`\n[writeback:slack] (not posted — no SLACK_BOT_TOKEN)\n${indent(args.text)}`);
    return;
  }
  if (!args.channel) {
    console.log(`\n[writeback:slack] (not posted — no channel)\n${indent(args.text)}`);
    return;
  }
  if (!args.threadTs) {
    console.log(`[writeback:slack] not posted — no thread_ts (would post top-level) in ${args.channel}`);
    return;
  }
  try {
    await client.chat.postMessage({ channel: args.channel, thread_ts: args.threadTs, text: args.text });
    console.log(`[writeback:slack] replied in ${args.channel} (thread ${args.threadTs ?? "—"})`);
  } catch (err) {
    console.log(`[writeback:slack] post failed (${(err as Error).message}); would have posted:\n${indent(args.text)}`);
  }
}

// Added when a job starts, removed when it finishes — an at-a-glance "working on it".
const PROGRESS_EMOJI = "hourglass_flowing_sand";

export async function addProgressReaction(channel?: string, timestamp?: string): Promise<void> {
  const client = slack();
  if (!client || !channel || !timestamp) return;
  try {
    await client.reactions.add({ name: PROGRESS_EMOJI, channel, timestamp });
  } catch (err) {
    const msg = (err as Error).message;
    if (!msg.includes("already_reacted")) console.log(`[writeback:slack] reaction add failed (${msg})`);
  }
}

export async function removeProgressReaction(channel?: string, timestamp?: string): Promise<void> {
  const client = slack();
  if (!client || !channel || !timestamp) return;
  try {
    await client.reactions.remove({ name: PROGRESS_EMOJI, channel, timestamp });
  } catch (err) {
    const msg = (err as Error).message;
    if (!msg.includes("no_reaction")) console.log(`[writeback:slack] reaction remove failed (${msg})`);
  }
}

// TODO stub of writing findings to the issue in Linear/Jira.
export async function postToIssue(issue: IssueLink, comment: string): Promise<void> {
  console.log(`\n[writeback:${issue.tracker}] → comment on ${issue.key} (${issue.url})\n  | ${comment}`);
}

function indent(s: string): string {
  return s.split("\n").map((l) => `  | ${l}`).join("\n");
}
