import { describe, it, expect } from "vitest";
import { agentTools } from "./tools";
import { runAgent } from "./agent";

describe("query_prod_db", () => {
  const run = (sql: string) => agentTools.query_prod_db.execute!({ sql }, {} as never) as Promise<string>;

  it("refuses anything that isn't a SELECT", async () => {
    expect(await run("DELETE FROM charges WHERE 1=1")).toMatch(/only read-only SELECT/i);
    expect(await run("DROP TABLE charges")).toMatch(/only read-only SELECT/i);
  });

  it("runs a SELECT and returns rows", async () => {
    expect(await run("SELECT * FROM charges")).toContain("rows");
  });
});

describe("modules load", () => {
  // The import above is the point here: a dependency bump that throws at load fails this
  // test, which typecheck alone wouldn't catch.
  it("agent module graph imports cleanly", () => {
    expect(typeof runAgent).toBe("function");
  });
});
