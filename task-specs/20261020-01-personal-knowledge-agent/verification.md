# Verification Record

## Revision 7 implementation evidence (2026-10-20)

- Scope: right-side point/material controls, leaf/category selection, sequential batch outcomes, one project material submission for all pending group points, and compact frequency-page questions using exploration planning/settings. Page-keyed drafts, directories, previews and results remain independent. No schema/version change, production data access, real credentials, paid APIs, commit/push or publication.
- `npm run check`: passed; 89 TS/JS and 60 Python source files checked, formatting/Ruff/strict types, 134 Python cases, 9 host cases and production build. Added boundary cases cover batch continuation after a single failure, manual supplement review, cancellation exactly between material audit and generation, retained material previews after point navigation, revocation of public candidates and removed-material rejection.
- `npm run test:ui`: passed; 20 reported workflows and 18 screenshots on an isolated profile/data directory and controlled local HTTP/SSE. Category selection selects three points; cancelling point 2 retains point 1 and never starts point 3. A single project path submission processes three independently audited/cited points. A native File inserted through CDP is dropped into the project frame and deduplicated, without duplicate global attachment handling. Each bucket submits through question.plan plus independent review and retains its own directory; returning to exploration restores the original query/directory.
- Visual QA: inspected desktop-batch-cancel.png, desktop-project-batch.png, desktop-project-batch-narrow.png and desktop-bucket-question.png. Detail-column controls, project path/upload form and compact question form render within their containers; 1024px project layout has no horizontal page overflow. Existing Markdown wide/narrow and safety DOM regressions remain passing.
- Limits: synthetic model responses establish orchestration, citations, state ownership and persistence behavior only. Real model classification/material relevance, GitHub availability and manual interaction with the native file-picker dialog remain unverified. Project grouping uses visible audited category/subcategory; users must check model grouping. Each point still incurs separate actual audit/generation attempts; no automatic retries or supplement confirmation.


## Revision 6 implementation evidence (2026-10-20)

- Authorization: user instruction “进行开发” covers the complete R6 including retained R5 requirements. Used existing task/pages and the selected project coding/layering standard. No subagents, paid/live APIs, production credentials/data, schema migration, version bump, commit/push or release.
- `npm run check`: passed, including standards (81 TS/JS, 60 Python files), Prettier, Ruff, TypeScript, 132 Python tests, 7 host tests and production Electron build. Shared executable offline protocol scenarios remain compatible; additive synthetic DTO samples cover hierarchy/review/project fields in runtime decoding.
- `npm run test:ui`: passed with 17 reported flows and 14 screenshots in an isolated Electron profile. Verified independent exploration/common/learning/archive first frames, per-page filters/details, unsaved editor drafts, scroll restoration, completed exploration restoration, qualification reasons, two-level category grouping, project material request, unrelated-attachment rejection and late-plan navigation isolation. Existing API/model/supplement/citation and graceful/forced worker shutdown regressions pass.
- Targeted Python review/workflow suite: 39 passed. Covers fail-closed/zero/uncertain qualification; direct and related non-knowledge capture prevention; adequate/irrelevant/removed project evidence; point-bound single-use consent, explicit file-only public scope, candidate selection/provenance; revoke/cancel during search or generation; full taxonomy beyond six candidates, budget coverage, file-only exclusion and legacy/path restart identity.
- Public HTTP adapter tests use mocked HTTP: fixed GitHub HTTPS API, bounded one-search/three-README reads, size and 15-second total request deadlines, rejected redirects, rate-limit/failure behavior and retained source metadata. No real GitHub search was performed during validation. Desktop exercises visible consent/material controls; full search/select/learn permission lifecycle is covered in backend tests rather than live desktop networking.
- Markdown regression uses the screenshot-style malformed `- **整体开发与设备接入： **独立负责`. Display repairs colon-ended bold labels while preserving source; unit/DOM checks protect code, escaping, links, mathematical stars, citation markers and safe rendering. Visually reviewed `desktop-markdown.png`, `desktop-markdown-narrow.png`, `desktop-independent-pages.png`, `desktop-project-materials.png`: repaired bold labels, normal lists, readable narrow layout, table/code scrolling, isolated bucket content and clear material/consent controls.
- Page fix: navigation records outgoing scroll synchronously before DOM changes; layout restoration uses per-page positions. Cached lists are keyed to page/query and unmatched lists are hidden before debounce. Selection epochs and page ownership reject late detail/error/result writes; completed exploration and page drafts remain recoverable.
- Classification implementation: repository scans all stored classification labels, ranks them and provides an 8000-character path budget with coverage notice; body candidates remain at six and retrieval is lexical. New category/subcategory paths use versioned UTF-8 JSON hex in the existing theme storage, with no legacy reclassification or database migration.
- Documentation checks passed for 10 changed Markdown files, 43 local file/heading links and balanced fences; `git diff --check` passed. Generated screenshots/reports stay ignored under `artifacts/test0.03`; no production data is included.
- Limits: semantic quality of real-model qualification/material sufficiency/classification and relevance of real GitHub projects are unverified. Tests do not establish exhaustive race/crash/accessibility coverage, semantic search, OCR, packaging, clean Windows 16GB acceptance or full-v1 completion. Old knowledge is retained as-is; newly added review does not bulk clean earlier captures.

