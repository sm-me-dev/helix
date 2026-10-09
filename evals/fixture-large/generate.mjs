// Deterministic large fixture generator for Helix evals (Phase D).
// No LLM-written filler: every file comes from a template plus a seeded PRNG.
// The reference model computes the expected numbers the tests assert, so the
// pristine repo is green by construction and a planted bug is the only defect.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const NOUNS = [
  "ledger", "invoice", "catalog", "shipment", "customer", "warehouse",
  "pricing", "discount", "payment", "refund", "tax", "currency",
  "inventory", "supplier", "order", "cart", "coupon", "review",
  "session", "profile", "audit", "report", "notice", "schedule",
];
const P = 1000003;

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, "0");
const camel = (s) => s.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());

/** Pure model of the repo: modules, dependency DAG, rule constants. */
export function buildModel({ seed = 1, modules = 16, rules = 10 } = {}) {
  const rnd = prng(seed);
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const order = NOUNS.slice(0, modules);
  const mods = order.map((name, i) => {
    const window = Array.from({ length: Math.min(i, 4) }, (_, k) => i - 1 - k);
    const deps = window.filter(() => rnd() < 0.55).slice(0, 2);
    if (i > 0 && deps.length === 0) deps.push(i - 1);
    const rs = Array.from({ length: rules }, () => ({
      a: int(3, 97),
      b: int(1, 999),
      m: int(1009, 9973),
    }));
    return { index: i, name, deps: deps.sort((x, y) => x - y), rules: rs };
  });
  return { seed, P, modules: mods };
}

export function applyRulesRef(mod, x) {
  return mod.rules.reduce((v, r) => (v * r.a + r.b) % r.m, x);
}

export function runRef(model, i, x) {
  const mod = model.modules[i];
  let total = applyRulesRef(mod, x);
  for (const d of mod.deps) total += runRef(model, d, x + 1);
  return total % model.P;
}

function moduleFiles(model, mod) {
  const n = mod.name;
  const files = {};
  const dir = `src/${n}`;
  files[`${dir}/consts.ts`] = `export const MODULUS = ${P};\nexport const NAME = "${n}";\n`;
  files[`${dir}/types.ts`] = `export interface ${camel(n)}Record {\n  id: number;\n  value: number;\n}\n`;
  files[`${dir}/validate.ts`] =
    `import { MODULUS } from "./consts.ts";\n\nexport function isValid(x: number): boolean {\n  return Number.isInteger(x) && x >= 0 && x < MODULUS;\n}\n`;
  files[`${dir}/format.ts`] =
    `import { NAME } from "./consts.ts";\n\nexport function format(x: number): string {\n  return \`\${NAME}:\${x}\`;\n}\n`;
  files[`${dir}/store.ts`] =
    `export class Store {\n  private data = new Map<number, number>();\n  put(key: number, value: number): void {\n    this.data.set(key, value);\n  }\n  get(key: number): number | undefined {\n    return this.data.get(key);\n  }\n  get size(): number {\n    return this.data.size;\n  }\n}\n`;
  mod.rules.forEach((r, k) => {
    const id = pad(k + 1);
    files[`${dir}/rules/rule-${id}.ts`] =
      `export const rule${id} = (x: number): number => (x * ${r.a} + ${r.b}) % ${r.m};\n`;
  });
  const ids = mod.rules.map((_, k) => pad(k + 1));
  files[`${dir}/rules/index.ts`] =
    ids.map((i) => `import { rule${i} } from "./rule-${i}.ts";`).join("\n") +
    `\n\nconst chain = [${ids.map((i) => `rule${i}`).join(", ")}];\n\nexport function applyRules(x: number): number {\n  return chain.reduce((v, rule) => rule(v), x);\n}\n`;
  const depImports = mod.deps
    .map((d) => `import { run as run${camel(model.modules[d].name)} } from "../${model.modules[d].name}/service.ts";`)
    .join("\n");
  const depSum = mod.deps
    .map((d) => ` + run${camel(model.modules[d].name)}(x + 1)`)
    .join("");
  files[`${dir}/service.ts`] =
    `import { applyRules } from "./rules/index.ts";\nimport { isValid } from "./validate.ts";\nimport { MODULUS } from "./consts.ts";\nimport { Store } from "./store.ts";\n${depImports ? depImports + "\n" : ""}\nconst store = new Store();\n\nexport function run(x: number): number {\n  if (!isValid(x)) throw new RangeError(\`invalid input \${x}\`);\n  const total = (applyRules(x)${depSum}) % MODULUS;\n  store.put(x, total);\n  return total;\n}\n\nexport function lastResult(x: number): number | undefined {\n  return store.get(x);\n}\n`;
  files[`${dir}/index.ts`] =
    `export { run, lastResult } from "./service.ts";\nexport { isValid } from "./validate.ts";\nexport { format } from "./format.ts";\n`;
  return files;
}

const XS = [0, 1, 7, 42];

