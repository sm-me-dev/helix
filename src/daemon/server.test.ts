import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startHelixDaemon } from "./server.ts";

async function readSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buffer: string,
): Promise<{ event: Record<string, unknown>; buffer: string }> {
  const decoder = new TextDecoder();
  while (true) {
    const boundary = buffer.indexOf("\n\n");
    if (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
      if (dataLine)
        return { event: JSON.parse(dataLine.slice(6)) as Record<string, unknown>, buffer };
      continue;
    }
    const chunk = await reader.read();
    if (chunk.done) throw new Error("SSE stream ended before expected event");
    buffer += decoder.decode(chunk.value, { stream: true });
  }
}

test("daemon streams sequenced events and resolves approval over REST without a terminal", async () => {
  const daemon = await startHelixDaemon({
    host: "127.0.0.1",
    port: 0,
    runtime: {
      async prompt(_sessionId, prompt, callback) {
        const decision = await callback.requestApproval({
          actionType: "shell",
          commandOrPath: "npm test",
          riskLevel: "medium",
        });
        callback.emit({
          type: "message.delta",
          role: "assistant",
          delta_text: `${prompt}: ${decision.decision}`,
        });
      },
    },
  });
  try {
    const base = `http://${daemon.host}:${daemon.port}`;
    const created = await fetch(`${base}/api/sessions`, { method: "POST" });
    assert.equal(created.status, 201);
    const { session } = (await created.json()) as { session: { id: string } };
    const streamResponse = await fetch(`${base}/api/sessions/${session.id}/events`);
    assert.equal(streamResponse.status, 200);
    const reader = streamResponse.body!.getReader();
    const peerStreamResponse = await fetch(`${base}/api/sessions/${session.id}/events`);
    assert.equal(peerStreamResponse.status, 200);
    const peerReader = peerStreamResponse.body!.getReader();
    let buffer = "";

    const promptResponse = await fetch(`${base}/api/sessions/${session.id}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "inspect" }),
    });
    assert.equal(promptResponse.status, 202);
    let next = await readSseEvent(reader, buffer);
    buffer = next.buffer;
    const peerUserEvent = await readSseEvent(peerReader, "");
    const userEvent = next.event;
    next = await readSseEvent(reader, buffer);
    buffer = next.buffer;
    const peerApprovalEvent = await readSseEvent(peerReader, peerUserEvent.buffer);
    const approvalEvent = next.event;
    assert.equal(userEvent.type, "message.delta");
    assert.equal(peerUserEvent.event.id, userEvent.id);
    assert.equal(approvalEvent.type, "approval.required");
    assert.equal(peerApprovalEvent.event.id, approvalEvent.id);

    const gateId = String(approvalEvent.gate_id);
    const approved = await fetch(`${base}/api/sessions/${session.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gateId, decision: "approve" }),
    });
    assert.equal(approved.status, 200);
    next = await readSseEvent(reader, buffer);
    const peerResultEvent = await readSseEvent(peerReader, peerApprovalEvent.buffer);
    assert.equal(next.event.type, "message.delta");
    assert.equal(peerResultEvent.event.id, next.event.id);
    assert.equal((next.event as { delta_text: string }).delta_text, "inspect: approve");
    const ids = [userEvent, approvalEvent, next.event].map((event) => Number(event.id));
    assert.deepEqual(ids, [1, 2, 3]);
    await reader.cancel();
    await peerReader.cancel();
  } finally {
    await daemon.close();
  }
});

test("daemon hosts the SPA and exposes task rollback to session clients", async () => {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), "helix-web-root-"));
  fs.mkdirSync(path.join(webRoot, "assets"));
  fs.writeFileSync(path.join(webRoot, "index.html"), "<main>Helix UI</main>");
  fs.writeFileSync(path.join(webRoot, "assets", "app.js"), "globalThis.helix = true;");
  const rolledBack: string[] = [];
  const daemon = await startHelixDaemon({
    host: "127.0.0.1",
    port: 0,
    webRoot,
    runtime: {
      async prompt(_sessionId, _prompt, callback) {
        callback.emit({
          type: "dag.state.updated",
          spec_id: "task-42",
          nodes: [{ id: "task-42", label: "Task 42", stage: "Done", status: "done" }],
          edges: [],
        });
      },
      async rollback(_sessionId, taskId) {
        rolledBack.push(taskId);
        return { rolledBack: true, message: "Discarded helix/" + taskId };
      },
    },
  });
  try {
    const base = "http://" + daemon.host + ":" + daemon.port;
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Helix UI/);
    const route = await fetch(base + "/sessions/shared-view", { headers: { Accept: "text/html" } });
    assert.equal(await route.text(), "<main>Helix UI</main>");
    const asset = await fetch(base + "/assets/app.js");
    assert.equal(asset.headers.get("content-type"), "text/javascript; charset=utf-8");

    const created = await fetch(base + "/api/sessions", { method: "POST" });
    const { session } = (await created.json()) as { session: { id: string } };
    await fetch(base + "/api/sessions/" + session.id + "/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "create checkpoint" }),
    });
    const rollback = await fetch(base + "/api/sessions/" + session.id + "/rollback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-42" }),
    });
    assert.equal(rollback.status, 200);
    assert.deepEqual(await rollback.json(), {
      rolledBack: true,
      message: "Discarded helix/task-42",
    });
    assert.deepEqual(rolledBack, ["task-42"]);

    const invalid = await fetch(base + "/api/sessions/" + session.id + "/rollback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "../workspace" }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await daemon.close();
    fs.rmSync(webRoot, { recursive: true, force: true });
  }
});