## Historical revision 5 planning evidence (2026-10-20, before R6 implementation)

- Inspected the selected project standard, existing product/technical/delivery pages and direct planner/domain validation/learn/attachment/request/transport/Markdown/test chains. Effective standard: project revision 2 plus root AGENTS.md; no product files changed in this turn.
- R5-01/02/03/04: code reading confirms no semantic qualification/project-material consent states or real public-project retrieval in current paths. This establishes diagnosis only, not new behavior acceptance.
- R5-05: local `node --input-type=module` using installed React, ReactDOM server and ReactMarkdown rendered `- **整体开发与设备接入： **独立负责` as literal stars in a list; corrected delimiter spacing rendered a `<strong>` element. Exit 0. No network, database or live credentials used. The screenshot's original saved source remains unverified.
- R5 implementation, new behavior tests, `npm run check`, `npm run test:ui`, actual model qualification and public-network retrieval: NOT RUN. Prior R4 results below are historical only.
- Documentation validation: `git diff --check` passed; changed-file inventory contained exactly nine Markdown documents; a local Python checker resolved all 38 local file/heading links in those documents. No product code, database or user-data changes.

## Revision 4 implementation evidence (2026-10-20)

- Authorization: the user chose lexical search/classified accumulation first, then said "开始修改" for the displayed R4 plan. Continued the same task on `D:/code/KnowledgeBase` under the unchanged project coding/layering standard. No subagents, paid APIs, production credentials/data, version bump, commit/push, publication or archive.
- `npm run check`: passed; standards (74 TS/JS and 54 Python files), formatting, Ruff, strict TypeScript, 111 Python cases, 5 host cases and production Electron build. Common protocol samples now include offline search and plan responses. Earlier migration fixture was corrected to restore genuine old structure instead of only lowering its version while leaving schema-3 objects.
- `npm run test:ui`: passed, 14 reported flows on an isolated Electron profile/data directory. Local HTTP/SSE confirms directory planning and selected-point detail use separate real request encodings and attempt records. Unselected points do not generate, original details reopen locally, all supplements preview before confirmation, confirmation uses no new HTTP call, independent supplement edit/delete updates search, independent local search adds no calls. Existing API catalog/edit/default/effort and worker lifetime regressions pass. Synthetic vault entry removed in finally.
- R4-01: desktop verifies heading/emphasis/list/table DOM, code literal citation markers, authorized inline reference modal, blocked HTML/script/unsafe URL, no remote image element; previews also render Markdown. Source remains editable. 1024px layout stacks and a long code line scrolls within the detail; screenshots visually inspected.
- R4-02: `test_topics_store.py` constructs 5020 newer notes plus older knowledge/supplement/source, verifies complete recall, stable disjoint 30-item pages, no usage/accounting side effects, source/update/delete index consistency, no-FTS full scan fallback and internal atomic rebuild. `test_topics_workflow.py` verifies offline/scoped temporary-file paging. This is functional scale coverage, not a production performance benchmark.
- R4-03/04: structured validation rejects raw question titles, duplicates, oversized plans/titles and unauthorized targets/citations. Planning creates no knowledge/usage records. Concurrent clicks on one point generate/capture once; only selected point is learned. Invalid plan generation preserves local search. Sessions are bounded and expired plans reject writes.
- R4-05/06: subsequent identical questions can bring new content; preview/confirm preserves ID and original manual note. Supplements retain time/model/provider/citation snapshot and edited state across restart; edit/delete index updates verified. Same short titles in separate themes coexist, Unicode-normalized identities reuse exact content. Changed/deleted targets reject commits. Receipt fault rolls back supplement/index; duplicate requests and duplicate content do not duplicate capture.
- R4-07: cancelled network wait and final precommit cancellation preserve an earlier committed point and prevent the new capture. File-only prompts contain no library text/candidates; target forgery is rejected, removed attachments revoke old directory generation, only actually sent evidence IDs can validate. Evidence+old-note context share the 28000-character budget with explicit coverage notice. Shared selection epochs reject late details on selection/page change; active requests are cancelled on page changes and explicit cancellation invalidates the next workflow step. The latter UI races were code-reviewed; exact inter-request cancellation timing is not deterministically exercised by desktop tests.
- R4-08: genuine synthetic schema-2 fixtures retain edited original text, citations, use days, manual bucket, provider catalog/ID and legacy query mapping. Consistent backup retains v2 state; middle-migration authorization fault rolls back DDL/version and retry succeeds; reopened migration is idempotent; backup copied to a separate closed recovery directory successfully upgrades; future schema is rejected. Production databases were not opened or migrated.
- Three protocols: `test_topics_wire.py` runs mocked HTTP through real transport/ProviderClient, verifies plan/detail instructions and separate `topic-plan`/`topic-learn` success accounting with unknown cost when usage is absent. Real GPT/DeepSeek/Claude/Grok behavior, grounding/classification/conflict quality remain unverified.
- Documentation validation: 11 changed Markdown files, 43 resolved local file links, balanced fences and zero static-check errors; `git diff --check` passed. Diagrams were checked as source; anchor navigation was not runtime-tested.
- Ignored artifacts: `artifacts/test0.03/desktop-check.json`, `desktop-directory.png`, `desktop-markdown.png`, `desktop-markdown-narrow.png`, `desktop-supplement.png`, `desktop-citation.png` and existing desktop captures. Detailed functionality is reflected in README, contracts and the same Chinese confirmation pages. Full-v1 incomplete tasks remain open.

