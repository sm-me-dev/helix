import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { CREW_BY_ID, DEFAULT_CREW } from "./harness/crew.ts";
import { DEFAULT_MCPS, MCP_BY_ID } from "./harness/mcps.ts";
import { DEFAULT_PLATFORMS, PLATFORM_BY_ID } from "./harness/platforms.ts";
import { DEFAULT_SKILLS, SKILL_BY_ID } from "./harness/skills.ts";
import type { CrewId, HarnessConfig, McpId, PlatformId, SkillId } from "./harness/types";

type HarnessStore = HarnessConfig & {
  toggleCrew: (id: CrewId) => void;
  toggleSkill: (id: SkillId) => void;
  toggleMcp: (id: McpId) => void;
  togglePlatform: (id: PlatformId) => void;
  setFlag: (
    key: "graphFirst" | "progressiveDisclosure" | "defaultSingleAgent" | "hooksEnabled",
    value: boolean,
  ) => void;
  reset: () => void;
};

const DEFAULTS: HarnessConfig = {
  crew: DEFAULT_CREW,
  skills: DEFAULT_SKILLS,
  mcps: DEFAULT_MCPS,
  platforms: DEFAULT_PLATFORMS,
  graphFirst: true,
  progressiveDisclosure: true,
  defaultSingleAgent: true,
  hooksEnabled: true,
};

/** Defaults for tests and for scaling scripted figures to the live config. */
export const DEFAULT_HARNESS_CONFIG: HarnessConfig = { ...DEFAULTS };

function toggleIn<T>(list: T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function knownIds<T extends string>(ids: unknown, table: Record<string, unknown>): T[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is T => typeof id === "string" && id in table);
}

/** v1 -> v2 (tiered crew): auditor becomes reviewer; the conductor role and
 * the prover role retire (main session orchestrates; the Stop hook proves). */
const RENAMED_CREW_V2: Record<string, CrewId> = { auditor: "reviewer" };
const DROPPED_CREW_V2 = new Set(["conductor", "prover"]);

export function migratePersisted(raw: unknown, version: number): HarnessConfig {
  if (version >= 2) return sanitizePersisted(raw);
  const c = (raw ?? {}) as { crew?: unknown };
  const renamed = Array.isArray(c.crew)
    ? c.crew.map((id) =>
        typeof id === "string" && id in RENAMED_CREW_V2 ? RENAMED_CREW_V2[id] : id,
      )
    : c.crew;
  const pruned = Array.isArray(renamed)
    ? renamed.filter((id) => !DROPPED_CREW_V2.has(id))
    : renamed;
  return sanitizePersisted({ ...(raw as object), crew: pruned });
}

/** Drop stale ids a persisted older config may carry; booleans coerce. */
function sanitizePersisted(raw: unknown): HarnessConfig {
  const c = (raw ?? {}) as Partial<HarnessConfig>;
  return {
    crew: knownIds<CrewId>(c.crew, CREW_BY_ID),
    skills: knownIds<SkillId>(c.skills, SKILL_BY_ID),
    mcps: knownIds<McpId>(c.mcps, MCP_BY_ID),
    platforms: knownIds<PlatformId>(c.platforms, PLATFORM_BY_ID),
    graphFirst: c.graphFirst !== false,
    progressiveDisclosure: c.progressiveDisclosure !== false,
    defaultSingleAgent: c.defaultSingleAgent !== false,
    hooksEnabled: c.hooksEnabled !== false,
  };
}

/** No-op storage for SSR — real localStorage only exists in the browser. */
function ssrSafeStorage() {
  if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    return window.localStorage;
  }
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

export const useHarness = create<HarnessStore>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,
      toggleCrew: (id) => {
        set({ crew: toggleIn(get().crew, id) });
      },
      toggleSkill: (id) => set({ skills: toggleIn(get().skills, id) }),
      toggleMcp: (id) => set({ mcps: toggleIn(get().mcps, id) }),
      togglePlatform: (id) => set({ platforms: toggleIn(get().platforms, id) }),
      setFlag: (key, value) => set({ [key]: value }),
      reset: () => set(DEFAULTS),
    }),
    {
      name: "helix-harness",
      version: 2,
      storage: createJSONStorage(() => ssrSafeStorage()),
      partialize: (s) => selectConfig(s),
      migrate: (persisted, version) =>
        ({ ...migratePersisted(persisted, version) }) as HarnessStore,
      merge: (persisted, current) => ({ ...current, ...sanitizePersisted(persisted) }),
    },
  ),
);

export function selectConfig(s: HarnessStore): HarnessConfig {
  return {
    crew: s.crew,
    skills: s.skills,
    mcps: s.mcps,
    platforms: s.platforms,
    graphFirst: s.graphFirst,
    progressiveDisclosure: s.progressiveDisclosure,
    defaultSingleAgent: s.defaultSingleAgent,
    hooksEnabled: s.hooksEnabled,
  };
}
