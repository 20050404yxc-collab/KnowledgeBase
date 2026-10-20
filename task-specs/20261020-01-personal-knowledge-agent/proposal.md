# Task: Personal Knowledge Agent v1

- ID: 20261020-01-personal-knowledge-agent
- Status: implementing
- Workflow mode: execute
- Plan revision: 2
- Approval status: approved for development; final release decisions remain pending
- Approved revision: 2 (development authorization; not final acceptance)
- Approval basis: User explicitly requested "进行开发吧，然后加入版本控制，现在是test0.01" on 2026-10-20. This supersedes prior documentation/environment-only restrictions for development and local Git. Paid API calls, unresolved OCR/DOC release choices and clean-machine release acceptance are not inferred.
- Updated: 2026-10-20 (Asia/Shanghai)
- Docs language: Simplified Chinese
- Task-specs language: English
- Human documentation: [overview](../../docs/确认页/确认文档总览.md), [product](../../docs/确认页/个人知识库/产品方案.md), [technical design](../../docs/确认页/个人知识库/技术设计.md), [delivery and acceptance](../../docs/确认页/个人知识库/实施与验收.md)
- Related tasks: none found
- Plan routing: continue
- Routing basis: This turn continues the sole existing personal-knowledge-agent record. Existing product, technical, delivery and environment documents were inspected before implementation; no parallel task was created. Original empty-workspace discovery remains historical evidence.

## Intent

Build a personal Windows desktop knowledge agent that retrieves existing knowledge, answers questions grounded in attached documents, accumulates reusable knowledge, and encourages related learning while exposing API usage.

## Scope

In scope for the product plan:
- Electron desktop and React/TypeScript UI with a managed Python worker and local SQLite persistence.
- Local-first knowledge retrieval, document questions, source citations, automatic knowledge capture, three related-learning cards, and usage-frequency buckets.
- Drag/drop, file picker, and local file paths; MD, TXT, DOCX, and text-PDF core targets.
- On-demand permanent document retention, with minimal citation evidence retained in derived knowledge.
- GPT-first API configuration/adapters with DeepSeek, Claude and Grok integration targets, OS-protected credentials, usage records and cost estimates; actual protocols/models remain to be verified.
- Confirmed A frequency policy, local-path-only file addresses, responsive progress, cancellation, failure recovery, indexing consistency, and a packaged Windows 11 x64 application with a 16GB/no-dedicated-GPU acceptance baseline.
- OCR/scanned PDFs and legacy DOC compatibility assessment; launch inclusion is explicitly undecided.

Authorized in the latest turn:
- Implement the existing product design, beginning with a runnable test0.01 desktop development build; initialize local Git, commit the baseline and implementation, and tag test0.01.
- Preserve the complete v1 acceptance plan. First-test delivery does not mark unimplemented semantic indexing, OCR, legacy DOC, hierarchical summaries or installer acceptance complete.
- Use configurable Responses, Chat Completions and Anthropic Messages adapters with mock-based validation; real credentials are configured by the user in the app.

Out of scope:
- Paid API calls during development, remote publication/push, cloud sync, accounts or collaboration.
- Silently deciding unresolved OCR/DOC launch inclusion or claiming clean-machine installer acceptance.

## Approach

Use a controlled application workflow rather than unconstrained autonomous agents. Keep UI, process/file operations, and Python domain/data responsibilities separate. Parse documents into source-positioned blocks, retrieve within the selected scope, validate model output and citations, and persist complete reusable knowledge atomically. Prefer local derived indices over additional database services for the initial personal-use scope.

## Acceptance Criteria

The normative behavior contracts and scenarios are in [specs](specs.md): AC-01 desktop interaction, AC-02 retrieval, AC-03 file inputs, AC-04 parsing, AC-05 grounding/citations, AC-06 long/multiple documents, AC-07 retention, AC-08 capture, AC-09 recommendations, AC-10 expansion, AC-11 frequency, AC-12 provider configuration, AC-13 accounting, AC-14 offline fallback, AC-15 lifecycle, AC-16 maintenance, AC-17 data/credential boundaries, AC-18 installation, and AC-19 index/data consistency.

Separately authorized environment criteria ENV-01 (confirmed isolation/locations) and ENV-02 (reproducible candidate readiness) are defined in the same specs file and completed in this pass. They do not establish any product AC or full-plan approval.

## Standards

