import { tool } from "ai";
import { z } from "zod";
import { delay } from "./util";
import { investigateLogs } from "./subagents/logInvestigator";
import { investigateCode, CODE_SEARCH_ENABLED } from "./subagents/codeInvestigator";

// Read-only tools the agent can call for investigation/diagnosis

const searchLogs = tool({
  description:
    "Investigate the production logs. Describe in plain language what to find (a user id, an error, a suspected event and time window); a log-investigation agent runs the read-only queries and reports back.",
  inputSchema: z.object({
    goal: z.string().describe("What to look for, in plain language (include the user id and any error/time details)."),
  }),
  execute: async ({ goal }) => {
    console.log(`  🔧 search_logs → log sub-agent\n       goal: "${goal}"`);
    return investigateLogs(goal);
  },
});

const searchCodebase = tool({
  description:
    "Investigate the application source. Describe what to find or confirm (a suspected bug, a code path, a missing guard); a code-investigation agent greps and reads the relevant files and reports with file:line citations.",
  inputSchema: z.object({
    goal: z.string().describe("What to find or confirm in the code, in plain language."),
  }),
  execute: async ({ goal }) => {
    console.log(`  🔧 search_codebase → code sub-agent\n       goal: "${goal}"`);
    return investigateCode(goal);
  },
});

const queryProdDb = tool({
  description:
    "Run a READ-ONLY SQL query against a read replica of the production database. SELECT only. Use to inspect rows relevant to the ticket (charges, orders, balances).",
  inputSchema: z.object({ sql: z.string().describe("A single read-only SELECT statement.") }),
  execute: async ({ sql }) => {
    const q = sql.trim();
    console.log(`  🔧 query_prod_db  → db-readonly.sh [read replica]\n       ${q}`);
    // Fail fast on non-SELECT; the db-readonly.sh role also enforces this in production.
    if (!/^select\b/i.test(q)) return "ERROR: only read-only SELECT statements are permitted.";
    await delay();
    return JSON.stringify({
      rows: [
        { id: "chg_1", user_id: "user_12345", amount_gbp: 29.0, created_at: "02:14:05Z" },
        { id: "chg_2", user_id: "user_12345", amount_gbp: 29.0, created_at: "02:14:07Z" },
      ],
      note: "two identical charges ~2s apart",
    });
  },
});

const getSubscription = tool({
  description:
    "Fetch a user's subscription plan and current credit/balance from the system-of-record service (read-only).",
  inputSchema: z.object({ userId: z.string().describe("The user id.") }),
  execute: async ({ userId }) => {
    console.log(`  🔧 get_subscription(userId="${userId}")  → system-of-record API`);
    await delay();
    return JSON.stringify({ userId, plan: "Pro", status: "active", balance_discrepancy_gbp: 29.0 });
  },
});

const getPastTickets = tool({
  description:
    "Search previously-resolved support tickets for similar issues (Zendesk). Use to find prior art and known resolutions.",
  inputSchema: z.object({
    query: z.string().describe("Keywords describing the issue."),
    limit: z.number().optional().describe("Max tickets to return. Default 3."),
  }),
  execute: async ({ query }) => {
    console.log(`  🔧 get_past_tickets(query="${query}")  → Zendesk Search API`);
    await delay();
    return JSON.stringify({
      tickets: [
        {
          id: "ZD-20871",
          subject: "duplicate charge",
          resolution: "refunded the duplicate; root cause was a retried payment without an idempotency key",
        },
      ],
    });
  },
});

// Keyed by the name the model sees. search_codebase is offered only when CODE_REPO_DIR
// points at a checkout; without it the agent works from the other tools.
export const agentTools = {
  search_logs: searchLogs,
  query_prod_db: queryProdDb,
  get_subscription: getSubscription,
  get_past_tickets: getPastTickets,
  ...(CODE_SEARCH_ENABLED ? { search_codebase: searchCodebase } : {}),
};
