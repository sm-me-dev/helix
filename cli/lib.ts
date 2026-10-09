// Pure, testable core of the helix CLI. The argv wrapper lives in helix.mjs;
// everything here is importable and unit-tested without touching process.
import { DEFAULT_CREW } from "../src/lib/harness/crew.ts";
import { generatePack } from "../src/lib/harness/generate.ts";
import { DEFAULT_MCPS } from "../src/lib/harness/mcps.ts";
import { selectRepoMap } from "../src/lib/harness/repomap.ts";
import { DEFAULT_PLATFORMS } from "../src/lib/harness/platforms.ts";
import { DEFAULT_SKILLS } from "../src/lib/harness/skills.ts";
import { breakdown, formatTokens } from "../src/lib/harness/tokens.ts";
import { ADAPTER_BY_ID } from "../src/lib/harness/adapters/index.ts";
import { countTokens } from "../src/lib/harness/measure.ts";
import { mcpCostByPlatform } from "../src/lib/harness/mcp-cost.ts";
import { mcpSchemaTokens } from "../src/lib/harness/mcps.ts";
import type { HarnessConfig, PlatformId } from "../src/lib/harness/types.ts";

export function defaultConfig(platforms: PlatformId[]): HarnessConfig {
  return {
    crew: [...DEFAULT_CREW],
    skills: [...DEFAULT_SKILLS],
    mcps: [...DEFAULT_MCPS],
    platforms,
    graphFirst: true,
    progressiveDisclosure: true,
    defaultSingleAgent: true,
    hooksEnabled: true,
  };
}

export type DetectedStack = {
  language: string;
  packageManager: string;
  testCommand: string | null;
  lintCommand: string | null;
  formatCommand: string | null;
  existingAgentFiles: string[];
  /** Source files walked (excluding node_modules/.git/graphify-out). */
  fileCount: number;
  /** True when the repo renders UI (markup/components or a UI framework dep). */
  uiPresent: boolean;
};

/** Detection-based defaults: narrow the full defaults by repo facts.
 * Graphify off under ~20 files (its own skipIf — the graph costs more than
 * it saves); Playwright off unless a UI is detected; crew stays whole
 * (isolation/breadth is a per-task call, not an init-time one). */
export function configForStack(
  platforms: PlatformId[],
  facts: { fileCount: number; uiPresent: boolean; graphifyAvailable?: boolean },
): HarnessConfig {
  const config = defaultConfig(platforms);
  // Graphify when present and worthwhile, otherwise the built-in outline map.
  if (
    selectRepoMap({
      graphifyAvailable: facts.graphifyAvailable ?? true,
      fileCount: facts.fileCount,
    }) === "outline"
  ) {
    config.mcps = config.mcps.filter((id) => id !== "graphify");
    config.graphFirst = false;
  }
  if (!facts.uiPresent) {
    config.mcps = config.mcps.filter((id) => id !== "playwright");
  }
  return config;
}

