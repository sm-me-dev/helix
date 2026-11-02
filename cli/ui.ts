// `helix ui`: a local-only web view over the same CLI commands.
// Security model (a localhost server that can run repo commands must not be reachable by a web page):
//  - binds 127.0.0.1 only; random port unless asked;
//  - a per-launch random token, traded once for an HttpOnly SameSite=Strict cookie;
//  - Host must be the loopback address (blocks DNS rebinding), Origin must match when present
//    (blocks cross-site POSTs), and actions need a custom header (forces a CORS preflight);
//  - actions are a fixed whitelist run as child processes of the CLI in the launched directory
//    only; the browser cannot choose the directory, the command or free-form arguments;
//  - the page loads nothing from the network (CSP default-src 'none').
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

export type UiOptions = {
  dir: string;
  port: number;
  cliPath: string;
  /** When `port` is taken and was not explicitly requested, pick a free one instead of failing. */
  fallbackToRandomPort?: boolean;
};

export type UiHandle = { server: Server; url: string; token: string; close: () => Promise<void> };

type ActionBody = { platforms?: unknown; crew?: unknown };

const MAX_OUTPUT = 400_000;
const ACTION_TIMEOUT_MS = 15 * 60_000;

/** Whitelisted actions: argv builder per name. Free-form input never reaches argv. */
function buildArgs(action: string, dir: string, body: ActionBody): string[] | null {
  switch (action) {
    case "doctor":
      return ["doctor", dir];
    case "measure":
      return ["measure", dir];
    case "gate":
      return ["gate", dir];
    case "gate-all":
      return ["gate", dir, "--all"];
    case "report":
      return ["report", dir];
    case "init": {
      const args = ["init", dir];
      if (typeof body.platforms === "string" && body.platforms !== "") {
        if (!/^[a-z0-9,-]+$/.test(body.platforms)) return null;
        args.push("--platform", body.platforms);
      }
      if (body.crew === true) args.push("--crew");
      return args;
    }
    default:
      return null;
  }
}

// ESC built from its code point: a literal \x1b in a regex trips no-control-regex.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

function cap(text: string): string {
  const clean = text.replace(ANSI, "");
  return clean.length > MAX_OUTPUT ? clean.slice(0, MAX_OUTPUT) + "\n… output truncated" : clean;
}

function runCli(
  cliPath: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string; ms: number }> {
  return new Promise((done) => {
    const t0 = Date.now();
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", cliPath, ...args],
      { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    const grab = (cur: string, chunk: Buffer) =>
      cur.length > MAX_OUTPUT * 2 ? cur : cur + chunk.toString("utf8");
    child.stdout.on("data", (c: Buffer) => (stdout = grab(stdout, c)));
    child.stderr.on("data", (c: Buffer) => (stderr = grab(stderr, c)));
    const timer = setTimeout(() => child.kill("SIGKILL"), ACTION_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code: code ?? 1, stdout: cap(stdout), stderr: cap(stderr), ms: Date.now() - t0 });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      done({ code: 1, stdout: "", stderr: String(e.message), ms: Date.now() - t0 });
    });
  });
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookieToken(req: IncomingMessage): string {
  const m = /(?:^|;\s*)helix_token=([0-9a-f]+)/.exec(String(req.headers.cookie ?? ""));
  return m ? m[1] : "";
}

function readBody(req: IncomingMessage): Promise<ActionBody> {
  return new Promise((done) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => {
      if (data.length < 10_000) data += c;
    });
    req.on("end", () => {
      try {
        const v = JSON.parse(data || "{}");
        done(v && typeof v === "object" ? (v as ActionBody) : {});
      } catch {
        done({});
      }
    });
    req.on("error", () => done({}));
  });
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  type = "text/plain; charset=utf-8",
  extra: Record<string, string> = {},
) {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extra,
  });
  res.end(body);
}

