import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import { SupportRequest } from "../shared";
import { model, DEFAULT_MODEL } from "./model";
import { agentTools } from "./tools";
import { postToSlack, postToIssue } from "./writeback";

const SYSTEM = `You are a support engineer's assistant. Investigate an incoming support request (a ticket, a channel question, or a direct message) using the READ-ONLY tools available (log investigation, a read-only SQL query, the system of record, past tickets, and code search).

Gather concrete evidence before concluding — call the tools you need, in whatever order makes sense. You only investigate and suggest; a human reviews and takes any action (refunds, corrections). Never claim you performed an action, and never invent evidence.

When you have enough evidence, write your diagnosis: the most likely root cause, the evidence for it (cite log lines, DB rows, prior tickets, code file:line), a suggested fix, an impact/severity read, your confidence, and anything still unknown.`;

const diagnosisSchema = z.object({
  summary: z.string().describe("2–4 sentence Slack-ready summary: root cause + suggested fix."),
  detail: z.string().describe("Full write-up: evidence with citations, the suggested fix, and anything still unknown."),
  severity: z.enum(["low", "medium", "high"]).describe("Impact: high = money moved wrongly / data loss / blocked usage; medium = degraded but recoverable; low = cosmetic."),
  confidence: z.enum(["low", "medium", "high"]).describe("How strongly the evidence supports the conclusion."),
});
type Diagnosis = z.infer<typeof diagnosisSchema>;

export interface InvestigationResult {
  requestId: string;
  summary: string;
  severity: string;
  confidence: string;
  toolCalls: number;
}

export async function runAgent(request: SupportRequest): Promise<InvestigationResult> {
  console.log(`[agent] investigating ${request.requestId} with ${DEFAULT_MODEL}`);

  const { text, steps, usage } = await generateText({
    model: model(DEFAULT_MODEL),
    // Cache the static system+tools prefix — Anthropic breakpoint + OpenAI key, each
    // ignored by the other provider.
    providerOptions: { openai: { promptCacheKey: "slack-support-agent" } },
    system: {
      role: "system",
      content: SYSTEM,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    prompt: buildPrompt(request),
    tools: agentTools,
    maxOutputTokens: 4000,
    stopWhen: stepCountIs(12),
  });

  // Two-phase: investigate as prose above, then structure it here — the schema-validated
  // output pass is reliable where a terminal submit-diagnosis tool wasn't.
  const { output: diag } = await generateText({
    model: model(DEFAULT_MODEL),
    output: Output.object({ schema: diagnosisSchema }),
    prompt: `Convert this investigation into a structured diagnosis.\n\n${text}`,
  });

  const toolCalls = steps.flatMap((s) => s.toolCalls).length;
  // One round-trip per step + the structuring call; sub-agents log their own.
  const llmCalls = steps.length + 1;

  await postToSlack({
    channel: request.slackChannel,
    threadTs: request.slackThreadTs,
    text: formatReply(request, diag),
  });
  if (request.issue) await postToIssue(request.issue, diag.detail);

  console.log(
    `[agent] done — ${llmCalls} LLM call(s) at this level (${steps.length} agent + 1 structuring), ${toolCalls} tool call(s), severity=${diag.severity}, confidence=${diag.confidence}, cacheRead=${cachedTokens(usage)}`
  );
  return {
    requestId: request.requestId,
    summary: diag.summary,
    severity: diag.severity,
    confidence: diag.confidence,
    toolCalls,
  };
}

function buildPrompt(r: SupportRequest): string {
  return [
    "Investigate this request and diagnose the likely cause.",
    "",
    `Request: ${r.requestId}`,
    r.issue ? `Tracking issue: ${r.issue.key} (${r.issue.tracker})` : "",
    r.userId ? `User: ${r.userId}` : "",
    `Subject: ${r.subject}`,
    `Body: ${r.body}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatReply(r: SupportRequest, diag: Diagnosis): string {
  // Linked to an issue → summary here, full detail on the issue; otherwise the detail
  // goes in the Slack thread so it isn't lost.
  const body = r.issue ? diag.summary : `${diag.summary}\n\n${diag.detail}`;
  const closing = r.issue
    ? `_Suggestion only — review before acting. Full write-up on ${r.issue.key}._`
    : `_Suggestion only — review before acting._`;
  return (
    `*Automated investigation — ${r.issue?.key ?? r.requestId}*  ` +
    `_(severity: ${diag.severity} · confidence: ${diag.confidence})_\n` +
    `${body}\n\n${closing}`
  );
}

function cachedTokens(usage: unknown): number {
  const u = usage as { cachedInputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number } };
  return u?.inputTokenDetails?.cacheReadTokens ?? u?.cachedInputTokens ?? 0;
}
