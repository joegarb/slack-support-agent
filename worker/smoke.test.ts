import { describe, it, expect } from "vitest";
import { runAgent } from "./agent";
import { agentTools } from "./tools";

// Importing these pulls in ai / @ai-sdk / @slack/web-api / zod, so a breaking dependency
// bump fails CI at import time before it can auto-merge.
describe("modules load", () => {
  it("agent and tools import cleanly", () => {
    expect(typeof runAgent).toBe("function");
    expect(agentTools).toBeTypeOf("object");
  });
});
