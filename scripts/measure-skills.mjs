// Measure the always-on pack: skill index, crew files, AGENTS.md.
//
// Usage: node --experimental-strip-types scripts/measure-skills.mjs [--label before]
//
// Method: generate the default full pack via generatePack(), count o200k_base
// tokens (gpt-tokenizer, same counter as tokens.ts) over (a) each skill's
// frontmatter (always-on index) and body (loaded on demand), (b) each agent
// file, (c) AGENTS.md. Static size only: it says nothing about total tokens
// per task (see Phase 1 token measurement). Output is JSON with method + date.
import { agentFile, skillFile } from "../src/lib/harness/adapters/parts.ts";
import { CREW } from "../src/lib/harness/crew.ts";
import { agentsMd } from "../src/lib/harness/generate.ts";
import { countTokens, TOKENIZER_METHOD } from "../src/lib/harness/measure.ts";
import { SKILLS } from "../src/lib/harness/skills.ts";
import { DEFAULT_PLATFORMS } from "../src/lib/harness/platforms.ts";

const fm = (t) => (t.match(/^---\n[\s\S]*?\n---/) ?? [t])[0];
const label = process.argv[process.argv.indexOf("--label") + 1] ?? "run";
const config = {
  crew: CREW.map((c) => c.id),
  skills: SKILLS.map((s) => s.id),
  mcps: [],
  platforms: [...DEFAULT_PLATFORMS],
  graphFirst: true,
  progressiveDisclosure: true,
  defaultSingleAgent: true,
  hooksEnabled: true,
};
const skills = SKILLS.map((s) => {
  const full = skillFile(s.id);
  return { id: s.id, index: countTokens(fm(full)), body: countTokens(full) - countTokens(fm(full)) };
});
const crew = CREW.map((c) => {
  const full = agentFile(c.id);
  return { id: c.id, index: countTokens(fm(full)), file: countTokens(full) };
});
const out = {
  label,
  measuredAt: new Date().toISOString().slice(0, 10),
  method: `${TOKENIZER_METHOD}; frontmatter = always-on index, body = loaded on demand; static size only`,
  skills,
  crew,
  skillIndexTotal: skills.reduce((n, s) => n + s.index, 0),
  skillBodyTotal: skills.reduce((n, s) => n + s.body, 0),
  crewFileTotal: crew.reduce((n, c) => n + c.file, 0),
  agentsMd: countTokens(agentsMd(config)),
};
console.log(JSON.stringify(out, null, 2));
