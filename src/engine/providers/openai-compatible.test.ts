import assert from "node:assert/strict";
import test from "node:test";
import { doctorHandshake } from "../doctor.ts";
import { OpenAICompatibleProvider } from "./openai-compatible.ts";
import { createLLMClient } from "./factory.ts";

test("compatible provider normalizes base URL and omits unsupported OpenAI fields", async () => {
  let receivedUrl = "";
  let receivedBody: Record<string, unknown> = {};
  const fetcher: typeof fetch = async (input, init) => {
    receivedUrl = String(input);
    receivedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
  };
  const provider = new OpenAICompatibleProvider(
    { providerId: "generic", baseUrl: " http://localhost:11434/v1/chat/completions/// " },
    fetcher,
  );
  await provider.complete({
    model: "test-model",
    messages: [{ role: "user", content: "hello" }],
    store: true,
    reasoningEffort: "high",
  });
  assert.equal(provider.config.baseUrl, "http://localhost:11434/v1");
  assert.equal(provider.config.apiKey, "sk-helix-local");
  assert.equal(receivedUrl, "http://localhost:11434/v1/chat/completions");
  assert.equal("store" in receivedBody, false);
  assert.equal("reasoning_effort" in receivedBody, false);
});

test("doctor handshake falls back to a one-token probe only after 404 or 405", async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/models")) return new Response("missing", { status: 404 });
    return Response.json({ choices: [{ message: { content: "" } }] });
  };
  const provider = new OpenAICompatibleProvider(
    { providerId: "generic", baseUrl: "https://gateway.test/v1" },
    fetcher,
  );
  const result = await doctorHandshake(provider, fetcher);
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.length, 2);
  assert.equal(result.diagnostics[0]?.rawBody, "missing");
  assert.equal(result.diagnostics[1]?.status, 200);
  assert.match(String(requests[1]), /POST .*\/chat\/completions/);

  const unauthorizedFetch: typeof fetch = async () => new Response("denied", { status: 401 });
  const unauthorized = await doctorHandshake(provider, unauthorizedFetch);
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.diagnostics.length, 1);
});

test("client factory selects official OpenAI defaults and compatible clients for custom endpoints", () => {
  const official = createLLMClient({ providerId: "openai", source: "default" });
  const custom = createLLMClient({
    providerId: "openai",
    baseUrl: "https://gateway.test/v1",
    source: "cli",
  });
  assert.equal(official.providerId, "openai");
  assert.equal((official as OpenAICompatibleProvider).capabilities.supportsStoreFlag, true);
  assert.equal(custom.capabilities.supportsStoreFlag, false);
});
