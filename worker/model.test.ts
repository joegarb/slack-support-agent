import { describe, it, expect } from "vitest";
import { model, DEFAULT_MODEL } from "./model";

describe("model", () => {
  it("resolves provider:model specs", () => {
    expect(model("anthropic:claude-sonnet-5")).toBeTruthy();
    expect(model("openai:gpt-4o")).toBeTruthy();
  });

  it("defaults to anthropic without a provider prefix", () => {
    expect(model("claude-sonnet-5")).toBeTruthy();
  });

  it("throws on an unknown provider", () => {
    expect(() => model("mystery:model")).toThrow(/Unknown model provider/);
  });

  it("DEFAULT_MODEL is a provider:model string", () => {
    expect(DEFAULT_MODEL).toMatch(/^[a-z]+:.+/);
  });
});
