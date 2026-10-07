// Explicit contract every platform adapter implements.
import type { HarnessConfig, PackFile, PlatformId } from "../types";

export type AdapterSource = { title: string; url: string };

export type PlatformAdapter = {
  id: PlatformId;
  /** Date the emitted paths were checked against vendor docs. Null = not verified. */
  verifiedAt: string | null;
  sources: AdapterSource[];
  /** True only when vendor docs confirm native custom-subagent support. */
  supportsSubagents: boolean;
  /** True only when vendor docs confirm the native skill path we emit. */
  supportsSkills: boolean;
  files(config: HarnessConfig): PackFile[];
  /** Human note: what was verified, and that the crew runs as sequential prompts otherwise. */
  notes: string;
};
