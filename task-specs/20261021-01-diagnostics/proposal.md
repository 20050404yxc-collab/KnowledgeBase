# Task: Persistent cross-process diagnostics

- ID: 20261021-01-diagnostics
- Status: completed
- Workflow mode: execute
- Plan revision: 2
- Approval status: approved within requested scope
- Approved revision: 2
- Approval basis: User explicitly requested overall detailed logging to locate failing steps and causes. This authorizes implementation under developer autonomy instructions; no release, data migration, remote reporting or unrelated product work is included.
- Updated: 2026-10-21
- Docs language: Chinese
- Task-specs language: English
- Human documentation: [Logging and troubleshooting](../../docs/确认页/工程规范/日志与问题排查.md)
- Related tasks: product task 20261020-01 and engineering-standard task 20261020-02; their existing pending edits are preserved.

## Intent and scope

Electron discarded worker stderr and worker exceptions became generic controlled messages without persistent diagnostics. Add local structured logs covering existing renderer/preload requests, host lifecycle/transport, backend operations, model transport, parsing, persistence, credentials and cleanup. Preserve business/protocol semantics, data locations and schema. No paid API, real credentials, new product behavior, external collector or dependency is authorized.

## Standards

Project authority: `docs/确认页/工程规范/项目编码与分层规范.md`, revision 2, read 2026-10-21, active. User AGENTS rules require targeted dependency/lifecycle tracing and truthful verification. General-engineering workflow references were consulted; developer authorization rules take precedence over inferred skill confirmation gates. Project-specific standards remain at their authoritative location; no global skill or source standard was edited.

## Approach and risks

Use bounded process-owned rotating files, request/session/span correlation and explicit boundary instrumentation. Log technical exception causes and locations without exception bodies, private paths, SQL parameters, prompts, source text or credentials. Queue overload and I/O failure remain observable without replacing business errors. Added I/O has overhead; no large-library performance claim is made. Abrupt termination can lose queued host records.

## Revision 2: Startup files and retention

User requested fresh logs on every startup, date plus daily index naming, and deletion only beyond fourteen days. This explicit behavior change authorizes implementation under developer autonomy instructions. AC-04 and AC-07 are revised; other requirements remain effective. Reuse the same task and human page. Scope includes process-owned file allocation, byte-size segmentation, safe expiry cleanup, settings explanatory text, affected test readers and documentation. No schema, credentials, wire protocol or data-directory change.

Each process allocates `YYYY-MM-DD-N-{desktop|worker}.log` exclusively, using local date and maximum existing daily index plus one. Worker restart allocates a new worker file; session IDs still correlate both processes. Keep all segments within retention instead of five backups. Cleanup uses strict modification age >14 days at startup and the first write after a day. Exclude active files, links, directories and unrelated names; recognize legacy process logs. Cleanup errors use fixed warnings and do not prevent logging or business work. High-volume fourteen-day history has no aggregate byte cap. Shutdown and abrupt-termination limits remain.
