# Verification Record

## Environment and Scope

- Date: 2026-10-20, user timezone Asia/Shanghai.
- Workspace: `D:/code/KnowledgeBase`.
- Shell: PowerShell; Windows 11 Pro x64 10.0.26200, RAM 34,078,760,960 bytes. Reused Node 24.18.0, npm 11.16.0, Python 3.13.14, Git 2.55.0.windows.3.
- Current scope: explicitly authorized environment preparation with installation locations confirmed before mutations; full product revision 2 remains pending. Historical documentation/research evidence follows.
- Product source and installer: not created. Development dependencies and disposable synthetic samples/credential were exercised; no real secret or model API call was used.

## Documentation Evidence

| Item | Method / working directory | Result | Evidence or limitation |
|---|---|---|---|
| Related-document/task discovery | `Get-ChildItem -LiteralPath 'D:\code\KnowledgeBase' -Force`; `rg --files --hidden` with generated/dependency directories excluded | passed | Directory listing was empty and rg returned no files (exit 1 means no matches); no local active/archive record was available to reuse |
| Workflow/standards references | Read installed core skill plus task-workflow, confirmation-maintenance, standards-index references | passed | No bundled language/architecture standard; user-provided AGENTS instructions and no-additional-standards choice remain applicable |
| Revision-1 artifacts/links/traceability | PowerShell inventory, local link resolution, requirement/scenario/fence/AC checks and targeted text review | passed (historical) | Nine Markdown files, 18 local links, 19 ACs and 30 scenarios at revision 1. These counts do not establish validation of changed revision-2 text |
| OCR open-source research | GitHub repository search and official README/configuration/installation/model-license/example content retrieval on 2026-10-20 | passed (source review only) | Read RapidOCR, PaddleOCR, Docling and OCRmyPDF official material. Links and conclusions in Chinese technical page. Resolved README-linked paths using repository trees when direct paths returned 404. No package/model download, execution or benchmark |
| Revision-2 artifacts, links and traceability | PowerShell recursive inventory, local-link resolution, requirement/scenario/fence checks, expanded AC task ranges and revision/approval assertions; targeted `rg -n` review of outdated pending/status wording | passed | Nine Markdown files, 19 valid local links, 19 ACs, 30 structured scenarios, all 19 ACs covered by tasks and evidence, no unbalanced fences and zero static-check issues. Source text for existing visuals retained; diagrams not rendered. Confirmed A/local/Windows/provider direction is separated from candidate OCR and pending runtime evidence |

## Planned Product Acceptance Evidence

All product requirements below are **not run**. No application exists yet, and no product build, tests, network model calls or installer checks were performed.

| AC | Planned method | Result | Main evidence needed |
|---|---|---|---|
| AC-01 | Interactive desktop/background task run | not run | UI remains usable with progress and navigation |
| AC-02 | Chinese/rephrased retrieval fixtures with configured capabilities | not run | Existing concepts returned, no automatic duplicates, partial evidence marked |
| AC-03 | Drag, picker, local path, inaccessible file and empty-query cases | not run | Equivalent input behavior and accurate readiness/errors |
| AC-04 | MD/TXT/DOCX/PDF and mixed scanned-page fixtures | not run | Supported structure/locators and explicit parsing/OCR limits |
| AC-05 | Scope and citation assertions plus source navigation | not run | Actual source evidence; no invented locator or unsupported file claim |
| AC-06 | Long summary, multi-file comparison and partial-coverage cases | not run | Document coverage and per-file/conflict attribution |
| AC-07 | Session cleanup, explicit admission, original-file comparison | not run | Temporary/full-source policy and preserved excerpts/originals |
| AC-08 | Success/failure/cancel/duplicate capture tests | not run | Complete attributable knowledge only, atomically saved |
| AC-09 | Controlled 2/1/0 eligible-item stores and failure cases | not run | Relevant unique 2+1 / 1+2 / 0+3 lists or truthful failure |
| AC-10 | Repeated in-flight/completed expansion selection | not run | On-click generation, single capture and recovery |
| AC-11 | Controlled dates/events/timezones and manual override under confirmed A thresholds | not run | 3 distinct use days/14 days; archive age >=30 days and no use for 30 days; daily deduplication and manual override |
| AC-12 | GPT-first plus DeepSeek/Claude/Grok actual protocol/model and capability cases | not run | Actual endpoints, protocol variants and model/embedding access remain to be verified |
| AC-13 | Controlled returned/missing usage, retry, cancellation and currencies | not run | Attempt-level accounting, unknown values, distinct estimates |
| AC-14 | API unavailable and embeddings absent | not run | Usable local browse/search and honest degradation |
| AC-15 | Failure injection and shutdown/owned-process inspection | not run | Settled UI, no orphan workers, correct commit/cancel semantics |
| AC-16 | Edited-note refresh and knowledge/source deletion | not run | User edits protected, appropriate index/citation state, originals untouched |
| AC-17 | Secret-storage/log inspection and hostile-source fixtures | not run | No plaintext credential leakage or source-command authority |
| AC-18 | Packaged app on clean Windows 11 x64 /16GB /no dedicated GPU | not run | Baseline confirmed, minimum requirements unmeasured; no separately installed Python, explicit OCR/conversion delivery |
| AC-19 | Transaction/disk fault, source-version and model-dimension changes | not run | Durable canonical content, failure recovery, safe index rebuild |

## Documentation and Standards Review

The Chinese human pages are intended for user review; the task records use English. Confirmed frequency, provider direction, local-path scope and Windows baseline retain their individual approval; full revision 2 remains pending. Environment preparation was separately authorized after location confirmation and is complete; final OCR/product delivery remains undecided. The Mermaid diagram has not been rendered. Historical revision-2 documentation checks remain recorded above; current environment/static evidence is below. All product behavior remains not run.

## Unverified Items and Residual Risks

- Exact development candidate releases and model hashes are now recorded. Complete dependency/model redistribution terms, product compatibility and packaging have not been audited/validated.
- Windows 11 x64 /16GB /no dedicated GPU is confirmed. The preparation host/build and candidate model sizes are now recorded, but the clean 16GB acceptance host and representative document set are not established. Real-document parsing accuracy, peak OCR resources, minimum requirements and product installation behavior remain unknown.
- Actual provider protocols, embedding availability, price semantics and API costs are unknown until the user's configuration and controlled tests exist.
- Retrieval/capture quality, citation accuracy and duplication control require behavioral evaluation; document structure checks cannot establish them.
- Frequency A and local-only file addresses are confirmed. Final OCR choice, OCR/DOC launch scope/resource delivery and optional cost controls remain pending review.
- Product implementation and acceptance are outstanding, not passed or complete.

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