function page(dir: string, nonce: string): string {
  const esc = dir.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Helix</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--mut:#666;--card:#f5f5f4;--bd:#d6d3d1;--ok:#15803d;--bad:#b91c1c;--acc:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#eee;--mut:#a3a3a3;--card:#222;--bd:#3a3a3a;--ok:#4ade80;--bad:#f87171;--acc:#60a5fa}}
body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:920px;margin:0 auto;padding:24px 16px}
h1{margin:0 0 4px;font-size:22px}.dir{color:var(--mut);font-family:ui-monospace,monospace;font-size:13px;word-break:break-all}
.row{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
button{font:inherit;padding:7px 14px;border:1px solid var(--bd);background:var(--card);color:var(--fg);border-radius:6px;cursor:pointer}
button:hover:not(:disabled){border-color:var(--acc)}button:disabled{opacity:.5;cursor:wait}
.init{border:1px solid var(--bd);border-radius:8px;padding:12px;background:var(--card)}
.init input[type=text]{font:inherit;padding:5px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--fg);width:260px}
label{margin-right:12px;font-size:14px}
.status{display:inline-block;padding:1px 10px;border-radius:99px;font-size:13px;font-weight:600;border:1px solid var(--bd)}
.ok{color:var(--ok)}.bad{color:var(--bad)}
pre{background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:12px;overflow:auto;max-height:60vh;white-space:pre-wrap;word-break:break-word;font:13px/1.45 ui-monospace,monospace}
</style></head><body><main>
<h1>Helix</h1><div class="dir" id="dir">${esc}</div>
<div class="row" id="actions">
<button data-a="doctor">Doctor</button><button data-a="measure">Measure</button>
<button data-a="gate">Gate (changed)</button><button data-a="gate-all">Gate (all)</button>
<button data-a="report">Report</button></div>
<div class="init"><strong>Install the pack</strong> into this directory<br><br>
<label>platforms <input type="text" id="plat" placeholder="auto-detect (or claude-code,codex,all)"></label>
<label><input type="checkbox" id="crew"> add subagent crew</label>
<button id="init">Run init</button></div>
<p><span id="st" class="status">idle</span> <span id="ms" class="dir"></span></p>
<pre id="out">Pick an action. Each one runs the same CLI command you would type, in the directory above.</pre>
</main>
<script nonce="${nonce}">
const out=document.getElementById("out"),st=document.getElementById("st"),ms=document.getElementById("ms");
const btns=[...document.querySelectorAll("button")];
async function run(action,body){
  btns.forEach(b=>b.disabled=true);st.className="status";st.textContent="running…";ms.textContent="";out.textContent="";
  try{
    const r=await fetch("/api/run/"+action,{method:"POST",headers:{"content-type":"application/json","x-helix":"1"},body:JSON.stringify(body||{})});
    const j=await r.json();
    if(!r.ok){st.className="status bad";st.textContent="error "+r.status;out.textContent=j.error||"request failed";return}
    st.className="status "+(j.code===0?"ok":"bad");st.textContent=j.code===0?"passed (exit 0)":"exit "+j.code;
    ms.textContent=(j.ms/1000).toFixed(1)+"s";
    out.textContent=(j.stdout+(j.stderr?"\\n"+j.stderr:"")).trim()||"(no output)";
  }catch(e){st.className="status bad";st.textContent="error";out.textContent=String(e)}
  finally{btns.forEach(b=>b.disabled=false)}
}
document.getElementById("actions").addEventListener("click",e=>{const a=e.target.dataset&&e.target.dataset.a;if(a)run(a)});
document.getElementById("init").addEventListener("click",()=>{
  if(!confirm("Write the Helix pack into this directory? Existing differing files are kept, never overwritten."))return;
  run("init",{platforms:document.getElementById("plat").value.trim(),crew:document.getElementById("crew").checked});
});
</script></body></html>`;
}

export async function startUi(o: UiOptions): Promise<UiHandle> {
  const dir = resolve(o.dir);
  const token = randomBytes(24).toString("hex");
  let busy = false;
  let port = 0;

  const server = createServer(async (req, res) => {
    try {
      const host = String(req.headers.host ?? "");
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
        return send(res, 403, "forbidden host");
      }
      const url = new URL(req.url ?? "/", `http://${host}`);

      // Trade the launch token for a cookie, then drop it from the URL.
      if (req.method === "GET" && url.pathname === "/" && url.searchParams.has("token")) {
        if (!safeEqual(url.searchParams.get("token") ?? "", token))
          return send(res, 401, "bad token");
        return send(res, 302, "", "text/plain", {
          location: "/",
          "set-cookie": `helix_token=${token}; HttpOnly; SameSite=Strict; Path=/`,
        });
      }
      if (!safeEqual(cookieToken(req), token)) {
        return send(res, 401, "unauthorized: open the URL printed by `helix ui`");
      }

      if (req.method === "GET" && url.pathname === "/") {
        const nonce = randomBytes(16).toString("base64");
        return send(res, 200, page(dir, nonce), "text/html; charset=utf-8", {
          "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        });
      }

      const m = /^\/api\/run\/([a-z-]+)$/.exec(url.pathname);
      if (m) {
        if (req.method !== "POST") return send(res, 405, "POST only");
        const origin = req.headers.origin;
        if (origin !== undefined && origin !== `http://${host}`)
          return send(res, 403, "bad origin");
        if (req.headers["x-helix"] !== "1") return send(res, 403, "missing x-helix header");
        const body = await readBody(req);
        const args = buildArgs(m[1], dir, body);
        if (!args)
          return send(res, 404, JSON.stringify({ error: "unknown action" }), "application/json");
        if (busy)
          return send(
            res,
            409,
            JSON.stringify({ error: "another action is running" }),
            "application/json",
          );
        busy = true;
        try {
          const r = await runCli(resolve(o.cliPath), args, dir);
          return send(res, 200, JSON.stringify({ action: m[1], ...r }), "application/json");
        } finally {
          busy = false;
        }
      }
      return send(res, 404, "not found");
    } catch (e) {
      if (!res.headersSent) send(res, 500, "internal error");
      else res.end();
      void e;
    }
  });

  const listen = (p: number) =>
    new Promise<void>((ok, fail) => {
      const onError = (e: NodeJS.ErrnoException) => fail(e);
      server.once("error", onError);
      server.listen(p, "127.0.0.1", () => {
        server.off("error", onError);
        ok();
      });
    });
  try {
    await listen(o.port);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE" && o.fallbackToRandomPort)
      await listen(0);
    else throw e;
  }
  port = (server.address() as AddressInfo).port;
  return {
    server,
    token,
    url: `http://127.0.0.1:${port}/?token=${token}`,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}
