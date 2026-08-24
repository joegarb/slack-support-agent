# slack-support-agent

A Slack support agent: an intake app that turns a Slack request into a job and a BullMQ worker that
runs a tool-using agent to investigate it across read-only data sources: searching the codebase,
checking production logs, querying the database, accessing internal systems, and searching past tickets.

Summon it by @mentioning the bot in a thread (it investigates that thread) or DMing it. It replies
in-thread and posts the full write-up to a linked Linear/Jira issue when available.

## Design

```
                 Slack thread ◀── a support issue is discussed
                         │  a human @mentions the agent
                         ▼
                 ┌────────────────┐   enqueue (jobId = requestId)  ┌────────────┐
                 │   intake       │ ─────────────────────────────▶ │   Redis    │
                 │  Socket Mode   │   reads the thread via         │  (BullMQ)  │
                 │  or Events API │   conversations.replies        └─────┬──────┘
                 └────────────────┘                                      │ consume
                                                                         ▼
                                                                ┌──────────────────┐
                                                                │      worker       │
                                                                │  tool-calling     │
                                                                │  agent            │
                                                                └───┬──────────┬────┘
            read-only tools (evidence)                              │          │  write actions
   ┌──────────────┬──────────────┬───────────────┬─────────────────┘          └───────┬─────────┐
   ▼              ▼              ▼               ▼                                      ▼         ▼
 Cloud        read-replica    Zendesk       subscription /                        Slack       issue
 Logging      DB              (past          balance API   + ripgrep over          thread     tracker
 (logs)                        tickets)                      a cloned checkout
```

## Notes

- An investigation runs a few minutes (a dozen or more model calls across the agent and its
  sub-agents). Doing that inline would miss Slack's 3-second ack and lose the work on a crash, so
  intake enqueues (`jobId = requestId` for idempotency) and the worker runs it with retries and
  horizontal scaling.
- The agent posts a threaded reply rather than using Slack's live assistant UI, which suits quick
  conversational turns, not a minutes-long background job. It adds an in-progress reaction while it
  works and posts one reply when it's done.
- `search_logs` and `search_codebase` are themselves tool-using agents, each choosing its own strategy
  over a small primitive (a log query; ripgrep plus file reads).
- Every tool is read-only except the write-backs, the agent suggests rather than acts, and prod data
  carries PII, so redact what reaches the model.

## Configuration

Options are environment variables (see [`.env.example`](.env.example)). Both processes read the same
`.env`.

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection shared by intake and the worker |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | Provider key; set the one your model uses |
| `LLM_MODEL` | `anthropic:claude-sonnet-5` | Agent model, as `provider:model` |
| `LLM_SUBAGENT_MODEL` | = `LLM_MODEL` | Model for the log/code sub-agents (often a cheaper one) |
| `CODE_REPO_DIR` | — | Local checkout for code search; unset skips the code sub-agent |
| `SLACK_BOT_TOKEN` | — | Bot token; required to post to Slack |
| `SLACK_APP_TOKEN` | — | Set to run intake in Socket Mode |
| `SLACK_SIGNING_SECRET` | — | Set to run intake on the Events API (HTTP) instead |
| `PORT` | `8080` | Events API port |

The Slack app subscribes to the `app_mention` and `message.im` events and needs the
`app_mentions:read`, `chat:write`, `reactions:write`, and `*:history` scopes; the last lets it read
the mentioned thread via `conversations.replies`.

## Run it

Requires Node 18+ and Docker, plus an API key for your chosen provider.

### Locally

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...      # or OPENAI_API_KEY; or put it in .env

npm run redis:up
npm run worker      # terminal 1: the consumer
npm run simulate    # terminal 2: inject a test message
npm run redis:down
```

`npm run simulate` sends a fake direct message through the real parse and enqueue path, so you can
watch a full investigation without Slack credentials.

To connect a real workspace, fill in `.env` and run `npm run intake`.

### With Docker Compose

Fill in `.env` (provider key plus Slack tokens), then build and start Redis, intake, and the worker:

```bash
docker compose up -d --build
docker compose logs -f worker    # watch investigations
docker compose down
```

To enable code search, uncomment the volume and `CODE_REPO_DIR` in `docker-compose.yml`.
