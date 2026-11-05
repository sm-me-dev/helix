import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getGlobalProviderProfile,
  listGlobalProviderProfiles,
  loadAiConfig,
  saveGlobalProviderProfile,
} from "./config-loader.ts";
import { SanitizedUrlError, sanitizeBaseUrl } from "./url-sanitizer.ts";

function fixture(): { root: string; home: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "helix-config-test-"));
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  return { root, home, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function writeConfig(root: string, home: string, workspace = "", global = ""): void {
  const workspaceDir = path.join(root, ".helix");
  const globalDir = path.join(home, ".config", "helix");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(globalDir, { recursive: true });
  if (workspace) fs.writeFileSync(path.join(workspaceDir, "config.toml"), workspace);
  if (global) fs.writeFileSync(path.join(globalDir, "providers.toml"), global);
}

test("provider configuration precedence is runtime > CLI > env > workspace > global > defaults", () => {
  const f = fixture();
  try {
    writeConfig(
      f.root,
      f.home,
      'provider = "local"\nmodel = "workspace-model"\nbase_url = "https://workspace.test/v1"',
      'default_provider = "custom"\n[providers.custom]\nprovider = "generic"\nmodel = "global-model"\nbase_url = "https://global.test/v1"\n[providers.custom.default_headers]\nX-Global = "yes"',
    );
    const env = {
      HELIX_AI_PROVIDER: "openai",
      HELIX_AI_MODEL: "env-model",
      HELIX_AI_BASE_URL: "https://env.test/v1",
      HELIX_AI_API_KEY: "env-key",
    };
    const cli = {
      provider: "google" as const,
      model: "cli-model",
      baseUrl: "https://cli.test/v1",
      apiKey: "cli-key",
    };
    const result = loadAiConfig({
      workspaceRoot: f.root,
      homedir: f.home,
      env,
      trustConfirmed: true,
      cli,
      runtime: {
        provider: "anthropic",
        model: "runtime-model",
        baseUrl: "https://runtime.test/v1",
        apiKey: "runtime-key",
      },
    });
    assert.deepEqual(
      { ...result.config, defaultHeaders: { ...result.config.defaultHeaders } },
      {
        providerId: "anthropic",
        model: "runtime-model",
        baseUrl: "https://runtime.test/v1",
        apiKey: "runtime-key",
        defaultHeaders: { "X-Global": "yes" },
        source: "runtime",
      },
    );

    const cliWinner = loadAiConfig({
      workspaceRoot: f.root,
      homedir: f.home,
      env,
      trustConfirmed: true,
      cli,
    });
    assert.equal(cliWinner.config.model, "cli-model");
    assert.equal(cliWinner.config.source, "cli");
    const envWinner = loadAiConfig({
      workspaceRoot: f.root,
      homedir: f.home,
      env,
      trustConfirmed: true,
    });
    assert.equal(envWinner.config.model, "env-model");
    assert.equal(envWinner.config.source, "env");
    const workspaceWinner = loadAiConfig({
      workspaceRoot: f.root,
      homedir: f.home,
      env: {},
      trustConfirmed: true,
    });
    assert.equal(workspaceWinner.config.model, "workspace-model");
    assert.equal(workspaceWinner.config.source, "workspace");

    fs.rmSync(path.join(f.root, ".helix", "config.toml"));
    const globalWinner = loadAiConfig({ workspaceRoot: f.root, homedir: f.home, env: {} });
    assert.equal(globalWinner.config.providerId, "generic");
    assert.equal(globalWinner.config.model, "global-model");
    assert.equal(globalWinner.config.source, "global");
  } finally {
    f.cleanup();
  }
});

test("workspace custom endpoints require trust confirmation", () => {
  const f = fixture();
  try {
    writeConfig(f.root, f.home, 'provider = "generic"\nbase_url = "https://custom.test/v1"');
    const untrusted = loadAiConfig({ workspaceRoot: f.root, homedir: f.home, env: {} });
    assert.equal(untrusted.trustRequired, true);
    assert.equal(untrusted.layerTrace.find((entry) => entry.layer === 4)?.applied, false);
    const trusted = loadAiConfig({
      workspaceRoot: f.root,
      homedir: f.home,
      env: {},
      trustConfirmed: true,
    });
    assert.equal(trusted.trustRequired, false);
    assert.equal(trusted.config.baseUrl, "https://custom.test/v1");
  } finally {
    f.cleanup();
  }
});

test("environment base URL aliases and empty custom-provider values are handled safely", () => {
  const aliased = loadAiConfig({ env: { OPENAI_API_BASE: "https://legacy.test/v1" } });
  assert.equal(aliased.config.baseUrl, "https://legacy.test/v1");
  assert.match(aliased.warnings.join(" "), /Deprecated OPENAI_API_BASE/);
  assert.throws(
    () => loadAiConfig({ env: { HELIX_AI_PROVIDER: "generic", HELIX_AI_BASE_URL: "   " } }),
    (error: unknown) => error instanceof SanitizedUrlError && error.code === "EMPTY_BASE_URL",
  );
});

test("URL sanitizer trims invisible characters, slashes, and pasted endpoint suffixes", () => {
  assert.equal(
    sanitizeBaseUrl(" \u200Bhttps://localhost:11434/v1/chat/completions/// ").baseUrl,
    "https://localhost:11434/v1",
  );
  assert.equal(sanitizeBaseUrl("https://host.test/v1/responses").baseUrl, "https://host.test/v1");
  assert.equal(sanitizeBaseUrl("https://host.test/v1/embeddings").baseUrl, "https://host.test/v1");
  assert.equal(sanitizeBaseUrl("https://host.test/v1/models").baseUrl, "https://host.test/v1");
  assert.throws(
    () => sanitizeBaseUrl(" \u200B "),
    (error: unknown) => error instanceof SanitizedUrlError && error.code === "EMPTY_BASE_URL",
  );
});

test("keyless localhost endpoints receive the synthetic token", () => {
  for (const baseUrl of [
    "http://localhost:11434/v1",
    "http://127.0.0.1:8000/v1",
    "http://0.0.0.0:8000/v1",
    "http://[::1]:8000/v1",
  ]) {
    const result = loadAiConfig({ env: { HELIX_AI_BASE_URL: baseUrl } });
    assert.equal(result.config.apiKey, "sk-helix-local");
  }
});

test("provider profiles can be edited without exposing or erasing stored credentials", () => {
  const f = fixture();
  try {
    saveGlobalProviderProfile(
      "local",
      {
        provider: "generic",
        base_url: "http://localhost:11434/v1",
        model: "local-model",
        api_key: "secret-token",
        default_headers: { Authorization: "secret-header" },
      },
      { homedir: f.home, makeDefault: true },
    );
    saveGlobalProviderProfile(
      "local",
      {
        provider: "generic",
        base_url: "http://localhost:11434/v1",
        model: "edited-model",
      },
      { homedir: f.home, makeDefault: true },
    );
    const saved = getGlobalProviderProfile("local", { homedir: f.home });
    assert.equal(saved?.api_key, "secret-token");
    assert.equal(saved?.default_headers?.Authorization, "secret-header");
    assert.equal(saved?.model, "edited-model");
    const summaries = listGlobalProviderProfiles({ homedir: f.home, env: {} });
    assert.equal(summaries[0]?.is_default, true);
    assert.equal(summaries[0]?.has_api_key, true);
    assert.deepEqual(summaries[0]?.default_header_names, ["Authorization"]);
    assert.equal(JSON.stringify(summaries).includes("secret-token"), false);
    assert.equal(JSON.stringify(summaries).includes("secret-header"), false);
  } finally {
    f.cleanup();
  }
});
