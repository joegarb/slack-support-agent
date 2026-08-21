import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { model, SUBAGENT_MODEL } from "../model";
import { delay } from "../util";

// Log-investigation sub-agent: picks read-only queries and reports what's relevant.
// Runs on SUBAGENT_MODEL (typically a cheaper model).

const SYSTEM = `You are a log-investigation agent for a production system. You have one tool, run_log_query, which runs a READ-ONLY GCP Cloud Logging query and returns matching entries.

Given an investigation goal, decide what queries to run — you may run several, narrowing as you learn more. Then report a concise summary of only what is relevant to the goal, citing timestamps and severities. If you find nothing useful, say so plainly. You do not fix anything; you only report what the logs show.`;

// TODO stubbed with sample entries
const runLogQuery = tool({
  description: "Run a read-only GCP Cloud Logging query and return matching entries.",
  inputSchema: z.object({
    filter: z.string().describe("A Cloud Logging filter or free-text search."),
    hours: z.number().optional().describe("How many hours back to search. Default 24."),
  }),
  execute: async ({ filter, hours }) => {
    const h = hours ?? 24;
    console.log(`     ↳ run_log_query(filter="${filter}", hours=${h})  → Cloud Logging [read-only]`);
    await delay();
    if (/user_12345|charge|payment|duplicate|504|retry|billing/i.test(filter)) {
      return JSON.stringify({
        entries: [
          { ts: "02:14:05Z", severity: "INFO", msg: "charge initiated for user_12345 (£29.00), idempotency_key=absent" },
          { ts: "02:14:06Z", severity: "WARNING", msg: "upstream payment gateway returned 504; scheduling retry" },
          { ts: "02:14:07Z", severity: "INFO", msg: "charge retried for user_12345 (£29.00)" },
          { ts: "02:14:09Z", severity: "ERROR", msg: "reconciliation: two settled charges for user_12345 within 3s" },
        ],
      });
    }
    return JSON.stringify({ entries: [], note: `no entries matched in the last ${h}h` });
  },
});

export async function investigateLogs(goal: string): Promise<string> {
  const { text, steps } = await generateText({
    model: model(SUBAGENT_MODEL),
    providerOptions: { openai: { promptCacheKey: "slack-support-agent-logs" } },
    system: {
      role: "system",
      content: SYSTEM,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    prompt: `Investigation goal:\n${goal}`,
    tools: { run_log_query: runLogQuery },
    maxOutputTokens: 4000,
    stopWhen: stepCountIs(4),
  });
  console.log(
    `     ↳ log sub-agent finished (${steps.length} LLM call(s), ${steps.flatMap((s) => s.toolCalls).length} query call(s))`
  );
  return text;
}
