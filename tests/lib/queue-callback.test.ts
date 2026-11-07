// The queue consumer accepts only the callback the SDK checks with the queue
// service (audit R3). src/lib/queue-callback.ts carries the reasoning.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLOUD_EVENT_TYPE_V1BETA, CLOUD_EVENT_TYPE_V2BETA, parseCallback } from "@vercel/queue";
import { unverifiableCallbackReason, VERIFIED_TRIGGER_TYPE } from "@/lib/queue-callback";

const BINARY = {
  "ce-type": CLOUD_EVENT_TYPE_V2BETA,
  "ce-vqsqueuename": "document-extraction",
  "ce-vqsconsumergroup": "document-extraction-worker",
  "ce-vqsmessageid": "0-1",
  "ce-vqsreceipthandle": "forged",
};

describe("unverifiableCallbackReason", () => {
  it("refuses the binary shape, whose payload is the request's own body", async () => {
    const headers = new Headers(BINARY);
    expect(unverifiableCallbackReason(headers)).toBe("binary-mode callback");
    // The premise, read off the SDK itself: this shape carries its payload
    // inline, so the SDK would never ask the service for it.
    const parsed = await parseCallback(new Request("http://x/", { method: "POST", headers, body: "{}" }));
    expect("receiptHandle" in parsed).toBe(true);
  });

  it("refuses any other ce-type, and a receipt handle in a header whatever the type says", () => {
    expect(unverifiableCallbackReason(new Headers({ "ce-type": "com.vercel.queue.v3" }))).toBe("unknown callback type");
    expect(unverifiableCallbackReason(new Headers({ "ce-type": CLOUD_EVENT_TYPE_V2BETA.toUpperCase() }))).toBe(
      "unknown callback type",
    );
    expect(unverifiableCallbackReason(new Headers({ "ce-vqsreceipthandle": "x" }))).toBe("receipt handle in the request");
  });

  it("lets the structured shape through, which the SDK receives from the service by id", async () => {
    const headers = new Headers({ "content-type": "application/cloudevents+json" });
    expect(unverifiableCallbackReason(headers)).toBeNull();
    expect(unverifiableCallbackReason(new Headers({ "ce-type": CLOUD_EVENT_TYPE_V1BETA }))).toBeNull();
    const event = {
      type: CLOUD_EVENT_TYPE_V1BETA,
      source: "x",
      id: "1",
      data: { queueName: "document-extraction", consumerGroup: "document-extraction-worker", messageId: "0-1" },
    };
    const parsed = await parseCallback(new Request("http://x/", { method: "POST", headers, body: JSON.stringify(event) }));
    expect("receiptHandle" in parsed).toBe(false);
  });
});

describe("the trigger the guard is written for", () => {
  // Moving the trigger to queue/v2beta makes the platform send the binary
  // shape for every small message, and the guard would refuse them all.
  // Read src/lib/queue-callback.ts before changing either side.
  it("is the v1beta trigger, which sends the structured shape", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      functions: Record<string, { experimentalTriggers?: { type: string }[] }>;
    };
    const triggers = Object.values(config.functions).flatMap((f) => f.experimentalTriggers ?? []);
    expect(triggers.length).toBeGreaterThan(0);
    for (const trigger of triggers) expect(trigger.type).toBe(VERIFIED_TRIGGER_TYPE);
  });

  it("is applied before handleCallback in the route", () => {
    const route = readFileSync("src/app/api/queues/[topic]/route.ts", "utf8");
    const post = route.slice(route.indexOf("export async function POST"));
    expect(post.indexOf("unverifiableCallbackReason")).toBeGreaterThan(-1);
    expect(post.indexOf("unverifiableCallbackReason")).toBeLessThan(post.indexOf("queueHandler(request)"));
  });
});
