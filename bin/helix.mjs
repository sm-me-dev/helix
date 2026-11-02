#!/usr/bin/env node
// bin/helix.mjs — Universal entry point for Helix CLI
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distEntry = join(__dirname, "..", "dist", "cli", "helix.mjs");
const srcEntry = join(__dirname, "..", "cli", "helix.mjs");

if (existsSync(distEntry)) {
  await import(`file://${distEntry}`);
} else {
  await import(`file://${srcEntry}`);
}
