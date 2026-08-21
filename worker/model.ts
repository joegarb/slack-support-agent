import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

// Resolves "provider:model" string (e.g. "anthropic:claude-sonnet-5", "openai:gpt-4o") to a model in the SDK
export function model(spec: string): LanguageModel {
  const idx = spec.indexOf(":");
  const provider = idx === -1 ? "anthropic" : spec.slice(0, idx);
  const id = idx === -1 ? spec : spec.slice(idx + 1);
  switch (provider) {
    case "anthropic":
      return anthropic(id);
    case "openai":
      return openai(id);
    default:
      throw new Error(
        `Unknown model provider "${provider}" in "${spec}" (expected "anthropic:…" or "openai:…").`
      );
  }
}

export const DEFAULT_MODEL = process.env.LLM_MODEL ?? "anthropic:claude-sonnet-5";
export const SUBAGENT_MODEL = process.env.LLM_SUBAGENT_MODEL ?? DEFAULT_MODEL;