### Earlier revision-4 planning evidence (historical)


- Scope: documentation-only planning on Windows/PowerShell in `D:/code/KnowledgeBase`. Initial `git status --short` was clean. The user selected lexical retrieval/classified accumulation now and semantic retrieval later; implementation authorization was pending in that earlier planning turn.
- Read root/user AGENTS constraints, the full project coding/layering standard and installed general-engineering workflow/confirmation/standards references. Searched current human docs and both existing tasks; reused this task because the request directly continues retrieval/capture and knowledge organization.
- Static chain inspected: renderer AnswerPanel/AnswerHeading/use_reading, exploration submission/page and library search; question validation/reuse/collect/generate/capture, domain relevance/answer validation, model response instruction, storage schema/list/save/cache and catalog migration, current contracts and dispatch/service boundaries. Findings are in design.md and human product section 3. The screenshot's exact request/provider response was not reproduced.
- Updated the same product/technical/delivery pages and overview plus proposal/specs/design/tasks/evidence. Human docs contain purpose/scope/how/effect/usage, confirmed diagnosis versus limits, selected/rejected scope, UI wireframe, Chinese sequence diagram, schema migration and validation risks. R4-01..R4-08 map to planned tasks and observable acceptance cases.
- Product checks (`npm run check`, `npm run test:ui`), real/paid APIs, production migration and visual execution of the proposed UI: not run; no product files changed. This is not evidence of implemented R4 behavior.
- Documentation validation: passed for nine changed Markdown files, 34 resolved local file links, balanced fences, required product wireframe/sequence and eight R4 requirements with task coverage. `git diff --check` passed with line-ending normalization notices only. A first temporary traceability assertion incorrectly expected every slash-abbreviated AC reference to repeat `R4-`; it was corrected to parse the existing notation and passed without product/document changes. Diagrams were checked as source, not rendered; anchor navigation was not runtime-tested.