| Source | Status and provenance | Applicability |
|---|---|---|
| User-supplied AGENTS.md instructions | Active; supplied in chat and read in this session on 2026-10-20; no filesystem copy was found | Search before reading, inspect relevant chains, avoid redundant reads/checks, disclose evidence and verification limitations |
| User standards selection | Confirmed in structured reply: "推荐：沿用已提供要求，无额外规范" | No additional project coding/architecture standard is imposed; existing mandatory instructions remain effective |
| General engineering standards index | Read at `C:/Users/yang/.codex/skills/general-engineering/references/standards-index.md` on 2026-10-20 | Index has no bundled language/framework/layering standard; no retirement or replacement inferred |
| General engineering core and task/confirmation references | Read in this session from the installed skill | Chinese reviewable docs, English execution records, single current topic pages, truthful approval and evidence tracking |

No source standards are copied into unrelated global installations. Later supplied standards must be checked for impact before dependent implementation. No source-content fingerprint was calculated; provenance and read date are recorded without claiming synchronization guarantees.

## Decisions and Open Questions

Confirmed by the user:
1. Desktop application and local knowledge store with configurable APIs.
2. Buckets are 常用 / 在学 / 归档 and describe usage frequency, not mastery.
3. Sources are retained on demand; complete reusable new knowledge accumulates automatically.
4. The recommended Electron + React/TypeScript + Python + SQLite stack is selected.
5. Earlier documentation-only instruction is superseded for development by the 2026-10-20 request to develop and add Git at test0.01.
6. GPT is the primary integration direction, with DeepSeek, Claude, Grok and other mainstream providers; model IDs stay configurable.
7. Frequency option A: three distinct usage days in 14 days for 常用; age >=30 days and 30 consecutive days without use for 归档; new/remaining automatic items 在学, daily deduplication and manual override as described in the discussion.
8. File addresses are local paths only for v1.
9. Windows 11 x64 / 16GB RAM / no dedicated GPU is the acceptance baseline, not a validated minimum hardware specification.
10. Research existing open-source OCR before selecting a library. The research has been performed; library/runtime validation has not.

Pending for revision 2 review:
- Actual official/proxy provider protocols, concrete model availability, and embedding configuration within the confirmed mainstream-provider direction.
- OCR/scanned PDF and legacy DOC launch requirements and dependency delivery.
- Final OCR selection: RapidOCR + ONNX Runtime is a researched priority candidate; Docling is a complex-layout enhancement candidate, not an approved final combination.
- Representative files, concrete test machine/Windows build, measured performance limits and minimum hardware.
- Optional daily-budget reminders and generation caps.

Implementation choices such as specific parsers, build tools, model clients, vector extension, keyring adapter, and versions are candidates. Their validation may proceed only during an authorized implementation/technical-validation stage. Material scope changes return for review; routine in-scope package choices may use the agreed validation gates.

## Plan Changes

- Initial revision 1: Consolidates the conversation into the first complete reviewable plan. No earlier record or full-plan approval exists. User decisions above are preserved; new details are pending. Only documentation creation is authorized in this turn.
- Revision 1 -> 2: User requested updating the related documents after choosing frequency A, Windows baseline, mainstream-provider direction and local-only paths, and requiring open-source OCR research. Affected AC-03/04/11/12/18, all four human pages and five task records. Recorded official OCR sources and candidate ranking; no final OCR or launch delivery consent inferred. Existing revision-1 link/structure checks are historical evidence only; changed documentation is rechecked. No runtime evidence existed to invalidate. Full-plan approval remains pending; implementation is unauthorized.

## Environment Preparation Authorization (2026-10-20)

The user requested environment/tool installation from the development documents, then required installation locations to be confirmed first. Read-only inspection preceded confirmation. The user explicitly selected: 采用上述位置，开始准备环境. Reuse existing Node 24.18.0/npm 11.16.0, Python 3.13.14 and Git 2.55.0; install project packages in the confirmed directories. Candidate versions may be evaluated without deciding product launch scope or final OCR selection. Prior documentation-only restrictions describe the previous turn and are superseded only for this environment scope. Full product revision-2 approval remains pending.

## test0.01 Execution Boundary

The user authorized development and local version control. The first runnable build includes desktop/worker lifecycle, SQLite notes, Chinese lexical search, local attachments with locators, source retention, scoped provider generation, complete-result capture, related cards, frequency A, OS-backed secrets and usage attempts. Development-runtime dependencies remain required. All v1 criteria retain their original final-acceptance meaning; partial evidence is reported as partial. No final product archival is authorized or performed.

## test0.01 Result

A runnable development build is implemented. Background tests (37), TypeScript checking, Electron production build, lint and isolated desktop flows passed. Full v1 remains implementing: semantic indexing, hierarchical summaries, OCR/DOC launch decisions, real-provider/document quality and clean-machine packaging remain outstanding. The local Git baseline is 20913b4; implementation is committed and tagged at delivery. No remote is configured or pushed, and no paid API request was made.
