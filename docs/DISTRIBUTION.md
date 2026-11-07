# Distribution and packaging

Helix v0.2.0 is distributed as an npm package and through versioned standalone artifacts and package-manager manifests. Release metadata is kept in `package.json`, `Formula/helix.rb`, `manifests/scoop/helix.json`, and `manifests/winget/sm-me-dev.Helix.yaml`.

## Installation channels

| Channel                        | Runtime                      | Update path                                      |
| ------------------------------ | ---------------------------- | ------------------------------------------------ |
| npm                            | Node.js >= 26.4              | `npm install -g @sm-me-dev/helix@latest`         |
| Homebrew                       | Bundled/managed with package | `brew update && brew upgrade helix`              |
| Scoop                          | Bundled archive              | `scoop update helix`                             |
| WinGet                         | Bundled archive              | `winget upgrade sm-me-dev.Helix`                 |
| Standalone release archive     | Embedded Node.js 26.4        | Download the matching asset from GitHub Releases |
| Git checkout with `helix link` | Node.js >= 26.4 and Git      | Pull updates in the checkout                     |

Standalone packages are produced by the release build for Linux x64/arm64, macOS x64/arm64, and Windows x64. Exact available assets and checksums are published with each GitHub release; use the release page as the source of truth for filenames.

## Source checkout

```sh
git clone https://github.com/sm-me-dev/helix.git
cd helix
npm ci
npm run build
./cli/helix.mjs link
```

The built Web UI is required for `helix web` from a checkout. Standalone distributions bundle the supported Node runtime.

## Release maintenance

Before a release, synchronize the package version and all distribution manifests, regenerate evidence and pages, and run the build, typecheck, lint, test, and formatting gates. The release automation produces artifacts from version tags. Never publish a package-manager checksum or URL until it matches the released artifact.

See [Installation](INSTALL.md), [Updating](UPDATING.md), and [Platform support](PLATFORM_SUPPORT.md) for user-facing details.
