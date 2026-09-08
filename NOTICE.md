# Attribution and release provenance

This project extends **lark-channel-bridge**, distributed under the MIT License with the copyright notice:

> Copyright (c) 2026 Lark Channel Bridge contributors

The repository originally used for this integration is [ddcarolyn/lark-coding-agent-bridge](https://github.com/ddcarolyn/lark-coding-agent-bridge), a fork of [zarazhangrui/lark-coding-agent-bridge](https://github.com/zarazhangrui/lark-coding-agent-bridge). Preserve both the upstream attribution and the MIT terms when redistributing this extension.

The reproducible baseline is the **npm `lark-channel-bridge@0.7.0` artifact**, not a claim that an untagged GitHub branch matches that package:

- Registry artifact: `https://registry.npmjs.org/lark-channel-bridge/-/lark-channel-bridge-0.7.0.tgz`
- Pristine `dist/cli.js` SHA-256: `448243111b761f61ed647bbb2440809d8b05590d6debdbfb7a9f1d8b7abf88e3`
- npm artifact integrity is additionally pinned in `package-lock.json`.

The patch contains modifications to the upstream runtime: working reactions, recall cancellation, local file routing, WIKI retrieval/archive hooks and social collection handoff. The modules under `runtime/` contain the corresponding extension logic. Build scripts reconstruct the integration locally; the generated upstream bundle is not checked into Git.

The public export substitutes configurable paths and synthetic fixtures for the original installation's local paths and business samples. It is intentionally a clean source release with no deployment history. The source checkout from which it was prepared remains separate and was not restarted by publication.

Third-party dependencies retain their own licenses. Browser Use, Codex CLI, Obsidian, yt-dlp and Feishu are separate tools/services and are not bundled as this project's intellectual property. No service endorsement or platform-wide content-access guarantee is implied.
