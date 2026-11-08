// `helix ui`: a local-only web view. The server binds loopback, needs a per-launch token,
// rejects foreign Host/Origin headers (DNS rebinding, CSRF) and only runs whitelisted CLI actions.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatTeamProgressEvent, startUi } from "./ui.ts";

const CLI = fileURLToPath(new URL("./helix.mjs", import.meta.url));

describe("team progress rendering", () => {
  it("renders progressive disclosure, peer, and DAG events as compact badges", () => {
    assert.equal(
      formatTeamProgressEvent({ type: "skill_loaded", payload: { domainId: "execution-engine" } }),
      "[L1 Skill Loaded: execution-engine]",
    );
    assert.equal(
      formatTeamProgressEvent({ type: "visibility_tools_unlocked", payload: { count: 3 } }),
      "[Visibility Gate: +3 tools unlocked]",
    );
    assert.equal(
      formatTeamProgressEvent({
        type: "peer_consulted",
        payload: { reviewerModelId: "gpt-6.1-sol" },
      }),
      "[Peer Consult: gpt-6.1-sol]",
    );
    assert.equal(
      formatTeamProgressEvent({
        type: "team_task_state",
        payload: { from: "pending", to: "awaiting_plan_approval" },
      }),
      "[Team DAG: pending -> awaiting_plan_approval]",
    );
  });
});

/** Raw request so tests can set Host/Origin exactly. */
function raw(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("helix ui", () => {
  let ui;
  let dir;
  let cookie;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "helix-ui-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "s", scripts: { test: "x" } }));
    ui = await startUi({ dir, port: 0, cliPath: CLI });
    const r = await raw(ui.url);
    cookie = String(r.headers["set-cookie"] ?? "").split(";")[0];
  });
  after(() => ui.close());

  it("binds loopback only and prints a tokenised URL", () => {
    assert.match(ui.url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{32,}$/);
    assert.equal(ui.server.address().address, "127.0.0.1");
  });

  it("trades the token for an HttpOnly SameSite=Strict cookie, then serves the page", async () => {
    const first = await raw(ui.url);
    assert.equal(first.status, 302);
    const set = String(first.headers["set-cookie"]);
    assert.match(set, /HttpOnly/);
    assert.match(set, /SameSite=Strict/);
    const page = await raw(new URL("/", ui.url).href, { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /text\/html/);
    assert.match(page.headers["content-security-policy"], /default-src 'none'/);
    assert.doesNotMatch(
      page.body,
      /https?:\/\/(?!127\.0\.0\.1|localhost)/,
      "no external resources",
    );
  });

  it("refuses requests without the token", async () => {
    const r = await raw(new URL("/", ui.url).href);
    assert.equal(r.status, 401);
    const api = await raw(new URL("/api/run/doctor", ui.url).href, {
      method: "POST",
      headers: { "x-helix": "1" },
    });
    assert.equal(api.status, 401);
  });

  it("refuses a foreign Host header (DNS rebinding) and a foreign Origin (CSRF)", async () => {
    const rebinding = await raw(new URL("/", ui.url).href, {
      headers: { cookie, host: "evil.example" },
    });
    assert.equal(rebinding.status, 403);
    const csrf = await raw(new URL("/api/run/doctor", ui.url).href, {
      method: "POST",
      headers: { cookie, "x-helix": "1", origin: "http://evil.example" },
    });
    assert.equal(csrf.status, 403);
  });

  it("requires the custom header on actions", async () => {
    const r = await raw(new URL("/api/run/doctor", ui.url).href, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(r.status, 403);
  });

  it("only runs whitelisted actions", async () => {
    const r = await raw(new URL("/api/run/rm-rf", ui.url).href, {
      method: "POST",
      headers: { cookie, "x-helix": "1" },
    });
    assert.equal(r.status, 404);
    const get = await raw(new URL("/api/run/doctor", ui.url).href, { headers: { cookie } });
    assert.equal(get.status, 405);
  });

  it("runs doctor and returns code, output and timing as JSON", async () => {
    const r = await raw(new URL("/api/run/doctor", ui.url).href, {
      method: "POST",
      headers: { cookie, "x-helix": "1", "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.equal(typeof j.code, "number");
    assert.equal(typeof j.stdout, "string");
    assert.equal(typeof j.ms, "number");
    assert.equal(j.action, "doctor");
  });

  it("init through the UI writes the pack into the launched dir only", async () => {
    const r = await raw(new URL("/api/run/init", ui.url).href, {
      method: "POST",
      headers: { cookie, "x-helix": "1", "content-type": "application/json" },
      body: JSON.stringify({ dir: "/etc", platforms: "claude-code" }),
    });
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.equal(j.code, 0, j.stderr);
    assert.match(j.stdout, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const again = await raw(new URL("/api/run/doctor", ui.url).href, {
      method: "POST",
      headers: { cookie, "x-helix": "1" },
    });
    assert.match(JSON.parse(again.body).stdout, /healthy|doctor/);
  });
});