/** Stack detection from files present in a directory (no execution). */
export function detectStack(files: {
  names: Set<string>;
  packageJson: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null;
  makefile: string | null;
  justfile: string | null;
}): DetectedStack {
  const pkg = files.packageJson;
  const pm = files.names.has("bun.lockb")
    ? "bun"
    : files.names.has("yarn.lock")
      ? "yarn"
      : files.names.has("pnpm-lock.yaml")
        ? "pnpm"
        : "npm";
  const language = pkg
    ? files.names.has("tsconfig.json")
      ? "typescript"
      : "javascript"
    : files.names.has("go.mod")
      ? "go"
      : files.names.has("Cargo.toml")
        ? "rust"
        : files.names.has("pyproject.toml") || files.names.has("requirements.txt")
          ? "python"
          : "unknown";
  const script = (n: string) =>
    pkg?.scripts?.[n]
      ? `${pm === "npm" ? "npm" : pm} ${n === "test" && pm === "npm" ? "test" : `run ${n}`} `.trim()
      : null;
  const testCommand =
    script("test") ??
    (files.makefile?.match(/^test:/m) ? "make test" : null) ??
    (files.justfile?.match(/^test/m) ? "just test" : null);
  const lintCommand =
    script("lint") ??
    (files.makefile?.match(/^lint:/m) ? "make lint" : null) ??
    (files.justfile?.match(/^lint/m) ? "just lint" : null);
  const formatCommand = pkg?.scripts?.["format"]
    ? `${pm} run format`.replace("npm run format", "npm run format")
    : null;
  const candidates = [
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "CONVENTIONS.md",
    ".clinerules",
    ".claude/settings.json",
    ".mcp.json",
    ".cursor/mcp.json",
    ".vscode/mcp.json",
    ".codex/config.toml",
    ".cursor/rules/helix.mdc",
    ".github/copilot-instructions.md",
  ];
  const deps = new Set([
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
  ]);
  const uiDeps = [
    "react",
    "react-dom",
    "vue",
    "svelte",
    "next",
    "nuxt",
    "@sveltejs/kit",
    "solid-js",
    "preact",
    "angular",
    "@angular/core",
  ];
  const uiPresent =
    uiDeps.some((d) => deps.has(d)) ||
    [...files.names].some((n) => /\.(tsx|jsx|vue|svelte)$/.test(n) || n.endsWith(".html"));
  return {
    language,
    packageManager: pm,
    testCommand,
    lintCommand,
    formatCommand,
    existingAgentFiles: candidates.filter((c) => files.names.has(c)),
    fileCount: files.names.size,
    uiPresent,
  };
}

/** Line diff for the overwrite prompt: elided common head/tail, changed middle. */
export function diffLines(oldText: string, newText: string, context = 3): string {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  if (head === a.length && head === b.length) return "identical";
  const out: string[] = [];
  if (head > context) out.push(`… (${head - context} identical lines above)`);
  for (let i = Math.max(0, head - context); i < head; i++) out.push(`  ${a[i]}`);
  for (let i = head; i < a.length - tail; i++) out.push(`- ${a[i]}`);
  for (let i = head; i < b.length - tail; i++) out.push(`+ ${b[i]}`);
  for (let i = b.length - tail; i < Math.min(b.length, b.length - tail + context); i++)
    out.push(`  ${b[i]}`);
  if (tail > context) out.push(`… (${tail - context} identical lines below)`);
  return out.join("\n");
}

export type DoctorFailure = { check: string; detail: string };