## Revision 3 implementation evidence (2026-10-20)

- Git upload follow-up: user explicitly requested "git进行上传" after implementation. Fetched `origin`; local `main` and `origin/main` both pointed to `768f54a` before committing this increment. Reuse the passing checks below because product files have not changed since validation; this follow-up only records upload authorization. Commit and push this increment to `origin/main`, without a release/version/tag change.
- Authorization: user said "开始修改" for the displayed revision-3 plan. Implemented on the current test0.03 layered baseline, without a new release/version/tag or credential-service change.
- `npm run check`: passed. Standards and formatting, Ruff, strict TypeScript, 78 Python tests, 5 Node host tests and Electron production build.
- `npm run test:ui`: passed, 13 reported flows. Real React inputs exercised same-ID edit/cancel, blank-key discovery, deduplication, manual add/remove, optional default, draft-only changes and stale discovery cancellation. A local HTTP fixture confirms selected model and Responses effort reach the request, model changes reset effort, controls disable during generation, default is unchanged and override cost is unknown. Synthetic vault entry deleted in finally; no paid endpoint used.
- New Python evidence: 31 cases across `test_model_settings.py`, `test_model_catalog.py`, `test_model_catalog_migration.py`: three protocol auth/pagination, bad JSON/status/redirect/body limits, pagination bounds/cancel cleanup, saved/transient key resolution, same-ID edits, empty defaults and reuse, all basic effort payloads/auto omission, invalid selections, actual-model accounting and a question waiting on a lock during config edit. Legacy knowledge/config/attempts survive migration; backup is consistent, reopen idempotent, failure after DDL rolls back and retry succeeds.
- Artifacts (ignored): `artifacts/test0.03/desktop-check.json`, `desktop-model-settings.png`, `desktop-model-edit.png`, `desktop-model-selection.png`, plus existing desktop regression captures. Visual review checks settings/catalog controls and composer placement; it is not comprehensive responsive/accessibility acceptance.
- Documentation: updated README, protocol, the existing Chinese confirmation pages and English task records. Final local Markdown validation resolved 35 links with no missing target or unbalanced fence; `git diff --check` passed.
- Standard review: React feature hooks own draft/revision/session state, ModelPicker is pure display; application uses catalog port, infrastructure owns bounded HTTP/SQL, bootstrap injects. New catalog persistence is atomic, migration backup handles close before rename on Windows. Required headers/comments/function limits pass automated checks; these checks do not prove all semantic conformance.
- Limits: no actual GPT/DeepSeek/Claude/Grok service calls, real keys or production migration. Model catalogs provide IDs only; generation and effort support are unverified per model. Anthropic is auto-only. No forced regeneration, retry, embedding integration, package delivery, archive or publication.

### Earlier revision-3 planning record

Planning-only evidence (before the later implementation authorization)

