import { create } from "zustand";
import { DEFAULT_CREW } from "./harness/crew";
import { DEFAULT_LSPS } from "./harness/lsps";
import { DEFAULT_MCPS } from "./harness/mcps";
import { DEFAULT_PLATFORMS } from "./harness/platforms";
import { DEFAULT_SKILLS } from "./harness/skills";
import type { CrewId, HarnessConfig, LspId, McpId, PlatformId, SkillId } from "./harness/types";

type HarnessStore = HarnessConfig & {
  toggleCrew: (id: CrewId) => void;
  toggleSkill: (id: SkillId) => void;
  toggleMcp: (id: McpId) => void;
  toggleLsp: (id: LspId) => void;
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
  lsps: DEFAULT_LSPS,
  platforms: DEFAULT_PLATFORMS,
  graphFirst: true,
  progressiveDisclosure: true,
  defaultSingleAgent: true,
  hooksEnabled: true,
};

function toggleIn<T>(list: T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export const useHarness = create<HarnessStore>()((set, get) => ({
  ...DEFAULTS,
  toggleCrew: (id) => {
    if (id === "conductor") return;
    set({ crew: toggleIn(get().crew, id) });
  },
  toggleSkill: (id) => set({ skills: toggleIn(get().skills, id) }),
  toggleMcp: (id) => set({ mcps: toggleIn(get().mcps, id) }),
  toggleLsp: (id) => set({ lsps: toggleIn(get().lsps, id) }),
  togglePlatform: (id) => set({ platforms: toggleIn(get().platforms, id) }),
  setFlag: (key, value) => set({ [key]: value }),
  reset: () => set(DEFAULTS),
}));

export function selectConfig(s: HarnessStore): HarnessConfig {
  return {
    crew: s.crew,
    skills: s.skills,
    mcps: s.mcps,
    lsps: s.lsps,
    platforms: s.platforms,
    graphFirst: s.graphFirst,
    progressiveDisclosure: s.progressiveDisclosure,
    defaultSingleAgent: s.defaultSingleAgent,
    hooksEnabled: s.hooksEnabled,
  };
}
