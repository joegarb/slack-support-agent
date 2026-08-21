import { IssueLink, SupportRequest } from "../shared";

// Just the slice of the Slack client we use — avoids coupling to a specific @slack/web-api
// copy (Bolt bundles its own).
interface SlackReader {
  conversations: {
    replies(args: {
      channel: string;
      ts: string;
      limit?: number;
      cursor?: string;
    }): Promise<{ messages?: ThreadMessage[]; response_metadata?: { next_cursor?: string } }>;
  };
}

type ThreadMessage = { ts?: string; text?: string; user?: string; bot_id?: string };

// Context handed to the agent: the root plus the most recent replies up to the mention,
// capped at THREAD_LIMIT. PAGE_SIZE × MAX_PAGES bounds the paging on a very long thread.
const THREAD_LIMIT = 50;
const PAGE_SIZE = 200;
const MAX_PAGES = 10;

const ISSUE_URL_PATTERNS: { tracker: IssueLink["tracker"]; re: RegExp }[] = [
  { tracker: "linear", re: /https?:\/\/linear\.app\/[^\s/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/ },
  { tracker: "jira", re: /https?:\/\/[a-z0-9-]+\.atlassian\.net\/browse\/([A-Za-z][A-Za-z0-9]*-\d+)/i },
];

// An @mention. In a thread, hand the agent the whole thread up to the mention (the ticket
// plus every reply) and answer there; at top level, investigate the mention text itself.
// thread_ts || ts is always defined, so the reply is always threaded.
export async function parseMention(event: unknown, client: SlackReader): Promise<SupportRequest | null> {
  const e = event as { text?: string; ts?: string; thread_ts?: string; channel?: string; user?: string };
  if (!e.ts || !e.channel) return null;

  // Top-level mention: the mention text is the whole request.
  if (!e.thread_ts) {
    const instruction = stripMention(e.text ?? "");
    if (!instruction) return null;
    return build(e, instruction, instruction, e.user, e.ts);
  }

  // In-thread mention: root sets the subject/affected user; the transcript is the body.
  const { messages, dropped } = await fetchThreadContext(client, e.channel, e.thread_ts, e.ts);
  const root = messages[0];
  const subjectText = root?.text ?? stripMention(e.text ?? "");
  const body = messages.length ? renderThread(messages, dropped) : stripMention(e.text ?? "");
  if (!body) return null;
  return build(e, subjectText, body, root?.user ?? e.user, e.thread_ts);
}

function build(
  e: { ts?: string; channel?: string },
  subjectText: string,
  body: string,
  user: string | undefined,
  threadTs: string | undefined
): SupportRequest {
  return {
    requestId: `msg-${e.ts}`, // the mention event is the trigger; dedupes Slack retries
    userId: user,
    subject: subjectText.split("\n")[0].slice(0, 120),
    body,
    slackChannel: e.channel,
    slackThreadTs: threadTs,
    issue: findIssue(body),
  };
}

// A direct message to the bot; the whole message is the request. Reply in-thread under it.
export function parseDirectMessage(message: unknown): SupportRequest | null {
  const m = message as { text?: string; ts?: string; channel?: string; user?: string };
  if (!m?.text || !m.ts) return null;

  return {
    requestId: `msg-${m.ts}`,
    userId: m.user,
    subject: m.text.split("\n")[0].slice(0, 120),
    body: m.text,
    slackChannel: m.channel,
    slackThreadTs: m.ts,
    issue: findIssue(m.text),
  };
}

// conversations.replies returns the thread oldest-first from the root and pages forward,
// so to get the messages *leading up to* the mention we page until we reach it, then keep
// the root plus the most recent THREAD_LIMIT-1 replies.
async function fetchThreadContext(
  client: SlackReader,
  channel: string,
  threadTs: string,
  mentionTs: string
): Promise<{ messages: ThreadMessage[]; dropped: number }> {
  const all: ThreadMessage[] = [];
  let cursor: string | undefined;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await client.conversations.replies({ channel, ts: threadTs, limit: PAGE_SIZE, cursor });
      const batch = res.messages ?? [];
      all.push(...batch);
      if (batch.some((m) => m.ts === mentionTs)) break; // reached the mention; ignore anything after it
      cursor = res.response_metadata?.next_cursor || undefined;
      if (!cursor) break;
    }
  } catch (err) {
    console.log(`[intake] could not fetch thread (${(err as Error).message})`);
    return { messages: [], dropped: 0 };
  }

  const idx = all.findIndex((m) => m.ts === mentionTs);
  const upToMention = idx >= 0 ? all.slice(0, idx + 1) : all;
  if (upToMention.length <= THREAD_LIMIT) return { messages: upToMention, dropped: 0 };
  const [root, ...rest] = upToMention;
  const messages = [root, ...rest.slice(-(THREAD_LIMIT - 1))];
  return { messages, dropped: upToMention.length - messages.length };
}

// Render the thread as a plain transcript for the agent. Messages are oldest-first with the
// root at index 0; when replies were dropped for length, mark the gap right after the root
// so the agent knows the next line isn't the ticket's first reply.
function renderThread(messages: ThreadMessage[], dropped: number): string {
  const lines = messages
    .filter((m) => (m.text ?? "").trim())
    .map((m) => {
      const who = m.user ? `<@${m.user}>` : m.bot_id ? "bot" : "unknown";
      return `${who}: ${m.text}`;
    });
  if (dropped > 0 && lines.length) {
    lines.splice(1, 0, `[… ${dropped} earlier repl${dropped === 1 ? "y" : "ies"} omitted for length …]`);
  }
  return lines.join("\n");
}

function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

// A tracking issue is linked only when its URL is in the message; the host identifies the
// tracker, so nothing about Linear vs Jira needs configuring.
function findIssue(text: string): IssueLink | undefined {
  for (const { tracker, re } of ISSUE_URL_PATTERNS) {
    const match = text.match(re);
    if (match) return { tracker, key: match[1].toUpperCase(), url: match[0] };
  }
  return undefined;
}
