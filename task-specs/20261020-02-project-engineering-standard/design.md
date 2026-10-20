# Implementation Design — Revision 3

## Baseline and compatibility

Revision 2 adopted the architecture but left main.tsx, worker/service/store/providers/parsers monoliths in place. Revision 3 migrates the existing supported behavior. Keep worker.py, npm commands and the root launcher; retain wire fields/operations, SQLite schema user_version=1, data location and credential service KnowledgeBase.test0.01. Pending API editing/model catalog work is a separate uncommitted plan.

## Ownership and dependencies

- React: main.tsx mounts App. app owns navigation/session composition; features own exploration, knowledge, providers, sources and usage UI/hooks. Shared code contains the constrained API, feedback and styles. Cross-feature collaboration uses public entries. No renderer SQL, provider HTTP or Node access.
- Electron: index assembles window_manager, ipc_gateway and worker_bridge. request_registry owns one-settlement promises/timers. The IPC gateway validates the current main frame, allowed operations and object parameters. WorkerBridge owns its spawned process tree and event correlation. Preserve 15s/180s/2.5s startup/request/shutdown deadlines.
- Python: entrypoints validates/routes protocol; application orchestrates questions, evidence, attachments, credential/config compensation and generation accounting through ports.py; domain holds identity, limits, frequency, answer/provider validation, typed records and usage state; infrastructure owns SQL, snapshots, parsing, HTTP/SSE and Windows credentials. bootstrap injects implementations and closes partial construction resources.
- contracts contains DTOs, operation maps, protocol.md and shared synthetic samples. Runtime predicates live at the desktop boundary rather than in declaration-only contracts. Predicates validate complete known DTO fields before use.

## State and failure paths

QuestionLocks counts owners and queued callers, releasing entries after the last exit including cancellation. Questions validates scope, collects/budgets evidence, handles offline/reuse, generates and validates, then yields at the final cancellation checkpoint before synchronous atomic capture. Streaming text never becomes partially saved knowledge.

Parsing copies and reads in the same background operation. A cancelled awaiter transfers snapshot cleanup to completion; the service settles work before resource close. Filesystem/SQL are separate resources: copy before metadata insertion, compensate on insertion failure, delete owned bytes before metadata, and retain startup orphan recovery. Never delete user originals. Credential writes retain the old secret until metadata success. Compensation and terminal accounting failures attach controlled context without replacing the primary error/cancellation.

Each model request captures prices and starts an attempt before HTTP. Infrastructure returns text and GenerationState; application records known usage/cost in terminal cleanup. Invalid/unknown tokens retain null semantics; no inferred free cancellation and no automatic retry.

## Conventions and tooling

Use snake_case scripts, PascalCase React components, Chinese four-line headers and function/step explanations. Split normal-formatted functions to <=80 effective lines including JSX. Prettier 3.6.2 is the sole added dependency; existing dependencies are not upgraded. Ruff checks Python imports/syntax and formats at 100 characters. Strict TS also checks unused locals/parameters. AST checks cover selected imports, scale, names and headers, not all semantic/comment-quality rules.

## Validation and documentation

Retain existing pytest behavior tests with migrated imports. Add shared protocol fixtures and focused fault/lifecycle tests. Run npm run check, PowerShell parsing and built desktop regression with independent Electron profile and temporary KB_DATA_DIR. Real paid APIs, OCR preparation, environment reinstalls, schema migrations and packaging are excluded. Reconcile Chinese standard, migration page, README, AGENTS, environment instructions and release metadata. Stage only refactor-owned changes; publish main plus a new annotated test0.03 tag.