- Historical status at planning: pending approval and implementation; static inspection/documentation only. Historical runtime results below do not cover revision 3.
- Inspected: relevant existing human/task docs, project standard, provider form/ask, contracts, IPC allowlist/preload, save/validation/three adapters, question/reuse/dispatch, provider schema/selection and relevant test entrypoints.
- Confirmed gaps: no edit entry, model discovery/catalog, optional default or request-level model/effort. Same-ID save and blank-key retention already exist in backend. No wider defect/live-provider compatibility claim is made.
- Planned: edit/cancel/key compensation, discovery/auth/pagination/errors/staleness, optional default/override, effort payloads, actual-model accounting, migration rollback/idempotency, local reuse and isolated UI regressions.
- Product code, runtime tests/builds, real credentials, live APIs and production migration: not changed/run in this planning turn.
- Documentation checks: `git diff --check` passed (line-ending normalization notices only). A temporary Python checker resolved 28 local Markdown links across the 9 currently changed Markdown files with zero issues, and asserted the API/main-composer wireframes, sequence diagram and pending labels. This task updated 8 documents; the additional changed task file belongs to concurrent workspace work and was not modified here. No permanent checking script was added.

## Environment and Scope

- Date: 2026-10-20, user timezone Asia/Shanghai.
- Workspace: `D:/code/KnowledgeBase`.
- Shell: PowerShell; Windows 11 Pro x64 10.0.26200, RAM 34,078,760,960 bytes. Reused Node 24.18.0, npm 11.16.0, Python 3.13.14, Git 2.55.0.windows.3.
- Current scope: explicitly authorized product development and local Git at test0.01. Historical documentation/research/environment evidence is retained; final v1 launch acceptance remains outstanding.
- Product source: implemented and built. Installer: not created. Isolated synthetic documents, mock HTTP/SSE and disposable OS credentials were exercised; no real secret or paid model API call was used.

## Documentation Evidence

| Item | Method / working directory | Result | Evidence or limitation |
|---|---|---|---|
| Related-document/task discovery | `Get-ChildItem -LiteralPath 'D:\code\KnowledgeBase' -Force`; `rg --files --hidden` with generated/dependency directories excluded | passed | Directory listing was empty and rg returned no files (exit 1 means no matches); no local active/archive record was available to reuse |
| Workflow/standards references | Read installed core skill plus task-workflow, confirmation-maintenance, standards-index references | passed | No bundled language/architecture standard; user-provided AGENTS instructions and no-additional-standards choice remain applicable |
| Revision-1 artifacts/links/traceability | PowerShell inventory, local link resolution, requirement/scenario/fence/AC checks and targeted text review | passed (historical) | Nine Markdown files, 18 local links, 19 ACs and 30 scenarios at revision 1. These counts do not establish validation of changed revision-2 text |
| OCR open-source research | GitHub repository search and official README/configuration/installation/model-license/example content retrieval on 2026-10-20 | passed (source review only) | Read RapidOCR, PaddleOCR, Docling and OCRmyPDF official material. Links and conclusions in Chinese technical page. Resolved README-linked paths using repository trees when direct paths returned 404. No package/model download, execution or benchmark |
| Revision-2 artifacts, links and traceability | PowerShell recursive inventory, local-link resolution, requirement/scenario/fence checks, expanded AC task ranges and revision/approval assertions; targeted `rg -n` review of outdated pending/status wording | passed | Nine Markdown files, 19 valid local links, 19 ACs, 30 structured scenarios, all 19 ACs covered by tasks and evidence, no unbalanced fences and zero static-check issues. Source text for existing visuals retained; diagrams not rendered. Confirmed A/local/Windows/provider direction is separated from candidate OCR and pending runtime evidence |

## Planned Product Acceptance Evidence

The following table separates test0.01 evidence from complete v1 acceptance. Partial evidence SHALL NOT be read as full-v1 passage.

