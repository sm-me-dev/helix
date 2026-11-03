#!/usr/bin/env node
// scripts/build-bundles.mjs — assemble portable standalone application bundles with embedded Node runtime
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const VERSION = PKG.version || "0.1.0";
const NODE_VERSION = "22.14.0"; // Official Node.js 22 LTS

const TARGETS = {
  "linux-x64": { os: "linux", arch: "x64", nodeArch: "linux-x64", ext: "tar.gz" },
  "linux-arm64": { os: "linux", arch: "arm64", nodeArch: "linux-arm64", ext: "tar.gz" },
  "darwin-x64": { os: "darwin", arch: "x64", nodeArch: "darwin-x64", ext: "tar.gz" },
  "darwin-arm64": { os: "darwin", arch: "arm64", nodeArch: "darwin-arm64", ext: "tar.gz" },
  "windows-x64": { os: "windows", arch: "x64", nodeArch: "win-x64", ext: "zip" },
};

function sha256File(path) {
  const hash = createHash("sha256");
  const data = readFileSync(path);
  hash.update(data);
  return hash.digest("hex");
}

function copyDirRecursive(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dest, entry);
    const st = statSync(s);
    if (st.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

const LAUNCHER_SH = `#!/bin/sh
set -e
# Resolve directory following symlinks
PRG="$0"
while [ -h "$PRG" ]; do
  ls=\`ls -ld "$PRG"\`
  link=\`expr "$ls" : '.*-> \\(.*\\)$'\`
  if expr "$link" : '/.*' > /dev/null; then
    PRG="$link"
  else
    PRG=\`dirname "$PRG"\`/"$link"
  fi
done
DIR=\`dirname "$PRG"\`
BASE_DIR=\`cd "$DIR/.." && pwd\`

if [ -x "$BASE_DIR/runtime/bin/node" ]; then
  NODE_BIN="$BASE_DIR/runtime/bin/node"
elif [ -x "$BASE_DIR/runtime/node" ]; then
  NODE_BIN="$BASE_DIR/runtime/node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="node"
else
  echo "Error: Embedded Node runtime not found in $BASE_DIR/runtime" >&2
  exit 1
fi

exec "$NODE_BIN" "$BASE_DIR/app/bin/helix.mjs" "$@"
`;

const LAUNCHER_CMD = `@echo off
setlocal
set "DIR=%~dp0"
set "BASE_DIR=%DIR%.."
if exist "%BASE_DIR%\\runtime\\node.exe" (
  set "NODE_BIN=%BASE_DIR%\\runtime\\node.exe"
) else (
  set "NODE_BIN=node"
)
"%NODE_BIN%" "%BASE_DIR%\\app\\bin\\helix.mjs" %*
endlocal
`;

async function fetchRuntime(targetKey, cacheDir, useSystemNode) {
  const target = TARGETS[targetKey];
  const runtimeOut = join(cacheDir, targetKey);
  mkdirSync(runtimeOut, { recursive: true });

  const nodeExe = target.os === "windows" ? "node.exe" : "node";
  const binaryDest = join(runtimeOut, nodeExe);

  if (existsSync(binaryDest)) {
    return binaryDest;
  }

  if (useSystemNode && process.platform === target.os && process.arch === target.arch) {
    console.log(`Using host system Node (${process.execPath}) for ${targetKey}...`);
    copyFileSync(process.execPath, binaryDest);
    chmodSync(binaryDest, 0o755);
    return binaryDest;
  }

  // Download official Node runtime
  const isZip = target.ext === "zip" || target.os === "windows";
  const ext = isZip ? "zip" : "tar.gz";
  const archiveName = `node-v${NODE_VERSION}-${target.nodeArch}.${ext}`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`;
  const archivePath = join(cacheDir, archiveName);

  if (!existsSync(archivePath)) {
    console.log(`Downloading Node.js ${NODE_VERSION} for ${targetKey} from ${url}...`);
    try {
      execFileSync("curl", ["-fsSL", "-o", archivePath, url], { stdio: "inherit" });
    } catch {
      throw new Error(`Failed to download Node runtime from ${url}`);
    }
  }

  console.log(`Extracting ${archiveName}...`);
  const extractDir = join(cacheDir, `extract-${targetKey}`);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });

  if (isZip) {
    execFileSync("unzip", ["-q", archivePath, "-d", extractDir]);
    const top = readdirSync(extractDir)[0];
    const sourceExe = join(extractDir, top, "node.exe");
    copyFileSync(sourceExe, binaryDest);
  } else {
    execFileSync("tar", ["-xzf", archivePath, "-C", extractDir]);
    const top = readdirSync(extractDir)[0];
    const sourceBin = join(extractDir, top, "bin", "node");
    copyFileSync(sourceBin, binaryDest);
    chmodSync(binaryDest, 0o755);
  }

  rmSync(extractDir, { recursive: true, force: true });
  return binaryDest;
}

export async function buildBundle(targetKey, options = {}) {
  const target = TARGETS[targetKey];
  if (!target) throw new Error(`Unknown target platform: ${targetKey}`);

  const outDir = options.outDir || join(ROOT, "dist", "packages");
  const cacheDir = options.cacheDir || join(ROOT, ".cache", "node-runtimes");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });

  console.log(`\n==> Assembling standalone bundle for ${targetKey}...`);

  // Build transpiled dist first if not present
  if (!existsSync(join(ROOT, "dist", "cli", "helix.mjs"))) {
    execFileSync("node", [join(ROOT, "scripts", "build.mjs")], { stdio: "inherit" });
  }

  const bundleStaging = join(ROOT, "dist", `bundle-${targetKey}`);
  rmSync(bundleStaging, { recursive: true, force: true });
  mkdirSync(bundleStaging, { recursive: true });

  const rootInBundle = join(bundleStaging, "helix");
  const binDir = join(rootInBundle, "bin");
  const runtimeDir = join(rootInBundle, "runtime");
  const appDir = join(rootInBundle, "app");

  mkdirSync(binDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  mkdirSync(appDir, { recursive: true });

  // 1. Bin wrappers
  writeFileSync(join(binDir, "helix"), LAUNCHER_SH, "utf8");
  chmodSync(join(binDir, "helix"), 0o755);
  writeFileSync(join(binDir, "helix.cmd"), LAUNCHER_CMD, "utf8");

  // 2. Embedded Node Runtime
  const nodeBinary = await fetchRuntime(targetKey, cacheDir, options.useSystemNode);
  const destExeName = target.os === "windows" ? "node.exe" : "node";
  copyFileSync(nodeBinary, join(runtimeDir, destExeName));
  chmodSync(join(runtimeDir, destExeName), 0o755);

  // 3. Application payload
  copyDirRecursive(join(ROOT, "bin"), join(appDir, "bin"));
  copyDirRecursive(join(ROOT, "dist", "cli"), join(appDir, "dist", "cli"));
  copyDirRecursive(join(ROOT, "dist", "src"), join(appDir, "dist", "src"));
  copyDirRecursive(join(ROOT, "dist", "fixtures"), join(appDir, "dist", "fixtures"));
  copyFileSync(join(ROOT, "dist", "package.json"), join(appDir, "package.json"));

  // Include production dependency: gpt-tokenizer
  const gptSrc = join(ROOT, "node_modules", "gpt-tokenizer");
  if (existsSync(gptSrc)) {
    const gptDest = join(appDir, "node_modules", "gpt-tokenizer");
    copyDirRecursive(gptSrc, gptDest);
  }

  // 4. Metadata & license
  copyFileSync(join(ROOT, "LICENSE"), join(rootInBundle, "LICENSE"));
  copyFileSync(join(ROOT, "README.md"), join(rootInBundle, "README.md"));

  // 5. Create archive
  const archiveBase = `helix-v${VERSION}-${targetKey}`;
  const archivePath = join(outDir, `${archiveBase}.${target.ext}`);

  if (target.ext === "zip") {
    execFileSync("zip", ["-rq", archivePath, "helix"], { cwd: bundleStaging });
  } else {
    execFileSync("tar", ["-czf", archivePath, "-C", bundleStaging, "helix"]);
  }

  const sha = sha256File(archivePath);
  console.log(`Bundle created: ${archivePath}`);
  console.log(`SHA-256: ${sha}`);

  rmSync(bundleStaging, { recursive: true, force: true });
  return { path: archivePath, sha, filename: `${archiveBase}.${target.ext}` };
}

async function main() {
  const args = process.argv.slice(2);
  const targetArg = args.find((a) => !a.startsWith("-")) || "host";
  const useSystemNode = args.includes("--use-system-node") || args.includes("-s");

  let targetsToBuild = [];
  if (targetArg === "all") {
    targetsToBuild = Object.keys(TARGETS);
  } else if (targetArg === "host") {
    const hostKey = `${process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;
    targetsToBuild = [hostKey];
  } else {
    targetsToBuild = [targetArg];
  }

  const outDir = join(ROOT, "dist", "packages");
  mkdirSync(outDir, { recursive: true });

  const results = [];
  for (const t of targetsToBuild) {
    const res = await buildBundle(t, { outDir, useSystemNode });
    results.push(res);
  }

  // Update or append SHA256SUMS.txt
  const sumsPath = join(outDir, "SHA256SUMS.txt");
  let existingSums = existsSync(sumsPath) ? readFileSync(sumsPath, "utf8").trim().split("\n") : [];
  const sumsMap = new Map();
  for (const line of existingSums) {
    const [hash, file] = line.trim().split(/\s+/);
    if (hash && file) sumsMap.set(file, hash);
  }
  for (const r of results) {
    sumsMap.set(r.filename, r.sha);
  }
  const updatedLines = [...sumsMap.entries()].map(([file, hash]) => `${hash}  ${file}`).sort();
  writeFileSync(sumsPath, updatedLines.join("\n") + "\n", "utf8");
  console.log(`\nChecksums updated in ${sumsPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Bundle build failed:", err);
    process.exit(1);
  });
}
