# Configuration

Helix resolves AI provider settings field by field through six effective levels: five sources followed by built-in defaults. Higher levels override values supplied below them.

## Provider precedence

1. **Runtime overrides** from the active session or tool runtime.
2. **CLI flags** supplied for the current command.
3. **Environment variables**, including `HELIX_AI_*`, `OPENAI_BASE_URL`, and `OPENAI_API_KEY` (legacy `OPENAI_API_BASE` is also recognized).
4. **Workspace `.helix/config.toml`**, subject to the Trusted Workspace guard.
5. **Global `~/.config/helix/providers.toml`**.
6. **Built-in defaults**.

Values merge per field, so a runtime model override can coexist with a base URL from the global profile. Sensitive workspace settings such as provider URLs, shell hooks, and nonempty MCP server configuration are ignored unless the workspace is explicitly trusted.

Example workspace provider configuration:

```toml
provider = "local"
model = "qwen2.5-coder:14b"
base_url = "http://localhost:11434"
# api_key may be omitted for a keyless loopback server
```

Example global configuration:

```toml
[providers.local]
provider = "openai-compatible"
model = "qwen2.5-coder:14b"
base_url = "http://127.0.0.1:11434"
```

Use the provider profile and fields supported by the installed Helix version; do not commit real credentials. Environment variables are useful for CI and short-lived overrides.

## URL normalization and local servers

Helix trims surrounding whitespace, invisible Unicode and trailing slashes, then removes a recognized endpoint suffix when it appears at the end of the configured URL: `/chat/completions`, `/responses`, `/embeddings`, or `/models`. Configure the API base URL, for example `http://localhost:11434/v1`, rather than a full operation URL.

For a keyless loopback endpoint (including localhost, `127.*`, `0.0.0.0`, and `::1`), Helix supplies the synthetic key `sk-helix-local` so OpenAI-compatible clients can initialize. This is a local compatibility value, not a credential. Remote endpoints still require their configured key.

## Provider connectivity check

The provider handshake first sends `GET {base_url}/models`. If that endpoint responds with 404 or 405, Helix retries with a minimal one-token `POST {base_url}/chat/completions` request. A successful response confirms reachability and basic chat compatibility.

This handshake is exposed in provider setup (including the TUI `/doctor` flow and daemon provider verification endpoint). The CLI command `helix doctor [dir]` has a separate purpose: it audits the generated Helix pack and local integrations; it does not itself perform the provider handshake.

## Context and workspace settings

The progressive context system begins below 600 tokens, with a Tier 0 route catalog below 250 tokens. At the configured 92% context threshold, older tool output is archived to `.helix/runtime/<session>/NOTES.md`; 92% is the trigger threshold, not a compression percentage. Workspace trust and provider fields are described in the [configuration implementation](../src/engine/config-loader.ts) and [URL sanitizer](../src/engine/url-sanitizer.ts).

## Runtime requirements

The npm package requires Node.js **>= 26.4**. Standalone archives and installers bundle the supported Node runtime. See [Installation](INSTALL.md) for platform-specific options.