| AC | Actual test0.01 evidence | Status / remaining limitation |
|---|---|---|
| AC-01 | Real Electron UI, note forms, navigation, parsing status and sandbox checks | partial; complete provider/background interaction remains to be exercised |
| AC-02 | Chinese lexical fixtures and real UI search, exact-title/content/query reuse | partial; no semantic/rephrased-concept quality acceptance |
| AC-03 | Real path attachment, invalid URL/format handling, picker/drop implemented | partial; manual picker/drop equivalence not run |
| AC-04 | Synthetic Chinese MD/DOCX/table sequence and text+blank PDF page | partial; representative complex/scan/OCR delivery remains outstanding |
| AC-05 | Strict scope excludes local notes, invalid citations rejected, real excerpt modal | partial; factual grounding/conflicts and original-document viewer unverified |
| AC-06 | Oversized full-summary rejects before API; evidence coverage notices | partial; no hierarchical summaries or real multi-document comparison |
| AC-07 | Snapshot version retention, source cleanup and original-file comparisons; actual UI retain | passed for test build; broader crash/fault recovery still pending |
| AC-08 | Success, exact duplicates, parallel coalescing, user edits, invalid citation and precommit cancellation | partial; actual reusable-content/model quality remains unverified |
| AC-09 | Deterministic 2+1/1+2/0+3 inventory tests; unrelated items excluded | partial; real relevance quality and reopened expansion restoration not implemented |
| AC-10 | Same-query concurrent/completed reuse tests and click-only UI generation path | partial; expansion quality and full real-provider retry UI not run |
| AC-11 | Fixed-date 14/30-day boundaries, distinct-day use, new items and manual overrides | passed domain tests; configurable thresholds UI not implemented |
| AC-12 | Three explicit mock SSE adapters, multiple saved configurations, generation-only disclosure | partial; real providers/models, embedding config and capability compatibility unverified |
| AC-13 | Mock returned/missing usage, retry attempts, cancellation, user price snapshots and UI currency separation | passed for test build; real/cached/reasoning price semantics not accepted |
| AC-14 | Actual offline UI browsing, editing, search, excerpt answering; lexical fallback disclosed | passed for test build; real network outages and semantic fallback not exercised |
| AC-15 | UTF-8 protocol, task cancellation, restart, normal and suspended-tree forced Electron shutdown | partial; pending-request backend failure/recovery and full cancellation matrix not run |
| AC-16 | Preserve edits, note deletion functions, source deletion and accurate citation-original state | partial; UI deletion confirmations and full fault matrix not run |
| AC-17 | Actual synthetic Windows Credential Manager roundtrip, DB secret absence, safe source text and renderer sandbox | passed targeted tests; not a comprehensive security audit |
| AC-18 | Production JS/CSS build and project-runtime startup | not accepted; no bundled Python installer or clean 16GB Windows test |
| AC-19 | Knowledge/query-map atomic rollback, failed source-copy rollback, source snapshot consistency and durable reopen | partial; no semantic index or full migration/disk-full/crash matrix |
| DEV-01 | Git baseline 20913b4, implementation commit/tag at delivery; consistent test0.01 metadata; launch entry | passed local development scope; no remote configured/pushed |

## test0.01 Executed Checks (2026-10-20)

All commands ran in `D:/code/KnowledgeBase` on the existing Windows 11 / 32GiB development machine, not a clean 16GB acceptance system.

