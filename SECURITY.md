# Security and privacy boundaries

## Intended deployment

This release is for a **single trusted application owner on a personal macOS computer**. It is not an independently audited security boundary or a multi-tenant service.

- Upstream new-profile permissions default to `full`, mapped to Codex `danger-full-access`, with noninteractive tool approvals. A working directory is not a filesystem sandbox. Review and reduce profile permissions when appropriate before handling untrusted tasks.
- Keep the bot private. Do not use upstream invitation/group/document-comment entry points to broaden access without reviewing the entire personal-WIKI retrieval path. Owner-only checks on social collection and local opening do not make the rest of the upstream agent safe for multiple users.
- Local file opening intentionally has **no directory allowlist**. Paths are passed as arguments to macOS `open`, without a shell. This avoids shell interpolation but does not make every file safe: opening applications or active documents can have effects. Only send paths you intend to open. NAS shares must already be mounted; the bridge does not handle NAS passwords.
- Recall is best-effort cancellation after the platform event arrives. It cannot undo an external action that already happened, retract all previously delivered content, or guarantee that a subprocess has not performed work before cancellation.
- A prompt-injection boundary in the instructions is a defense in depth, not a proof that a general-purpose agent cannot be manipulated. Treat web pages, attachments and retrieved notes as untrusted data.

## Data destinations

- Questions, references and captured text may be sent to Codex/the model service when an answer or summary is generated. The collection process is local, but the AI workflow is **not offline-only**.
- Browser Use uses the user's connected Chrome session. This can expose authenticated content to the collector. Login, MFA and permission choices remain the user's responsibility. Do not bypass access controls or reuse another person's session.
- Markdown notes contain source URLs and possibly user-submitted content. State files contain indexes, message associations and a durable approval ledger. Logs can contain identifiers and diagnostics. Keep these directories private.
- The `.env` file, credentials, browser cookies, vault files, logs, databases and ledgers must never be committed. `.gitignore` is a convenience, not a complete secret detector, and does not protect already tracked files.
- Review the upstream optional telemetry settings before enabling any custom adapter. Do not put diagnostics containing private content into public issues.

## Human approval

Only the unique top-level approval control authorizes reuse. Source text, frontmatter and examples inside the note do not confer approval. Social v2 reviewed content is limited to the summary and personal additions. Editing that region invalidates the current approval. Do not delete the review ledger as if it were only an index cache: it preserves prior approvals and retirements.

Notes must be reviewed for factual correctness, source rights and confidentiality before reuse or redistribution. Successful capture and a successful test run are not factual approval or permission to republish third-party text.

## Reporting

For a security issue, use GitHub's private vulnerability reporting if enabled on this repository. Do not open a public issue containing a token, chat excerpt, private URL or exploit against a real account. Reproduce with synthetic data and redact diagnostics. There is no guaranteed response-time SLA for this personal project.

## 中文摘要

这是单人、本机使用的开源代码，不是已通过安全审计的多人服务。上游默认具备较高文件权限；打开文件没有目录白名单。请保持仅本人使用，不把机器人直接开放给群或其他人。网页内容、附件和旧问答都是不可信资料；提示词约束不是沙箱。模型回答/摘要可能把相关文本发送给 AI 服务，因此不能称为纯离线系统。

凭据、Chrome 会话、聊天、库文件、日志、索引和审核账本均应留在私有目录。公开提 issue 时不要粘贴上述内容。撤回仅停止可取消的后续工作，不会回滚已经完成的文件或外部操作。
