import type { LspId } from "./types";

export type Lsp = {
  id: LspId;
  name: string;
  languages: string[];
  job: string;
  schemaTokens: number;
  defaultOn: boolean;
};

export const LSPS: Lsp[] = [
  {
    id: "serena-lsp",
    name: "Serena (LSP MCP)",
    languages: ["TS", "Python", "Go", "Rust", "Java", "C#"],
    job: "One MCP that fronts the language servers you already have. Preferred over wiring each LSP by hand.",
    schemaTokens: 860,
    defaultOn: false,
  },
  {
    id: "typescript",
    name: "vtsls / tsserver",
    languages: ["TypeScript", "JavaScript"],
    job: "Go-to-def, rename, and quick-fix for TS repos when Serena is off.",
    schemaTokens: 240,
    defaultOn: true,
  },
  {
    id: "pyright",
    name: "Pyright",
    languages: ["Python"],
    job: "Types and refs for Python. Pair with Graphify for cross-file architecture.",
    schemaTokens: 220,
    defaultOn: false,
  },
  {
    id: "rust-analyzer",
    name: "rust-analyzer",
    languages: ["Rust"],
    job: "The language server the Builder should use instead of guessing borrow errors.",
    schemaTokens: 260,
    defaultOn: false,
  },
  {
    id: "gopls",
    name: "gopls",
    languages: ["Go"],
    job: "Standard Go LSP. Enable when the repo is mostly Go.",
    schemaTokens: 200,
    defaultOn: false,
  },
];

export const LSP_BY_ID = Object.fromEntries(LSPS.map((l) => [l.id, l])) as Record<LspId, Lsp>;

export const DEFAULT_LSPS: LspId[] = LSPS.filter((l) => l.defaultOn).map((l) => l.id);