| Command / method | Result | Evidence |
|---|---|---|
| `npm run typecheck` | passed | TypeScript strict compilation; initial request-ID inference issue corrected |
| `npm test` | passed | 37 tests in the final run; includes direct UTF-8 worker protocol and actual disposable Windows vault roundtrip |
| `.venv/Scripts/python.exe -m ruff check services/knowledge-agent tests` | passed | No outstanding lint issues after import and deliberate protocol-boundary handling fixes |
| `npm run build` | passed | Electron main/preload plus React production renderer emitted to ignored out/ |
| `npm run test:ui` | passed | 11 isolated actual Electron checks: note create/edit, Chinese search/no-hit, local file parsing/citation/retention, source/settings, durable reopen, no offline API attempts, sandbox and normal/forced process-tree cleanup |
| Visual inspection | passed for captured screens | Viewed artifacts/test0.01/desktop-empty.png, desktop-settings.png and desktop-knowledge.png; actual citation screenshot also generated; no clipping observed in viewed screens at the tested window size |
| Launcher script | passed | Start-KnowledgeBase.ps1 opens the visible 知序 window with isolated data and closes through its main window; initial hidden-window launch was corrected |
| Local Markdown links/fences and version metadata | passed | Relative links, balanced fences, exact npm/lock version, VERSION and runtime UI/preload version checked; see test0.01-check.json |
| Real providers, paid calls, OCR product workflow, installer | not run | No payment/credential assumptions; unresolved launch policy preserved |

The first shutdown test incorrectly expected one Python PID. Inspection established the normal Windows virtualenv launcher/runtime tree; the assertion now verifies one owned tree and absence of all its PIDs. The production timeout cleanup was strengthened to terminate only this owned tree. A fault fixture suspended the isolated tree and verified the 2.5-second timeout cleanup without orphan workers. The protocol test was corrected to wait for replies before EOF, since EOF intentionally cancels pending work during shutdown.

UTF-8 was made explicit in worker output after a direct-launch protocol test exposed the Windows default codepage. Knowledge and repeated-query keys now share one transaction; an injected SQLite-trigger abort proves no partial note is committed. Source-retention trigger failure similarly proves copied managed files are rolled back and the original remains intact.

## Documentation and Standards Review

The same Chinese product/technical/delivery/environment pages and overview now distinguish test0.01 behavior from full-v1 goals; README and CHANGELOG explain launch, limits and local Git. English task records retain historical decisions and outstanding acceptance work. User-provided reading/verification instructions and the confirmed no-extra-standards choice were followed; no subagents, global runtime modifications, real API keys or remote publication were used. Existing Mermaid diagram remains a design artifact and has not been rendered.

## Unverified Items and Residual Risks

- Real-provider availability, structured-output quality, citation entailment and related-learning relevance remain unverified; schema/ID checks cannot prove truth.
- Chinese lexical search can miss paraphrases; title/content/query identity does not solve semantic duplicates. Scan/OCR, old DOC, semantic indices and hierarchical summaries are unimplemented.
- Picker/drop share the path backend but manual equivalence was not exercised. PDF embedded-image omissions, complex layouts and representative Chinese PDF quality remain unmeasured.
- Broad disk-full/crash/migration/late cancellation matrices and restart during an active request remain outstanding. Targeted rollback and both normal/forced shutdown checks passed.
- No installer, bundled runtime, redistribution/license audit, clean-machine validation, peak resource measurement or measured minimum hardware is delivered.

## Environment Preparation Evidence (2026-10-20)

Authorization: the user selected the suggested project `.venv`, project `node_modules`, `D:/dev-tools`, and `D:/dev-models/KnowledgeBase` locations and instructed preparation to begin. Package inspection before that reply was read-only. Reused global tools; no global runtime upgrade or persistent PATH/cache change. Python dependencies are Windows binary wheels in the project venv. Exact transitive Python versions are in requirements-dev.lock.txt, npm versions/integrity in package-lock.json; model URLs/hashes in environment-models.lock.json. The Python version lock is platform-specific and does not include artifact hashes.

