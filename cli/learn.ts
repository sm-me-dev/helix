// helix learn — Learning Ledger (Phase E) CLI. Evidence-gated, opt-in, zero
// model tokens. Reflection is a human accept; model-based reflection is
// explicitly deferred ("save nothing" is the default outcome).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { countTokens } from "../src/measure.ts";
import {
  COMPILED_FILE,
  COMPILE_TOKEN_CAP,
  LEARN_DIR,
  LEDGER_FILE,
  acceptObservation,
  blankLedger,
  captureObservations,
  compileLedger,
  confirmEntry,
  decayLedger,
  humanAccept,
  sanitizeForCompile,
  validateEntry,
  type LearnEntryType,
  type LearnLedger,
} from "../src/learn.ts";

function dirOf(args: string[]): string {
  const d = args.find((a) => !a.startsWith("-"));
  return d ?? ".";
}

function flag(args: string[], name: string): string | null {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}`) return args[i + 1] ?? null;
    if (args[i].startsWith(`--${name}=`)) return args[i].slice(name.length + 3);
  }
  return null;
}

function listFlag(args: string[], name: string): string[] {
  const v = flag(args, name);
  return v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

function has(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function ledgerPath(dir: string): string {
  return join(dir, LEDGER_FILE);
}

function loadLedger(dir: string): LearnLedger {
  try {
    const raw = JSON.parse(readFileSync(ledgerPath(dir), "utf8")) as LearnLedger;
    if (raw.version !== 1 || !Array.isArray(raw.entries)) throw new Error("bad ledger");
    return raw;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return blankLedger();
    throw e;
  }
}

function saveLedger(dir: string, ledger: LearnLedger): void {
  mkdirSync(join(dir, LEARN_DIR), { recursive: true });
  writeFileSync(ledgerPath(dir), JSON.stringify(ledger, null, 2) + "\n");
}

function now(): string {
  return new Date().toISOString();
}

export function learnUsage(): string {
  return `helix learn — Learning Ledger (Phase E), opt-in and evidence-gated

  helix learn init [dir]                create .helix/learn/ledger.json (never overwrites)
  helix learn capture [dir] --session <id> [--files a,b] [--red2green t]
                              [--corrections n] [--reverts f] [--failed v]
                                        record deterministic session-end observations
  helix learn accept [dir] --session <id> --index <i> --type <t>
                              --glob <g> --text <lesson>
                                        human-accept one observation as a quarantined candidate
  helix learn confirm [dir] --id <lid> --session <sid> --outcome helped|hurt|used
  helix learn list [dir] [--status active|candidate|demoted]
  helix learn compile [dir] [--trust-untrusted]
                                        write .helix/learn/COMPILED.md under a hard token cap
  helix learn decay [dir] [--unused id=n,...] [--reverted c1,c2] [--hash glob=hash]
