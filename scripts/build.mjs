#!/usr/bin/env node
// scripts/build.mjs — transpile Helix TypeScript into standard ES modules in dist/
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");

// Clean dist directory
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

function rewriteImports(code) {
  // Replace import/export paths ending in .ts with .js
  return code
    .replace(/(from\s+["'])([^"']+\.)ts(["'])/g, "$1$2js$3")
    .replace(/(import\s*\(\s*["'])([^"']+\.)ts(["']\s*\))/g, "$1$2js$3");
}

function processFile(srcPath, relPath) {
  const destPath = join(DIST, relPath);
  mkdirSync(dirname(destPath), { recursive: true });

  if (
    srcPath.endsWith(".test.ts") ||
    srcPath.endsWith(".test.mjs") ||
    srcPath.endsWith(".test.js")
  ) {
    return; // Skip tests in production build
  }
  if (relPath.includes("test-env.") || relPath.includes("symlink-helper.")) {
    return; // Skip test utilities
  }

  if (srcPath.endsWith(".ts")) {
    const raw = readFileSync(srcPath, "utf8");
    const transpiled = ts.transpileModule(raw, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
    });
    const jsDest = destPath.replace(/\.ts$/, ".js");
    writeFileSync(jsDest, rewriteImports(transpiled.outputText), "utf8");
  } else if (srcPath.endsWith(".mjs") || srcPath.endsWith(".js")) {
    let raw = readFileSync(srcPath, "utf8");
    // Standardize shebang for compiled output
    if (raw.startsWith("#!/usr/bin/env -S node ")) {
      raw = "#!/usr/bin/env node\n" + raw.slice(raw.indexOf("\n") + 1);
    }
    writeFileSync(destPath, rewriteImports(raw), "utf8");
    if (relPath.endsWith("helix.mjs")) {
      chmodSync(destPath, 0o755);
    }
  } else if (srcPath.endsWith(".json")) {
    writeFileSync(destPath, readFileSync(srcPath, "utf8"), "utf8");
  }
}

function walkDir(dir, baseRel = "") {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = join(baseRel, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkDir(full, rel);
    } else if (st.isFile()) {
      processFile(full, rel);
    }
  }
}

console.log("Transpiling TypeScript to ES Modules (dist/)...");
walkDir(join(ROOT, "cli"), "cli");
walkDir(join(ROOT, "src"), "src");
walkDir(join(ROOT, "fixtures", "baseline"), join("fixtures", "baseline"));

// Copy package.json, LICENSE, and README into dist
writeFileSync(join(DIST, "package.json"), readFileSync(join(ROOT, "package.json"), "utf8"), "utf8");
writeFileSync(join(DIST, "LICENSE"), readFileSync(join(ROOT, "LICENSE"), "utf8"), "utf8");
writeFileSync(join(DIST, "README.md"), readFileSync(join(ROOT, "README.md"), "utf8"), "utf8");

console.log("Build complete: dist/");