| Check | Command/method | Result and scope |
|---|---|---|
| Python dependency resolution/integrity | `python -m venv .venv`; venv pip `install --only-binary=:all: -r requirements-dev.in`; `pip check`; `pip freeze` | passed; 57 packages installed, no broken requirements; global Python unchanged |
| Node dependency tree | `npm.cmd install --no-fund --no-audit`; `npm.cmd ls --depth=0` | passed; 83 packages added; npm reported unapproved SWC postinstall, but installed Windows native SWC binary executed successfully; no blanket script approval applied |
| GitHub recheck | PowerShell HEAD to github.com, api.github.com, raw.githubusercontent.com, browser release ZIP and API asset URL; Node fetch HEAD | all five PowerShell requests returned 200; Node API and asset redirect returned 200, direct github.com and browser-release URL timed out (UND_ERR_CONNECT_TIMEOUT). Earlier Node/curl download failures were transport-specific, not total GitHub failure |
| Electron runtime download | `scripts/Install-Electron.ps1`: official GitHub release API asset, SHA-256 comparison before extraction | passed; 158,389,896-byte ZIP; SHA-256 `41bd7900bd42d0f49110a81617876137041fbbf473466920248ddb076349ef91`; runtime extracted to project node_modules/electron/dist |
| Frontend/runtime execution | `node scripts/check-node.mjs`; `tsc.cmd --version` | passed; React SSR, native SWC TSX transform, Vite build with no bundle written, electron-vite import/config, Electron 44.9.1 as Node runtime; TS CLI 7.0.2. Receipt: environment-check-node.json. No GUI/product window acceptance |
| Python library/OS checks | `.venv/Scripts/python.exe scripts/check-python.py` | passed; Pydantic/httpx mock, MD/DOCX roundtrip, synthetic PDF extraction/rendering, SQLite 3.50.4 FTS5 and vec 0.1.9, Windows credential create/read/delete with unique synthetic name. FTS fixture is English, not Chinese retrieval acceptance |
| OCR model readiness | `scripts/prepare-ocr.py`; checksums verified before use | passed; 3 bundled models copied to confirmed external directory, hashes match pinned RapidOCR metadata; 31,749,509 bytes of ONNX models, source URLs retained. Config/model receipt retained externally and project model lock retained |
| Offline CPU OCR smoke | check-python.py blocks model network requests before RapidOCR execution; generated Chinese/English image | passed; recognized `环境检查  Knowledge 123`, approximately 3.5 seconds including initialization for this one synthetic run; not a benchmark, real-document accuracy or 16GB acceptance |
| Developer CLIs and scripts | PyInstaller `--version`, pytest `--version`; Ruff check/format-check on the two Python scripts | passed; PyInstaller 6.22.3, pytest 9.1.1, Ruff 0.17.1; no product suite or installer build |
| Session configuration | dot-source scripts/Enter-Dev.ps1; print interpreter/cache/model paths | passed; interpreter resolves inside project .venv; npm/pip/Electron cache and model paths match confirmed D-drive locations; process-local only |
| Preparation docs/scripts | local Markdown link resolution; PowerShell AST parser; Ruff check/format-check | passed; 10 Markdown files, 27 resolved local links, zero broken links; both PowerShell scripts parse and both Python scripts pass checks |

Initial smoke-script issues (OmegaConf enum serialization, Vite 8 entry/result API handling, import formatting) were corrected in the new preparation scripts and the affected checks rerun successfully; they were not product defects. OCR model configuration uses 4 intra-op and 1 inter-op threads for the smoke environment, without claiming optimized performance.

Logical file sizes after installation: .venv about 389.3MiB; node_modules about 474.1MiB; OCR models about 30.3MiB, in addition to retained download caches. These are development directory totals, not installer size or physical disk allocation. Alternative OCR/layout stacks, LibreOffice, Docker, CUDA and native build tools were not needed/installed. Basic preparation is complete; full-plan review and all product ACs above remain outstanding.

ENV-01 is satisfied by installation locations plus the entry-script interpreter/cache checks. ENV-02 is satisfied by dependency/model locks, Electron checksum verification, Node/Python smoke receipts and explicit product-verification limits. Environment preparation is complete without archiving the unfinished product task.

Same-title/different-body generated answers now explicitly report that no new note was saved and keep the generated answer separate from the existing note metadata. A strict-file-scope regression test checks original-note preservation, current-file citations and the unsaved-content notice.
