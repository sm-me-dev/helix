import * as fs from "node:fs";
import * as path from "node:path";
import type { EngineConfig, PlatformId, ProviderId } from "./types.ts";

export type ExtendedEngineConfig = EngineConfig & {
  defaultProvider?: ProviderId;
  defaultModelId?: string;
  dryRun?: boolean;
  logLevel?: "debug" | "info" | "warn" | "error";
};

export const DEFAULT_ENGINE_CONFIG: ExtendedEngineConfig = {
  defaultPlatform: "claude-code",
  defaultSingleAgent: true,
  worktreeStorageDir: ".helix-work/worktrees",
  reportOutputDir: ".helix-work/reports",
  defaultTimeoutSec: 600,
  maxRetries: 2,
  defaultProvider: "anthropic",
  defaultModelId: "claude-3-5-sonnet-20241022",
  logLevel: "info",
};

/**
 * Locate the nearest .helix/config.json starting from dir and walking upward.
 */
export function findConfigFile(dir: string): string | null {
  let curr = path.resolve(dir);
  while (true) {
    const candidate = path.join(curr, ".helix", "config.json");
    if (fs.existsSync(candidate)) {
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) return candidate;
      } catch {
        // Unreadable or permission denied
      }
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return null;
}

/**
 * Load engine configuration by merging defaults, config file, environment variables,
 * and explicit runtime overrides in ascending order of precedence.
 */
export async function loadEngineConfig(
  workspaceRoot: string = process.cwd(),
  overrides: Partial<ExtendedEngineConfig> = {},
): Promise<ExtendedEngineConfig> {
  const config: ExtendedEngineConfig = { ...DEFAULT_ENGINE_CONFIG };

  // 1. Read from .helix/config.json if present
  const configFile = findConfigFile(workspaceRoot);
  if (configFile) {
    try {
      const raw = fs.readFileSync(configFile, "utf8");
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        if (typeof parsed.defaultPlatform === "string")
          config.defaultPlatform = parsed.defaultPlatform as PlatformId;
        if (typeof parsed.defaultSingleAgent === "boolean")
          config.defaultSingleAgent = parsed.defaultSingleAgent;
        if (typeof parsed.worktreeStorageDir === "string")
          config.worktreeStorageDir = parsed.worktreeStorageDir;
        if (typeof parsed.reportOutputDir === "string")
          config.reportOutputDir = parsed.reportOutputDir;
        if (typeof parsed.defaultTimeoutSec === "number")
          config.defaultTimeoutSec = parsed.defaultTimeoutSec;
        if (typeof parsed.maxRetries === "number")
          config.maxRetries = Math.min(parsed.maxRetries, 2);
        if (typeof parsed.defaultProvider === "string")
          config.defaultProvider = parsed.defaultProvider as ProviderId;
        if (typeof parsed.defaultModelId === "string")
          config.defaultModelId = parsed.defaultModelId;
        if (typeof parsed.logLevel === "string") config.logLevel = parsed.logLevel;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Log warning but continue with defaults/env
      console.warn(
        `[helix-config] Warning: Failed to parse configuration file ${configFile}: ${msg}`,
      );
    }
  }

  // 2. Environment variables override file configuration
  if (process.env.HELIX_PLATFORM) {
    config.defaultPlatform = process.env.HELIX_PLATFORM as PlatformId;
  }
  if (process.env.HELIX_SINGLE_AGENT !== undefined) {
    config.defaultSingleAgent =
      process.env.HELIX_SINGLE_AGENT !== "false" && process.env.HELIX_SINGLE_AGENT !== "0";
  }
  if (process.env.HELIX_WORKTREE_DIR) {
    config.worktreeStorageDir = process.env.HELIX_WORKTREE_DIR;
  }
  if (process.env.HELIX_REPORT_DIR) {
    config.reportOutputDir = process.env.HELIX_REPORT_DIR;
  }
  if (process.env.HELIX_TIMEOUT_SEC) {
    const parsed = parseInt(process.env.HELIX_TIMEOUT_SEC, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      config.defaultTimeoutSec = parsed;
    }
  }
  if (process.env.HELIX_MAX_RETRIES) {
    const parsed = parseInt(process.env.HELIX_MAX_RETRIES, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      config.maxRetries = Math.min(parsed, 2);
    }
  }
  if (process.env.HELIX_PROVIDER) {
    config.defaultProvider = process.env.HELIX_PROVIDER as ProviderId;
  }
  if (process.env.HELIX_MODEL) {
    config.defaultModelId = process.env.HELIX_MODEL;
  }
  if (process.env.HELIX_LOG_LEVEL) {
    config.logLevel = process.env.HELIX_LOG_LEVEL as ExtendedEngineConfig["logLevel"];
  }

  // 3. Runtime programmatic overrides
  if (overrides.defaultPlatform !== undefined) config.defaultPlatform = overrides.defaultPlatform;
  if (overrides.defaultSingleAgent !== undefined)
    config.defaultSingleAgent = overrides.defaultSingleAgent;
  if (overrides.worktreeStorageDir !== undefined)
    config.worktreeStorageDir = overrides.worktreeStorageDir;
  if (overrides.reportOutputDir !== undefined) config.reportOutputDir = overrides.reportOutputDir;
  if (overrides.defaultTimeoutSec !== undefined)
    config.defaultTimeoutSec = overrides.defaultTimeoutSec;
  if (overrides.maxRetries !== undefined) config.maxRetries = Math.min(overrides.maxRetries, 2);
  if (overrides.defaultProvider !== undefined) config.defaultProvider = overrides.defaultProvider;
  if (overrides.defaultModelId !== undefined) config.defaultModelId = overrides.defaultModelId;
  if (overrides.stack !== undefined) config.stack = overrides.stack;
  if (overrides.dryRun !== undefined) config.dryRun = overrides.dryRun;
  if (overrides.logLevel !== undefined) config.logLevel = overrides.logLevel;

  return config;
}

/**
 * Save configuration to .helix/config.json inside the specified workspace directory.
 */
export async function saveEngineConfig(
  workspaceRoot: string,
  config: Partial<ExtendedEngineConfig>,
): Promise<string> {
  const dir = path.join(workspaceRoot, ".helix");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, "config.json");
  const payload = JSON.stringify(config, null, 2) + "\n";
  fs.writeFileSync(filePath, payload, "utf8");
  return filePath;
}