/** Validate an unpacked pack directory. Returns failures (empty = healthy). */
export function doctorPack(files: Map<string, string>): DoctorFailure[] {
  const failures: DoctorFailure[] = [];
  const get = (p: string) => files.get(p);

  const agents = get("AGENTS.md");
  if (!agents) {
    failures.push({ check: "agents-md", detail: "AGENTS.md missing" });
  } else {
    const lines = agents.split("\n").length;
    const tokens = countTokens(agents);
    if (lines >= 60)
      failures.push({ check: "agents-budget", detail: `AGENTS.md has ${lines} lines (budget 60)` });
    if (tokens >= 500)
      failures.push({
        check: "agents-budget",
        detail: `AGENTS.md is ~${tokens} tokens (budget 500)`,
      });
  }
  if (agents?.includes(".helix/map.mjs") && !files.has(".helix/map.mjs")) {
    failures.push({
      check: "map",
      detail: "AGENTS.md points at .helix/map.mjs but it is missing; re-run helix init",
    });
  }
  if (agents?.includes(".helix/gate.mjs") && !files.has(".helix/gate.mjs")) {
    failures.push({
      check: "gate",
      detail: "AGENTS.md tells agents to run .helix/gate.mjs but it is missing; re-run helix init",
    });
  }

  // Every emitted JSON config must parse and match its platform shape.
  const jsonChecks: [string, (v: unknown) => string | null][] = [
    [
      ".mcp.json",
      (v) =>
        v && typeof v === "object" && "mcpServers" in (v as object)
          ? null
          : "needs top-level mcpServers",
    ],
    [
      ".cursor/mcp.json",
      (v) =>
        v && typeof v === "object" && "mcpServers" in (v as object)
          ? null
          : "needs top-level mcpServers",
    ],
    [
      ".vscode/mcp.json",
      (v) => {
        if (!v || typeof v !== "object" || !("servers" in (v as object)))
          return "needs top-level servers";
        const servers = (v as { servers: Record<string, { type?: string }> }).servers;
        for (const [name, s] of Object.entries(servers)) {
          if (!["stdio", "http", "sse"].includes(s.type ?? "")) return `${name} needs a type`;
        }
        return null;
      },
    ],
    [
      ".claude/settings.json",
      (v) => {
        if (!v || typeof v !== "object") return "not an object";
        const hooks = (v as { hooks?: Record<string, unknown[]> }).hooks ?? {};
        if (!Array.isArray(hooks.PostToolUse)) return "PostToolUse hook missing";
        if (!Array.isArray(hooks.Stop)) return "Stop hook missing";
        return null;
      },
    ],
  ];
  for (const [path, validate] of jsonChecks) {
    const body = get(path);
    if (body === undefined) continue;
    try {
      const problem = validate(JSON.parse(body));
      if (problem) failures.push({ check: `config:${path}`, detail: problem });
    } catch {
      failures.push({ check: `config:${path}`, detail: "does not parse as JSON" });
    }
  }

  const toml = get(".codex/config.toml");
  if (toml !== undefined && !/\[mcp_servers\.[^\]]+\]/.test(toml)) {
    failures.push({ check: "config:.codex/config.toml", detail: "no [mcp_servers.*] tables" });
  }

  // No duplicate skill bodies across the two reader locations.
  const bodies = new Map<string, string>();
  for (const [path, body] of files) {
    const m = path.match(/(?:\.claude\/skills|\.agents\/skills)\/([^/]+)\/SKILL\.md$/);
    if (m) bodies.set(`${m[1]}:${body}`, path);
  }

  // Every hook command referenced by settings.json must ship beside it.
  const settingsBody = get(".claude/settings.json");
  if (settingsBody !== undefined) {
    try {
      const settings = JSON.parse(settingsBody) as {
        hooks?: Record<string, { hooks?: { command?: string }[] }[]>;
      };
      const refs = new Set<string>();
      for (const group of Object.values(settings.hooks ?? {})) {
        for (const entry of group ?? []) {
          for (const h of entry.hooks ?? []) {
            const m = h.command?.match(/node (\.helix\/hooks\/\S+\.mjs)/);
            if (m) refs.add(m[1]);
          }
        }
      }
      for (const ref of refs) {
        if (!files.has(ref)) {
          failures.push({
            check: `hooks:${ref}`,
            detail: "referenced by settings.json but not shipped",
          });
        }
      }
    } catch {
      // JSON shape already reported above.
    }
  }

  // Unpinned versions anywhere in JSON/TOML configs.
  for (const [path, body] of files) {
    if (!path.endsWith(".json") && !path.endsWith(".toml")) continue;
    if (body.includes("@latest")) {
      failures.push({ check: `pin:${path}`, detail: "floats on @latest" });
    }
    const bareGit = body.match(/git\+https:[^"'\s@]*["'\s]/);
    if (
      bareGit &&
      !/@v?\d/.test(body.slice(body.indexOf(bareGit[0]), body.indexOf(bareGit[0]) + 120))
    ) {
      failures.push({ check: `pin:${path}`, detail: "unpinned git ref" });
    }
    // uvx --from specs without a version pin (==, >=, ~=, or @ref).
    for (const m of body.matchAll(/"--from"\s*,\s*"([^"]+)"/g)) {
      const spec = m[1];
      if (!/==|>=|~=|===|@[^"]*\d|git\+https:[^"]*@/.test(spec)) {
        failures.push({ check: `pin:${path}`, detail: `unpinned uvx --from spec: ${spec}` });
      }
    }
  }

  return failures;
}

