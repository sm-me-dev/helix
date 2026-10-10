// Measure MCP tools/list schemas into src/lib/harness/mcp-measurements.json.
//
// Usage:
//   node scripts/measure-mcp.mjs            # measure all catalog stdio servers
//   node scripts/measure-mcp.mjs --ids playwright,serena
//   node scripts/measure-mcp.mjs --dry-run  # print the plan, launch nothing
//
// Method: spawn the server's command over stdio, speak MCP JSON-RPC
// (initialize -> notifications/initialized -> tools/list), count o200k_base
// tokens over the tools array. Remote (URL) servers are NOT launched —
// streamable-HTTP auth flows need credentials — and stay null with a reason.
// Existing values are kept when a launch fails; entries older than 60 days
// are treated as stale by mcpMeasurementFresh().
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { encode } from "gpt-tokenizer";

const OUT = new URL("../src/mcp-measurements.json", import.meta.url);
const STALE_DAYS = 60;
const TIMEOUT_MS = 90000;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyArg = args.find((a) => a.startsWith("--ids="));
const onlySpace = args[args.indexOf("--ids") + 1];
const only =
  onlyArg != null
    ? onlyArg.slice("--ids=".length).split(",")
    : onlySpace && !onlySpace.startsWith("--")
      ? onlySpace.split(",")
      : null;

// Catalog mirror: id -> server launch. Kept in the script (not imported)
// so measurement stays independent of the pack code it validates.
const SERVERS = {
  graphify: { command: "uvx", args: ["--from", "graphifyy[mcp]", "graphify-mcp"] },
  playwright: { command: "npx", args: ["@playwright/mcp@0.0.83"] },
  serena: {
    command: "uvx",
    args: ["--from", "git+https://github.com/oraios/serena@v1.7.0", "serena", "start-mcp-server"],
  },
  "chrome-devtools": { command: "npx", args: ["chrome-devtools-mcp@1.10.1"] },
};

const REMOTE = {
  context7: "remote URL — needs no launch but streamable-HTTP is out of scope for this script",
  github: "remote URL — needs a token; not launched",
  sentry: "remote URL — needs auth; not launched",
  linear: "remote URL — needs auth; not launched",
};

function rpc(id, method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}

function measureStdio(name, { command, args }) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (result) => {
      if (!done) {
        done = true;
        resolve(result);
      }
    };
    let child;
    try {
      child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"] });
    } catch (err) {
      finish({ ok: false, reason: `spawn failed: ${String(err)}` });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, reason: `no tools/list within ${TIMEOUT_MS / 1000}s` });
    }, TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({ ok: false, reason: `spawn error: ${String(err.message ?? err)}` });
    });
    child.stdout.setEncoding("utf8");
    let tools = null;
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const lines = out.split("\n");
      out = lines.pop() ?? "";
      for (const line of lines) {
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 2 && msg.result && tools === null) {
          tools = msg.result.tools ?? [];
          clearTimeout(timer);
          child.kill();
          finish({ ok: true, tools });
        }
      }
    });
    child.stdin.write(
      rpc(1, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "helix-measure", version: "1" },
      }),
    );
    child.stdin.write(rpc(0, "notifications/initialized", {}));
    child.stdin.write(rpc(2, "tools/list", {}));
  });
}

const dumpArg = args.find((a) => a.startsWith("--dump-tools="));
const dumpSpace = args[args.indexOf("--dump-tools") + 1];
const dumpDir =
  dumpArg != null
    ? dumpArg.slice("--dump-tools=".length)
    : dumpSpace && !dumpSpace.startsWith("--")
      ? dumpSpace
      : null;

const ids = only ?? Object.keys(SERVERS);
if (dryRun) {
  console.log("plan: launch stdio servers", ids.join(", "));
  console.log("skip (remote, recorded as unmeasured):", Object.keys(REMOTE).join(", "));
  process.exit(0);
}

const raw = await readFile(OUT, "utf8");
const doc = JSON.parse(raw);
const today = new Date().toISOString().slice(0, 10);

for (const id of ids) {
  const server = SERVERS[id];
  if (!server) {
    console.log(`${id}: unknown server id, skipped`);
    continue;
  }
  console.log(`${id}: launching \`${server.command} ${server.args.join(" ")}\` ...`);
  const res = await measureStdio(id, server);
  if (!res.ok) {
    console.log(`${id}: FAILED (${res.reason}) — keeping previous value`);
    continue;
  }
  const tokens = encode(JSON.stringify(res.tools)).length;
  if (dumpDir) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dumpDir, { recursive: true });
    await writeFile(
      `${dumpDir}/${id}.tools.json`,
      JSON.stringify({ server: id, capturedAt: today, toolCount: res.tools.length, tools: res.tools }, null, 2) + "\n",
    );
  }
  doc.servers[id] = {
    tokens,
    version: null,
    measuredAt: today,
    method: `stdio tools/list (${res.tools.length} tools), o200k_base via scripts/measure-mcp.mjs`,
  };
  console.log(`${id}: ${res.tools.length} tools -> ${tokens} tokens`);
}

for (const [id, reason] of Object.entries(REMOTE)) {
  if (only && !only.includes(id)) continue;
  doc.servers[id] = doc.servers[id] ?? { tokens: null, version: null, measuredAt: null, method: "" };
  if (doc.servers[id].tokens == null) {
    doc.servers[id].method = `unmeasured: ${reason}`;
  }
}

await writeFile(OUT, JSON.stringify(doc, null, 2) + "\n");
console.log(`wrote ${OUT.pathname} (stale after ${STALE_DAYS} days)`);
