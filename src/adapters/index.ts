import type { PlatformId } from "../types";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import { copilotAdapter } from "./copilot.ts";
import { cursorAdapter } from "./cursor.ts";
import { antigravityAdapter } from "./antigravity.ts";
import {
  aiderAdapter,
  ampAdapter,
  clineAdapter,
  devinAdapter,
  factoryAdapter,
  geminiAdapter,
  kiloAdapter,
  kiroAdapter,
  opencodeAdapter,
  windsurfAdapter,
} from "./minimal.ts";
import type { PlatformAdapter } from "./types.ts";

export type { PlatformAdapter } from "./types.ts";

const ADAPTERS: PlatformAdapter[] = [
  claudeAdapter,
  cursorAdapter,
  codexAdapter,
  geminiAdapter,
  copilotAdapter,
  windsurfAdapter,
  clineAdapter,
  aiderAdapter,
  opencodeAdapter,
  antigravityAdapter,
  devinAdapter,
  factoryAdapter,
  kiroAdapter,
  ampAdapter,
  kiloAdapter,
];

export const ADAPTER_BY_ID = Object.fromEntries(ADAPTERS.map((a) => [a.id, a])) as Record<
  PlatformId,
  PlatformAdapter
>;
