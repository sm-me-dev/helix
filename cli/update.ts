// cli/update.ts — Version inspection, update checks, and installation lifecycle management
import { existsSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { removeRcBlock, removeShim } from "./link.ts";

export type InstallMethod =
  "npm" | "homebrew" | "apt" | "rpm" | "winget" | "scoop" | "standalone" | "git-link";

export interface DetectionResult {
  method: InstallMethod;
  detail: string;
  version: string;
}

export function detectInstallMethod(entryUrl: string = import.meta.url): DetectionResult {
  const filePath = fileURLToPath(entryUrl);
  const normalized = filePath.replace(/\\/g, "/");

  // Read current package version
  let version = "0.9.1";
  try {
    const candidates = [
      join(dirname(filePath), "..", "package.json"),
      join(dirname(filePath), "..", "..", "package.json"),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, "utf8"));
        if (pkg.version) {
          version = pkg.version;
          break;
        }
      }
    }
  } catch {
    // fallback to default version
  }

  // 1. Homebrew tap or bottle
  if (
    normalized.includes("/Cellar/helix/") ||
    normalized.includes("/opt/homebrew/") ||
    normalized.includes("/linuxbrew/")
  ) {
    return { method: "homebrew", detail: "Homebrew tap/bottle installation", version };
  }

  // 2. npm global / local
  if (
    normalized.includes("/node_modules/@sm-me-dev/helix") ||
    normalized.includes("/node_modules/helix")
  ) {
    return { method: "npm", detail: "npm package installation", version };
  }

  // 3. APT deb
  if (normalized.startsWith("/usr/lib/helix") || normalized.startsWith("/usr/share/helix")) {
    return { method: "apt", detail: "Debian/Ubuntu APT package installation", version };
  }

  // 4. Standalone Unix installer
  const home = homedir().replace(/\\/g, "/");
  if (
    normalized.startsWith(`${home}/.local/lib/helix`) ||
    normalized.startsWith(`${home}/.local/share/helix`)
  ) {
    return { method: "standalone", detail: "Standalone universal bundle installation", version };
  }

  // 5. Windows Scoop / WinGet
  if (normalized.includes("/scoop/apps/helix")) {
    return { method: "scoop", detail: "Scoop package installation", version };
  }
  if (normalized.includes("/Programs/helix") || normalized.includes("/WindowsApps/")) {
    return { method: "winget", detail: "WinGet package installation", version };
  }

  // 6. Git checkout or linked development workspace
  return { method: "git-link", detail: "Local Git repository checkout", version };
}

export async function cmdUpdate(_opts: { checkOnly?: boolean } = {}): Promise<void> {
  const info = detectInstallMethod();
  console.log(`Helix installation method: ${info.method} (${info.detail})`);
  console.log(`Current version: ${info.version}`);

  switch (info.method) {
    case "npm":
      console.log("\nTo check and upgrade via npm, run:");
      console.log("  npm install -g @sm-me-dev/helix@latest");
      break;
    case "homebrew":
      console.log("\nTo check and upgrade via Homebrew, run:");
      console.log("  brew update && brew upgrade helix");
      break;
    case "apt":
      console.log("\nTo check and upgrade via APT, run:");
      console.log("  sudo apt update && sudo apt install --only-upgrade helix");
      break;
    case "rpm":
      console.log("\nTo check and upgrade via RPM/DNF, run:");
      console.log("  sudo dnf upgrade helix");
      break;
    case "winget":
      console.log("\nTo check and upgrade via WinGet, run:");
      console.log("  winget upgrade sm-me-dev.Helix");
      break;
    case "scoop":
      console.log("\nTo check and upgrade via Scoop, run:");
      console.log("  scoop update helix");
      break;
    case "standalone":
      console.log("\nTo update your standalone installation, run the universal installer:");
      console.log(
        "  curl -fsSL https://raw.githubusercontent.com/sm-me-dev/helix/main/scripts/install.sh | sh",
      );
      break;
    case "git-link":
      console.log("\nHelix is running from a local development checkout.");
      console.log("To update, pull latest changes and refresh dependencies:");
      console.log("  git pull && npm ci");
      break;
  }
}

export async function cmdUninstall(_opts: { force?: boolean } = {}): Promise<void> {
  const info = detectInstallMethod();
  console.log(`Helix installation detected: ${info.method} (${info.detail})`);

  switch (info.method) {
    case "npm":
      console.log("\nTo uninstall, run:");
      console.log("  npm uninstall -g @sm-me-dev/helix");
      break;
    case "homebrew":
      console.log("\nTo uninstall, run:");
      console.log("  brew uninstall helix");
      break;
    case "apt":
      console.log("\nTo uninstall, run:");
      console.log("  sudo apt remove helix");
      break;
    case "rpm":
      console.log("\nTo uninstall, run:");
      console.log("  sudo dnf remove helix");
      break;
    case "winget":
      console.log("\nTo uninstall, run:");
      console.log("  winget uninstall sm-me-dev.Helix");
      break;
    case "scoop":
      console.log("\nTo uninstall, run:");
      console.log("  scoop uninstall helix");
      break;
    case "standalone": {
      const home = homedir();
      const binShim = join(home, ".local", "bin", "helix");
      const installDir = join(home, ".local", "lib", "helix");
      let removedAny = false;
      if (existsSync(binShim)) {
        unlinkSync(binShim);
        console.log(`Removed executable symlink: ${binShim}`);
        removedAny = true;
      }
      if (existsSync(installDir)) {
        rmSync(installDir, { recursive: true, force: true });
        console.log(`Removed application directory: ${installDir}`);
        removedAny = true;
      }
      if (removedAny) {
        console.log("\nHelix standalone installation removed successfully.");
        console.log("Your projects and workspaces were preserved.");
      } else {
        console.log("No standalone installation files found in ~/.local/");
      }
      break;
    }
    case "git-link": {
      console.log("\nRemoving PATH link from local development checkout...");
      const home = homedir();
      const binDir = join(home, ".local", "bin");
      removeShim({ binDir });
      const rcCandidates = [join(home, ".bashrc"), join(home, ".zshrc")];
      for (const rc of rcCandidates) {
        if (existsSync(rc)) removeRcBlock(rc);
      }
      console.log("Development PATH link removed.");
      break;
    }
  }
}