/** Reconstruct a best-effort config from unpacked pack files (for measure/doctor). */
export function reconstructConfig(files: Map<string, string>): HarnessConfig {
  const crew = [...DEFAULT_CREW].filter((id) => files.has(`.claude/agents/${id}.md`));
  const platformIds = (Object.keys(ADAPTER_BY_ID) as PlatformId[]).filter((id) => {
    if (id === "claude-code") return files.has("CLAUDE.md") || files.has(".claude/settings.json");
    if (id === "cursor") return files.has(".cursor/mcp.json");
    if (id === "codex") return files.has(".codex/config.toml");
    if (id === "copilot") return files.has(".vscode/mcp.json");
    if (id === "gemini" || id === "antigravity") return files.has("GEMINI.md");
    if (id === "windsurf") return files.has(".windsurf/rules/helix.md");
    if (id === "cline") return files.has(".clinerules");
    if (id === "aider") return files.has("CONVENTIONS.md");
    return false;
  });
  return {
    crew: crew.length > 0 ? crew : [...DEFAULT_CREW],
    skills: [...DEFAULT_SKILLS],
    mcps: [...DEFAULT_MCPS],
    platforms: platformIds.length > 0 ? platformIds : [...DEFAULT_PLATFORMS],
    graphFirst: true,
    progressiveDisclosure: true,
    defaultSingleAgent: true,
    hooksEnabled: files.has(".claude/settings.json"),
  };
}

export function measureReport(config: HarnessConfig): string {
  const b = breakdown(config);
  const passed = b.checks.filter((c) => c.pass).length;
  const lines = [
    `always-on  ${formatTokens(b.alwaysOn)}  (agents.md ${formatTokens(b.agentsMd)} · skills ${formatTokens(b.skillIndex)} · mcp ${formatTokens(b.mcpSchemas)} · crew ${formatTokens(b.crewIndex)})`,
    `baseline   ${formatTokens(b.naiveAlwaysOn)}  (representative fixtures, not a live host)`,
    `lean score ${b.leanScore}  (${passed}/${b.checks.length} checks)`,
    ...b.checks.map((c) => `  ${c.pass ? "PASS" : "FAIL"} ${c.label}`),
    ...b.estimates.map((e) => `  estimate: ${e}`),
    `mcp schema cost per platform (worst case ${formatTokens(b.mcpSchemas)} if fully loaded):`,
    ...mcpCostByPlatform(config).map(
      (r) => `  ${r.name}: ${r.deferral === "deferred" ? "deferred" : "assume loaded"} — ${r.note}`,
    ),
    "per-task total tokens (retrieval turns, skill loads) are NOT in this report: run helix report on real sessions",
    `method: ${b.method}`,
  ];
  return lines.join("\n");
}

export function packJson(config: HarnessConfig): string {
  return JSON.stringify({ files: generatePack(config) }, null, 2) + "\n";
}

/** MCP inventory line for doctor output: count, tokens, freshness per server. */
export function mcpSummary(config: HarnessConfig): string[] {
  return config.mcps.map((id) => {
    const { tokens, measured } = mcpSchemaTokens(id);
    return `${id}: ${tokens} schema tokens (${measured ? "measured" : "estimate"})`;
  });
}

/** Graphify freshness: report commit vs HEAD. Readers injected for tests. */
export function graphFreshness(
  readFile: (path: string) => string | null,
  revParseHead: () => string | null,
): DoctorFailure[] {
  const report = readFile("graphify-out/GRAPH_REPORT.md");
  if (report === null) {
    return [
      { check: "graph", detail: "graphify-out/GRAPH_REPORT.md missing — run graphify update ." },
    ];
  }
  const m = report.match(/Built from commit: `([0-9a-f]+)/);
  const head = revParseHead();
  if (!m) return [{ check: "graph", detail: "report has no build commit line" }];
  if (head !== null && !head.startsWith(m[1]) && !m[1].startsWith(head)) {
    return [{ check: "graph", detail: `stale: report built from ${m[1]}, HEAD is ${head}` }];
  }
  return [];
}

export { countTokens, mcpSchemaTokens };
