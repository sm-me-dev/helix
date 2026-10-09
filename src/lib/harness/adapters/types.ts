// Explicit contract every platform adapter implements.
import type { HarnessConfig, PackFile, PlatformId } from "../types";

export type AdapterSource = { title: string; url: string };

/** What Helix does for one platform capability.
 * emitted    vendor docs verified AND Helix writes real files for it.
 * supported  vendor docs verified, but Helix does not emit it (yet).
 * unverified not checked against vendor docs: nothing is emitted, nothing is claimed. */
export type CapabilityStatus = "emitted" | "supported" | "unverified";

export const CAPABILITIES = [
  "instructions",
  "mcp",
  "skills",
  "subagents",
  "hooks",
  "plugin",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type CapabilityMatrix = Record<Capability, CapabilityStatus>;

export type PlatformAdapter = {
  id: PlatformId;
  /** Date the emitted paths were checked against vendor docs. Null = not verified. */
  verifiedAt: string | null;
  sources: AdapterSource[];
  /** True only when vendor docs confirm native custom-subagent support. */
  supportsSubagents: boolean;
  /** True only when vendor docs confirm the native skill path we emit. */
  supportsSkills: boolean;
  /** Per-capability honesty. verifiedAt null implies every entry is "unverified". */
  capabilities: CapabilityMatrix;
  files(config: HarnessConfig): PackFile[];
  /** Human note: what was verified, and that the crew runs as sequential prompts otherwise. */
  notes: string;
};
