import { vscodeMcpJson } from "../mcps.ts";
import type { HarnessConfig } from "../types";
import { copilotInstructions } from "./parts.ts";
import type { PlatformAdapter } from "./types.ts";

export const copilotAdapter: PlatformAdapter = {
  id: "copilot",
  verifiedAt: "2026-10-10",
  sources: [
    {
      title: "VS Code MCP configuration reference",
      url: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration",
    },
    {
      title: "GitHub Copilot repository custom instructions",
      url: "https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions",
    },
  ],
  supportsSubagents: false,
  supportsSkills: false,
  capabilities: {
    instructions: "emitted",
    mcp: "emitted",
    skills: "unverified",
    subagents: "unverified",
    hooks: "unverified",
    plugin: "unverified",
    "structured-output": "unverified",
    "session-continuation": "unverified",
    sandboxing: "unverified",
    lsp: "unverified",
  },
  notes:
    ".github/copilot-instructions.md is the instructions file. Workspace MCP lives in " +
    ".vscode/mcp.json under a top-level servers key with a required type on every server " +
    "(stdio with command, http/sse with url) — not mcpServers. Custom-subagent support " +
    "was not verified, so the crew runs as sequential prompts here.",
  files(config: HarnessConfig) {
    return [
      {
        path: ".github/copilot-instructions.md",
        language: "markdown",
        body: copilotInstructions(),
      },
      { path: ".vscode/mcp.json", language: "json", body: vscodeMcpJson(config.mcps) },
    ];
  },
};
