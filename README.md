<!-- SVENKUNKKA-README-NAV:BEGIN -->
[中文项目说明](#project-overview-zh) · [English overview](#project-overview-en) · [维护者 X / Maintainer on X](https://x.com/Svenu1s5)
<!-- SVENKUNKKA-README-NAV:END -->

# Feishu ↔ Codex ↔ Obsidian Bridge

Turn a private Feishu conversation into a local, human-reviewed knowledge workflow. Ask Codex questions, collect social links through Browser Use, and edit the resulting Markdown notes in Obsidian.

[中文说明](README.zh.md) · [Usage](docs/USAGE.md) · [Security](SECURITY.md) · [Upstream attribution](NOTICE.md)

Version **0.2.0** adds WeChat Official Account articles, public GitHub pages, Kickstarter and Indiegogo. See [CHANGELOG.md](CHANGELOG.md).

This is an **unofficial, macOS-first extension** of [lark-channel-bridge](https://github.com/ddcarolyn/lark-coding-agent-bridge), pinned to npm version **0.7.0**. It includes the custom bridge hooks as a reproducible patch, not a copy of any user's running configuration. It is not affiliated with Feishu, OpenAI, Obsidian, or Browser Use.

## What it does

- Saves completed question/answer exchanges as flat Markdown notes in one configured vault.
- Reuses only the current, human-confirmed answer. Editing or withdrawing approval invalidates reuse; deleted claims are not restored from previous answers.
- Collects accessible text, descriptions and available subtitles from Douyin, Xiaohongshu, Zhihu, Weibo, general websites, YouTube and Bilibili; also supports WeChat Official Account articles, public GitHub pages, Kickstarter and Indiegogo project pages.
- Keeps source text separate from the reviewed summary and personal annotations. Repeat links return the existing note; explicit refresh preserves human edits.
- Provides collection search, counts, platform/topic/time filters and approved-only synthesis. Interaction metrics retain timestamps, missing values and approximate display values.
- Opens local files/folders from paths in the application owner's direct messages, including bare paths and already-mounted NAS shares on macOS. These operations are not archived as Q&A.
- Adds a `CheckMark` reaction while work is running and removes the same reaction on completion, failure or cancellation. A recalled message cancels its queued/running work when the bridge receives the recall event.

The bridge process performs collection and index reconciliation. Obsidian does not need to remain open. When the bridge is stopped, nothing is collected; the next start reconciles offline note edits. There is **no separate server, scheduled crawler or cloud sync service** here.

## Before you run it

**This is a personal desktop agent, not a safe multi-user bot.** Upstream permissions default to `full` (`danger-full-access` for Codex). Local opening intentionally has no directory allowlist. Anyone who can use an unrestricted agent can potentially access files available to its process. Keep owner-only access, review permissions, and read [SECURITY.md](SECURITY.md) before connecting an app. Do not expose it to a shared group or transfer app ownership without a separate security review.

Requirements:

- macOS for the complete desktop workflow; Node.js **22.16+** and npm, with SQLite FTS5 enabled (as in official Node builds from 22.16). Older 22.x builds can lack FTS5 even though `node:sqlite` exists.
- An installed and logged-in Codex CLI, discoverable as `codex`.
- [Browser Use browser-harness](https://github.com/browser-use/browser-harness) with its `browser-use` command, connected to Chrome. This uses the harness Python helpers (`new_tab`, `js`, etc.), not OpenCLI or an arbitrary package with a similarly named command.
- An Obsidian vault (a local folder is sufficient); a Feishu/Lark personal application created through the upstream wizard.
- Optional `yt-dlp` for available video subtitles. No image/video media downloads are performed by the collector.

Platform support means an adapter exists, **not** that every URL can be read. Login, verification, deleted posts, region restrictions, missing subtitles and platform layout changes can prevent or limit capture. Complete interactive use is macOS-first; tests on another OS do not certify desktop opening there.

New-page boundaries in v0.2.0:

- **WeChat**: `mp.weixin.qq.com/s/...` articles and identity-bearing long links; capture the visible article, account name and publication label. Paywalled previews are partial; verification/deleted pages are rejected. Embedded video is not transcribed.
- **GitHub**: public repository README, rendered file text, issue/PR/discussion primary bodies, individual release notes and Wiki pages. It does not clone repositories, execute code, download release assets or scrape private/internal repositories. Replies/reviews are outside the captured primary body; lists/file trees are not articles.
- **Kickstarter / Indiegogo**: visible campaign story and supported, separately identified detail/update/FAQ routes. A project description is not proof of delivered hardware; image-only content, hidden story and missing video text remain partial. Security challenges are not bypassed.
- Stars, forks and available crowdfunding fields are displayed separately as **page metadata snapshots**, not disguised as likes/views or used for automatic funding-growth calculations. Missing fields remain absent/unknown.
- Old v0.1 `web` notes are classified by source domain in the index without rewriting their key, canonical URL, manual text or approval history. Ambiguous duplicate aliases stop for review instead of silently choosing a note.

## Quick start

```sh
git clone https://github.com/SvenKunkka/feishu-codex-obsidian-bridge.git
cd feishu-codex-obsidian-bridge
npm ci
npm run build
npm test
cp .env.example .env
```

Edit `.env` to point `FEISHU_WIKI_VAULT` at your vault. Leave credentials out of it: use the interactive application/login setup instead. Check your local dependencies:

```sh
node -v
codex --version
codex login status
browser-use --doctor
node bin/feishu-codex-obsidian-bridge.mjs --help
npm start -- run --profile codex --agent codex
```

Keep the foreground process running while you complete the QR/link wizard yourself. After connection, send a question or a link to your new bot, then check the note in Obsidian. The add-on hooks currently target the **`codex` profile**. Other profiles are not separate isolated WIKI instances in this release.

The launcher reads `.env` beside this README regardless of the current working directory; existing environment variables take precedence. By default the release uses its own `LARK_CHANNEL_HOME`, so it does not reuse an existing global bridge profile. **Do not run two instances against the same Feishu app.** Reusing an existing app/configuration requires an intentional migration and stopping the old instance first. Installing/building this repository does not stop or change it.

For day-to-day foreground use, repeat the last command. Upstream service commands are passed through, but service migration/installation is not performed by this project or its tests; keep the checkout at a stable path and review upstream service instructions before using them. Do not use a temporary `npx` checkout for a persistent service.

## Configuration

| Variable | Default / purpose |
|---|---|
| `FEISHU_WIKI_VAULT` | `~/Documents/Feishu-WIKI`; Markdown notes, outside the checkout |
| `FEISHU_WIKI_STATE_DIR` | `~/.local/share/feishu-codex-obsidian-bridge`; private indexes and durable approval ledger |
| `LARK_CHANNEL_HOME` | A separate `lark-channel` directory under the add-on state directory; upstream credentials, sessions and logs |
| `FEISHU_WIKI_RULES` | Bundled `skills/personal-feishu-assistant/SKILL.md` |
| `BROWSER_USE_BIN`, `CODEX_BIN`, `YTDLP_BIN`, `CURL_BIN` | Collector command paths; otherwise resolved from `PATH`. `CODEX_BIN` controls social summarization, not upstream chat-agent selection. |
| `FEISHU_SUMMARY_MODEL` | `gpt-5.6-sol`; model for social summaries, subject to your account/CLI availability |
| `FEISHU_SUMMARY_EFFORT` | `medium`; reasoning effort for social summaries |

The chat agent's model is controlled separately by the upstream profile/config UI; summary settings do not change the chat model. Feishu personal-history access also requires its own user authorization; creating a bot does not grant access to your entire chat history. The public launcher uses a distinct OS service identity (`feishu-codex-obsidian-bridge.bot`) so its service commands do not address an existing upstream bridge service.

Keep the vault and state directory on the **same filesystem volume** in this release. Refresh backups use hard links; a cross-volume setup can reject refresh with `EXDEV`. Set both paths explicitly when your vault is on an external drive. This limitation does not make a failed refresh a successful update.

## Development and provenance

```sh
npm ci
npm run build
npm test
```

The build verifies the exact upstream bundle SHA-256, applies the checked-in patch without fuzzy matching, checks the resulting hash and syntax, and writes a local `dist/cli.js`. It does not modify the global npm installation. Generated files and dependencies are excluded from Git. Tests use synthetic data and temporary directories, not live Feishu messages or browser accounts.

- `runtime/`: WIKI, approval controls, collection, metrics and local-opening modules.
- `patches/`: pinned upstream bridge integration changes.
- `scripts/`, `bin/`: reproducible build and local entry point.
- `tests/`: automated regressions and synthetic DOM fixtures.
- `skills/`: generic agent instructions, without personal knowledge.

An upstream update requires reviewing/rebasing the patch and rerunning tests; do not apply it blindly to a different version. This source release omits private logs, credentials, chat samples, audit ledgers, vault contents and deployment backups. A passed CI run is not proof of current access to every social platform. The package is marked `private` only to prevent accidental npm publication; the GitHub source repository is public.

## License

MIT. Original bridge contributions retain their upstream copyright. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).


---

<!-- SVENKUNKKA-PROJECT-INFO:BEGIN -->

<a id="project-overview-zh"></a>
## 中文项目说明

将飞书私聊、Codex 与 Obsidian 连接为人工审核的知识整理流程，支持问答归档、可访问网页采集和本机文件打开。它是 [lark-channel-bridge](https://github.com/ddcarolyn/lark-coding-agent-bridge) 的非官方扩展，保留上游归属。

**使用入口：** 先读 [中文说明](README.zh.md) 和 [安全说明](SECURITY.md)，按要求准备 Node.js、已登录 Codex、Browser Use 和飞书配置，运行 `npm ci`、`npm run build` 并配置 `.env`。

**范围说明：** 面向 macOS 上的个人桌面使用，不是多用户安全机器人；桥接停止时不会继续采集，没有独立后台爬虫或云同步服务。

<a id="project-overview-en"></a>
## English project overview

Connects private Feishu conversations, Codex and Obsidian into a human-reviewed knowledge workflow, with Q&A archiving, accessible-page collection and local file opening. It is an unofficial extension of [lark-channel-bridge](https://github.com/ddcarolyn/lark-coding-agent-bridge), with upstream attribution preserved.

**Getting started:** Read the [usage guide](docs/USAGE.md) and [security notes](SECURITY.md), prepare the required Node.js version, signed-in Codex, Browser Use and Feishu configuration, then run `npm ci`, `npm run build` and configure `.env`.

**Scope:** Designed for personal desktop use on macOS, not as a secure multi-user bot. Collection stops with the bridge; there is no independent background crawler or cloud-sync service.

**仓库维护者 / Repository maintainer:** [SvenKunkka](https://github.com/SvenKunkka) · [X / Twitter](https://x.com/Svenu1s5)

<!-- SVENKUNKKA-PROJECT-INFO:END -->
