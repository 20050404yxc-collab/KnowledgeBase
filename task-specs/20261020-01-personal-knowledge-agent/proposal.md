# Task: Personal Knowledge Agent v1

- ID: 20261020-01-personal-knowledge-agent
- Status: draft
- Workflow mode: execute (environment preparation only; product revision 2 remains pending)
- Plan revision: 2
- Approval status: pending
- Approved revision: none
- Approval basis: Earlier confirmed direction and stack remain valid. Frequency A, Windows baseline, mainstream-provider direction and local paths retain their individual approval. The latest request authorizes environment preparation; the user explicitly confirmed installation locations before installation. Product revision 2, final OCR selection and product feature implementation remain pending.
- Updated: 2026-10-20 (Asia/Shanghai)
- Docs language: Simplified Chinese
- Task-specs language: English
- Human documentation: [overview](../../docs/确认页/确认文档总览.md), [product](../../docs/确认页/个人知识库/产品方案.md), [technical design](../../docs/确认页/个人知识库/技术设计.md), [delivery and acceptance](../../docs/确认页/个人知识库/实施与验收.md)
- Related tasks: none found
- Plan routing: new-unrelated
- Routing basis: Repeated directory listing and rg file discovery found the current workspace empty before this task. No human docs, active task records, archived plans, source, or adopted OpenSpec tree were present. This is the first record for the continued conversation objective; no related project records were available to reuse.

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
- Prepare isolated development dependencies and tools based on the selected stack, preserve lockfiles and installation guidance, and run environment smoke checks.
- User explicitly confirmed project `.venv`, project `node_modules`, `D:/dev-tools`, and `D:/dev-models/KnowledgeBase` before installation. This is authorization for environment preparation only, not approval of the full product revision.

Out of scope:
- Product feature implementation, paid/model API calls, deployment, full product acceptance or archival in this turn. Candidate-library installation is authorized only for environment preparation.
- Cloud sync, accounts, collaboration, online document/website ingestion, automated web research, quizzes/mastery scores, and modification of other applications' provider configuration.
- Treating candidate libraries, unverified protocols, OCR delivery, minimum hardware, or unmeasured performance as approved facts.

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
5. Generate documentation now; do not begin product implementation.
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
