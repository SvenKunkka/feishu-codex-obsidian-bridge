# Changelog

## 0.2.0 — 2026-09-08

### Added

- Browser Use adapters for WeChat Official Account articles and public GitHub
  README, file, issue/PR/discussion primary body, release and Wiki pages.
- Kickstarter and Indiegogo campaign-text adapters, including supported detail,
  FAQ and update routes with separate source identities.
- Platform filters for collection search, statistics and confirmed-only analysis.
- Separate page metadata snapshots for available GitHub and crowdfunding fields.
  These are not social-interaction counts, funding-growth calculations or proof
  that a campaign has delivered its promises.

### Preserved and hardened

- Existing generic-web notes retain their file, source key, canonical URL,
  corrected text and confirmation history. Platform classification is derived
  in the catalog; ordinary repeat links do not rewrite the note.
- Evidence-backed WeChat long/short aliases survive restarts. Conflicting aliases
  are rejected; matching titles alone never merge sources.
- GitHub file/ref case and crowdfunding subpage identities stay distinct.
- Explicit refresh updates machine capture only. Page metadata cannot inject
  source-section delimiters or acquire human approval.
- No changes to upstream credentials, running services or existing vaults are
  performed by installing or building this source release.

### Validation and limits

- Synthetic DOM and integration regressions cover extraction, URL identity,
  legacy-note reuse, refresh, platform filtering and confirmation boundaries.
- Browser Use smoke tests captured public WeChat articles, GitHub README/file
  text and a current Indiegogo campaign story into an isolated temporary vault.
  This is not a production Feishu-to-Obsidian acceptance test.
- The live Kickstarter sample encountered a security challenge and was correctly
  rejected without saving the challenge page. Successful unrestricted live
  capture on Kickstarter and all crowdfunding subpage layouts is not certified.
- Login/verification, unavailable pages, changing layouts and unloaded content
  can prevent capture. Previews, omitted replies, missing media text and detected
  truncation remain partial; access controls are not bypassed. Private GitHub
  repositories, release downloads and repository cloning are not supported.

## 0.1.0

Initial public source release: a pinned, reproducible upstream bridge patch with
human-reviewed Obsidian Q&A, Browser Use social collection, collection search and
statistics, local file opening, message recall cancellation and activity reactions.
