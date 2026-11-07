# Platform support

Helix supports npm on platforms with Node.js **>= 26.4** and provides standalone release bundles with an embedded Node runtime. The bundle build currently targets Linux x64 and arm64, macOS x64 and arm64, and Windows x64. Check the release page for assets available in a specific release.

| Installation                    | Requirements                              |
| ------------------------------- | ----------------------------------------- |
| npm package                     | Node.js >= 26.4                           |
| Source checkout or `helix link` | Node.js >= 26.4 and Git                   |
| Standalone archive/installer    | Supported release target; Node is bundled |
| `helix web` from source         | Run `npm run build` first                 |

Helix uses Git for repository operations and worktree-backed workflows. Platform-specific package-manager availability may differ by release; the package manifests are in `Formula/helix.rb`, `manifests/scoop/helix.json`, and `manifests/winget/sm-me-dev.Helix.yaml`.

See [Installation](INSTALL.md) and [Distribution](DISTRIBUTION.md) for current installation steps.