function testFiles(model, mod) {
  const n = mod.name;
  const files = {};
  const cases = XS.map((x) => `  [${x}, ${runRef(model, mod.index, x)}],`).join("\n");
  files[`tests/${n}/service.test.ts`] =
    `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { run, lastResult } from "../../src/${n}/index.ts";\n\nconst cases: Array<[number, number]> = [\n${cases}\n];\n\ntest("${n} service matches the reference results", () => {\n  for (const [x, expected] of cases) {\n    assert.equal(run(x), expected, \`run(\${x})\`);\n    assert.equal(lastResult(x), expected);\n  }\n});\n\ntest("${n} service rejects invalid input", () => {\n  assert.throws(() => run(-1), RangeError);\n});\n`;
  const rulesCases = XS.map((x) => `  [${x}, ${applyRulesRef(mod, x)}],`).join("\n");
  files[`tests/${n}/rules.test.ts`] =
    `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { applyRules } from "../../src/${n}/rules/index.ts";\n\nconst cases: Array<[number, number]> = [\n${rulesCases}\n];\n\ntest("${n} rules chain is stable", () => {\n  for (const [x, expected] of cases) assert.equal(applyRules(x), expected);\n});\n`;
  files[`tests/${n}/store.test.ts`] =
    `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { Store } from "../../src/${n}/store.ts";\nimport { isValid } from "../../src/${n}/validate.ts";\nimport { format } from "../../src/${n}/format.ts";\n\ntest("${n} store keeps values", () => {\n  const s = new Store();\n  s.put(1, 2);\n  assert.equal(s.get(1), 2);\n  assert.equal(s.size, 1);\n});\n\ntest("${n} validate and format", () => {\n  assert.equal(isValid(5), true);\n  assert.equal(isValid(-1), false);\n  assert.equal(isValid(${P}), false);\n  assert.equal(format(3), "${n}:3");\n});\n`;
  return files;
}

function docFile(mod) {
  const rows = mod.rules
    .map((r, k) => `| rule-${pad(k + 1)} | ${r.a} | ${r.b} | ${r.m} |`)
    .join("\n");
  return `# ${mod.name}\n\nEach rule maps \`x\` to \`(x * a + b) % m\`; \`applyRules\` applies them in order.\n\n| file | a | b | m |\n| --- | --- | --- | --- |\n${rows}\n`;
}

function rootFiles(model) {
  const files = {};
  const mods = model.modules;
  files["package.json"] = JSON.stringify(
    { name: "helix-eval-fixture-large", private: true, type: "module",
      scripts: { test: 'node --experimental-strip-types --test "tests/**/*.test.ts"' } },
    null, 2) + "\n";
  files["README.md"] = `# Fixture (large)\n\nSource modules live in \`src/<name>/\`, per-module notes in \`docs/<name>.md\`, tests in \`tests/<name>/\`. Run \`npm test\`.\n`;
  files["src/index.ts"] =
    mods.map((m) => `import { run as run${camel(m.name)} } from "./${m.name}/index.ts";`).join("\n") +
    `\n\nexport function runAll(x: number): number {\n  return (${mods.map((m) => `run${camel(m.name)}(x)`).join(" + ")}) % ${P};\n}\n`;
  const total = XS.map((x) => [x, mods.reduce((s, m) => s + runRef(model, m.index, x), 0) % P]);
  files["tests/integration.test.ts"] =
    `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { runAll } from "../src/index.ts";\n\ntest("runAll combines every module", () => {\n${total.map(([x, v]) => `  assert.equal(runAll(${x}), ${v});`).join("\n")}\n});\n`;
  return files;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Writes the fixture into `dir` and returns {hash, fileCount, model}. */
export function writeFixture(dir, opts = {}) {
  const model = buildModel(opts);
  const files = { ...rootFiles(model) };
  for (const mod of model.modules) {
    Object.assign(files, moduleFiles(model, mod), testFiles(model, mod));
    files[`docs/${mod.name}.md`] = docFile(mod);
  }
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const hash = createHash("sha256");
  for (const p of walk(dir)) {
    hash.update(relative(dir, p)).update("\0").update(readFileSync(p));
  }
  return { hash: hash.digest("hex"), fileCount: Object.keys(files).length, model };
}

/** Plants a one-token defect in one rule file; returns what changed. */
export function plantRuleBug(dir, model, moduleIndex, ruleIndex) {
  const mod = model.modules[moduleIndex];
  const file = `src/${mod.name}/rules/rule-${pad(ruleIndex)}.ts`;
  const full = join(dir, file);
  const src = readFileSync(full, "utf8");
  const r = mod.rules[ruleIndex - 1];
  const from = `(x * ${r.a} + ${r.b}) % ${r.m}`;
  if (!src.includes(from)) throw new Error(`unexpected content in ${file}`);
  writeFileSync(full, src.replace(from, `(x * ${r.a} + ${r.b + 1}) % ${r.m}`));
  return { file, module: mod.name, rule: ruleIndex, from: r.b, to: r.b + 1 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: node evals/fixture-large/generate.mjs <outDir> [seed]");
    process.exitCode = 2;
  } else {
    const r = writeFixture(out, { seed: Number(process.argv[3] ?? 1) });
    console.log(`wrote ${r.fileCount} files, sha256 ${r.hash}`);
  }
}
