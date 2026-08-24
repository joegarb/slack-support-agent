import { describe, it, expect } from "vitest";
import { parseDirectMessage, parseMention } from "./message";

describe("parseDirectMessage", () => {
  it("builds a request from text + ts", () => {
    const req = parseDirectMessage({ text: "Charged twice\ndetail", ts: "123.45", channel: "D1", user: "U1" });
    expect(req).toMatchObject({
      requestId: "msg-123.45",
      subject: "Charged twice",
      body: "Charged twice\ndetail",
      slackChannel: "D1",
      slackThreadTs: "123.45",
      userId: "U1",
    });
  });

  it("returns null without text or ts", () => {
    expect(parseDirectMessage({ ts: "1" })).toBeNull();
    expect(parseDirectMessage({ text: "hi" })).toBeNull();
  });

  it("truncates the subject to 120 chars", () => {
    expect(parseDirectMessage({ text: "x".repeat(200), ts: "1" })?.subject).toHaveLength(120);
  });

  it("detects a Linear issue URL", () => {
    const req = parseDirectMessage({ text: "see https://linear.app/acme/issue/ENG-4210 pls", ts: "1" });
    expect(req?.issue).toEqual({ tracker: "linear", key: "ENG-4210", url: "https://linear.app/acme/issue/ENG-4210" });
  });

  it("detects a Jira issue URL", () => {
    const req = parseDirectMessage({ text: "https://acme.atlassian.net/browse/SUP-12", ts: "1" });
    expect(req?.issue).toMatchObject({ tracker: "jira", key: "SUP-12" });
  });

  it("leaves issue undefined without a tracker URL", () => {
    expect(parseDirectMessage({ text: "no link", ts: "1" })?.issue).toBeUndefined();
  });
});

type Client = Parameters<typeof parseMention>[1];
const clientReturning = (messages: { ts?: string; text?: string; user?: string }[]): Client => ({
  conversations: { replies: async () => ({ messages }) },
});

describe("parseMention", () => {
  it("top-level mention investigates the mention text", async () => {
    const req = await parseMention(
      { text: "<@UBOT> look into this", ts: "10.0", channel: "C1", user: "U1" },
      clientReturning([]),
    );
    expect(req).toMatchObject({ body: "look into this", slackThreadTs: "10.0", slackChannel: "C1", userId: "U1" });
  });

  it("in-thread mention builds a transcript and replies to the thread", async () => {
    const req = await parseMention(
      { text: "<@UBOT> dig in", ts: "3.0", thread_ts: "1.0", channel: "C1", user: "U1" },
      clientReturning([
        { ts: "1.0", text: "I was billed twice", user: "UCUST" },
        { ts: "2.0", text: "here is the log", user: "UENG" },
        { ts: "3.0", text: "<@UBOT> dig in", user: "U1" },
      ]),
    );
    expect(req?.slackThreadTs).toBe("1.0");
    expect(req?.subject).toBe("I was billed twice");
    expect(req?.userId).toBe("UCUST");
    expect(req?.body).toContain("<@UCUST>: I was billed twice");
    expect(req?.body).toContain("<@UENG>: here is the log");
  });

  it("marks omitted messages when the thread exceeds the limit", async () => {
    const middle = Array.from({ length: 60 }, (_, i) => ({ ts: `${i + 1}.0`, text: `reply ${i}`, user: "UENG" }));
    const req = await parseMention(
      { text: "<@UBOT> help", ts: "999.0", thread_ts: "0.0", channel: "C1", user: "U1" },
      clientReturning([
        { ts: "0.0", text: "root ticket", user: "UCUST" },
        ...middle,
        { ts: "999.0", text: "<@UBOT> help", user: "U1" },
      ]),
    );
    expect(req?.body).toContain("root ticket");
    expect(req?.body).toMatch(/omitted for length/);
  });

  it("returns null without ts or channel", async () => {
    expect(await parseMention({ text: "hi", channel: "C1" }, clientReturning([]))).toBeNull();
    expect(await parseMention({ text: "hi", ts: "1.0" }, clientReturning([]))).toBeNull();
  });
});
