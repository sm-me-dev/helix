// Default harness config as pure harness data: no store, no UI imports, so the
// CLI, evals and harness tests share it.
import { DEFAULT_CREW } from "./crew.ts";
import { DEFAULT_MCPS } from "./mcps.ts";
import { DEFAULT_PLATFORMS } from "./platforms.ts";
import { DEFAULT_SKILLS } from "./skills.ts";
import type { HarnessConfig } from "./types";

/** Defaults for tests and for scaling scripted figures to the live config. */
export const DEFAULT_HARNESS_CONFIG: HarnessConfig = {
  crew: [...DEFAULT_CREW],
  skills: [...DEFAULT_SKILLS],
  mcps: [...DEFAULT_MCPS],
  platforms: [...DEFAULT_PLATFORMS],
  graphFirst: true,
  progressiveDisclosure: true,
  defaultSingleAgent: true,
  hooksEnabled: true,
};