`;
}

export async function cmdLearn(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const dir = dirOf(rest);
  if (!sub || sub === "--help" || sub === "-h") {
    process.stdout.write(learnUsage());
    return;
  }
  if (sub === "init") {
    mkdirSync(join(dir, LEARN_DIR, "observations"), { recursive: true });
    try {
      readFileSync(ledgerPath(dir));
      console.log(`learn: ${ledgerPath(dir)} already exists, kept`);
    } catch {
      saveLedger(dir, blankLedger());
      console.log(`learn: created ${ledgerPath(dir)} (opt-in; nothing is read until compiled)`);
    }
    return;
  }
  if (sub === "capture") {
    const session = flag(rest, "session");
    if (!session) throw new Error("helix learn capture needs --session <id>");
    const obs = captureObservations({
      sessionId: session,
      repo: dir,
      filesTouched: listFlag(rest, "files"),
      redToGreen: listFlag(rest, "red2green"),
      corrections: Number(flag(rest, "corrections") ?? 0),
      reverts: listFlag(rest, "reverts"),
      failedValidations: listFlag(rest, "failed"),
    });
    mkdirSync(join(dir, LEARN_DIR, "observations"), { recursive: true });
    writeFileSync(
      join(dir, LEARN_DIR, "observations", `${session}.json`),
      JSON.stringify(obs, null, 2) + "\n",
    );
    console.log(`learn: captured ${obs.length} observation(s) for ${session} (not lessons)`);
    return;
  }
  if (sub === "accept") {
    const session = flag(rest, "session");
    const index = Number(flag(rest, "index") ?? NaN);
    const type = flag(rest, "type") as LearnEntryType | null;
    const glob = flag(rest, "glob");
    const text = flag(rest, "text");
    if (!session || !Number.isInteger(index) || !type || !glob || !text) {
      throw new Error("accept needs --session, --index, --type, --glob, --text");
    }
    const obsPath = join(dir, LEARN_DIR, "observations", `${session}.json`);
    const all = JSON.parse(readFileSync(obsPath, "utf8")) as unknown[];
    const o = all[index] as Parameters<typeof acceptObservation>[1];
    if (!o) throw new Error(`no observation ${index} in ${obsPath}`);
    const ledger = loadLedger(dir);
    const r = acceptObservation(ledger, { ...o, sessionId: session }, { type, text, glob }, now());
    if (r.problems.length > 0) throw new Error(`lesson rejected: ${r.problems.join("; ")}`);
    saveLedger(dir, r.ledger);
    console.log(
      `learn: accepted ${r.id} as candidate (quarantined; needs 2 confirms or human accept)`,
    );
    return;
  }
  if (sub === "confirm") {
    const id = flag(rest, "id");
    const session = flag(rest, "session");
    const outcome = flag(rest, "outcome") as "helped" | "hurt" | "used" | null;
    if (!id || !session || !outcome || !["helped", "hurt", "used"].includes(outcome)) {
      throw new Error("confirm needs --id, --session, --outcome helped|hurt|used");
    }
    const ledger = loadLedger(dir);
    if (!ledger.entries.some((e) => e.id === id)) throw new Error(`unknown lesson ${id}`);
    saveLedger(dir, confirmEntry(ledger, id, session, outcome, now()));
    console.log(`learn: recorded ${outcome} for ${id} in ${session}`);
    return;
  }
  if (sub === "human-accept") {
    const id = flag(rest, "id");
    if (!id) throw new Error("human-accept needs --id");
    const ledger = loadLedger(dir);
    saveLedger(dir, humanAccept(ledger, id));
    console.log(`learn: ${id} is active (human-accepted via diff review)`);
    return;
  }
  if (sub === "list") {
    const status = flag(rest, "status");
    const ledger = loadLedger(dir);
    const rows = ledger.entries.filter((e) => !status || e.status === status);
    if (rows.length === 0) console.log("learn: ledger is empty (save nothing is a valid outcome)");
    for (const e of rows) {
      console.log(
        `${e.id} [${e.status}] ${e.type} ${e.anchor.glob} (+${e.helped}/-${e.hurt}) ${e.text}`,
      );
    }
    return;
  }
  if (sub === "compile") {
    const ledger = loadLedger(dir);
    const { entries, warnings } = sanitizeForCompile(ledger.entries, {
      trustUntrusted: has(rest, "trust-untrusted"),
    });
    for (const w of warnings) console.log(`learn: warning: ${w}`);
    const bad: string[] = [];
    for (const e of entries) {
      for (const p of validateEntry(e)) bad.push(`${e.id}: ${p}`);
    }
    if (bad.length > 0) throw new Error(`invalid entries:\n${bad.join("\n")}`);
    const c = compileLedger(entries, countTokens, COMPILE_TOKEN_CAP);
    const body = [
      "# Helix learned rules (compiled, capped)",
      "",
      `Ledger lines that reached AGENTS.md (at most ${c.agentsLines.length} of them apply):`,
      ...c.agentsLines,
      "",
      "Gate-rule candidates (human encodes these as code; never auto-appended):",
      ...c.gateCandidates,
      "",
      "Path-scoped rules:",
      ...c.pathRules.map((r) => `- [${r.glob}] ${r.text}`),
      "",
      `Omitted by the cap: ${c.omitted}. Tokens: ${c.tokens} (cap ${COMPILE_TOKEN_CAP}).`,
      "",
    ].join("\n");
    mkdirSync(join(dir, LEARN_DIR), { recursive: true });
    writeFileSync(join(dir, COMPILED_FILE), body);
    console.log(
      `learn: wrote ${join(dir, COMPILED_FILE)} (${c.tokens} tokens, ${c.omitted} omitted)`,
    );
    return;
  }
  if (sub === "decay") {
    const unused: Record<string, number> = {};
    for (const pair of listFlag(rest, "unused")) {
      const [id, n] = pair.split("=");
      if (id && n) unused[id] = Number(n);
    }
    const hashes: Record<string, string> = {};
    for (const pair of listFlag(rest, "hash")) {
      const i = pair.indexOf("=");
      if (i > 0) hashes[pair.slice(0, i)] = pair.slice(i + 1);
    }
    const ledger = loadLedger(dir);
    const before = ledger.entries.filter((e) => e.status === "demoted").length;
    const next = decayLedger(ledger, {
      hashes,
      revertedCommits: listFlag(rest, "reverted"),
      unusedSessions: unused,
    });
    saveLedger(dir, next);
    const after = next.entries.filter((e) => e.status === "demoted").length;
    console.log(`learn: demoted ${after - before} entr${after - before === 1 ? "y" : "ies"}`);
    return;
  }
  throw new Error(`unknown learn subcommand: ${sub}`);
}
