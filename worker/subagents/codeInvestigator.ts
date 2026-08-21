import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { model, SUBAGENT_MODEL } from "../model";

const execFileAsync = promisify(execFile);

// Code-investigation sub-agent: greps and reads a checkout of the app's source code.
// Point CODE_REPO_DIR at a local checkout; unset, the tool is skipped (see tools.ts).
const REPO_DIR = process.env.CODE_REPO_DIR ? path.resolve(process.env.CODE_REPO_DIR) : "";
export const CODE_SEARCH_ENABLED = REPO_DIR !== "" && fs.existsSync(REPO_DIR);

const SYSTEM = `You are a code-investigation agent working over a checkout of the application's source. You have two read-only tools: grep_code (search the repository for a pattern) and read_file (read a file). Given an investigation goal, search for relevant code, read the promising files to confirm, and report the specific location(s) and the code that bears on the goal — cite file:line. If you find nothing relevant, say so. You never modify code.`;

const grepCode = tool({
  description: "Search the repository source for a pattern (ripgrep). Returns matching file:line results.",
  inputSchema: z.object({
    pattern: z.string().describe("Text or regex to search for."),
    maxResults: z.number().optional().describe("Max matching lines. Default 10."),
  }),
  execute: async ({ pattern, maxResults }) => {
    console.log(`     ↳ grep_code(pattern="${pattern}")  → ripgrep [read-only]`);
    try {
      const { stdout } = await execFileAsync("rg", [
        "--line-number",
        "--no-heading",
        "--max-count",
        String(maxResults ?? 10),
        pattern,
        REPO_DIR,
      ]);
      const out = stdout.trim();
      return out ? relativize(out) : "no matches";
    } catch (err: unknown) {
      const e = err as { code?: number | string };
      if (e.code === "ENOENT") return nodeGrep(REPO_DIR, pattern); // ripgrep not on PATH
      if (e.code === 1) return "no matches"; // rg exits 1 when nothing matches
      throw err;
    }
  },
});

const readFile = tool({
  description: "Read a source file's contents (read-only). Path is relative to the repo root.",
  inputSchema: z.object({
    path: z.string().describe("File path relative to the repo root, e.g. src/billing.ts."),
  }),
  execute: async ({ path: rel }) => {
    console.log(`     ↳ read_file(path="${rel}")  → [read-only]`);
    const full = path.resolve(REPO_DIR, rel);
    // Keep reads inside the checkout.
    if (full !== REPO_DIR && !full.startsWith(REPO_DIR + path.sep)) {
      return "ERROR: path is outside the repository.";
    }
    try {
      return withLineNumbers(fs.readFileSync(full, "utf8")).slice(0, 8000);
    } catch {
      return "ERROR: file not found.";
    }
  },
});

export async function investigateCode(goal: string): Promise<string> {
  const { text, steps } = await generateText({
    model: model(SUBAGENT_MODEL),
    providerOptions: { openai: { promptCacheKey: "slack-support-agent-code" } },
    system: {
      role: "system",
      content: SYSTEM,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    prompt: `Investigation goal:\n${goal}`,
    tools: { grep_code: grepCode, read_file: readFile },
    maxOutputTokens: 4000,
    stopWhen: stepCountIs(6),
  });
  console.log(
    `     ↳ code sub-agent finished (${steps.length} LLM call(s), ${steps.flatMap((s) => s.toolCalls).length} tool call(s))`
  );
  return text;
}

// Fallback line search when ripgrep isn't installed.
function nodeGrep(dir: string, query: string): string {
  const hits: string[] = [];
  const needle = query.toLowerCase();
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        fs.readFileSync(full, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (line.toLowerCase().includes(needle)) {
              hits.push(`${path.relative(REPO_DIR, full)}:${i + 1}:${line.trim()}`);
            }
          });
      }
    }
  };
  walk(dir);
  return hits.length ? hits.join("\n") : "no matches";
}

function relativize(rgOutput: string): string {
  return rgOutput.split("\n").map((l) => l.replace(REPO_DIR + path.sep, "")).join("\n");
}

function withLineNumbers(text: string): string {
  return text
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(4)}  ${line}`)
    .join("\n");
}
