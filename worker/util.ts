/** Simulate a little latency so the tool-call sequence is legible when running. */
export function delay(ms = 250): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
