# Implementation Design

## Current State and Evidence

The workspace `D:/code/KnowledgeBase` was initially documentation-only. The authorized environment preparation added dependency manifests/locks, isolated `.venv`, project `node_modules`, environment scripts and check receipts. This historical environment baseline is now superseded by the test0.01 implementation described below. The actual host is Windows 11 x64 build 26200 with 34,078,760,960 bytes RAM, Node 24.18.0/npm 11.16.0, Python 3.13.14 and Git 2.55.0. It is not the 16GB clean acceptance host. Exact candidate versions and synthetic environment checks are recorded in verification.md and the Chinese environment page.

Selected stack: Electron, React/TypeScript, Python, SQLite. All other named packages are candidates. The Chinese [technical page](../../docs/确认页/个人知识库/技术设计.md) is the reviewer-facing design and must remain aligned with this record.

## Technical Approach

- Electron main owns windows, trusted file selection/drop validation, singleton startup, and the Python child lifecycle.
- A sandboxed renderer uses an allowlisted preload API; it does not execute Node commands, make privileged file operations, or write the database directly.
- Python owns document ingestion, retrieval, domain decisions, provider adapters, protected credential access, persistence, and jobs.
- A controlled state machine coordinates evidence selection, generation, validation, capture, and related learning. No unconstrained autonomous-agent framework is required for v1.
- A single SQLite-backed local store holds canonical records. Text/semantic indices are derived and versioned; raw managed sources are files outside the install/repository directories.

## Architecture Decisions

| Decision | Reason | Alternative and tradeoff |
|---|---|---|
| Electron + React/TypeScript | Selected by the user; suitable rich reading and desktop input flows | Tauri could reduce shell overhead but adds Rust integration; it does not remove Python/OCR costs |
| Python processing | Selected; broad parser/OCR and model-client options | All-TypeScript requires a different parser/dependency evaluation |
| SQLite and local derived vectors | Selected base storage; modest operational burden for personal use | A separately deployed vector server is not justified by current evidence |
| Managed child over stdio | Avoid a manually operated localhost service; keep per-app lifecycle | HTTP would add port/auth/lifecycle concerns without current remote consumers |
| Controlled workflow | Deterministic capture, scope, cardinality, and failure behavior | Agent frameworks may be reconsidered if future workflows require iterative planning |
| Temporary attachments, explicit source library | User confirmed this retention policy | Automatic full-source retention accumulates incidental documents |

## Data and Control Flow

### Protocol and lifecycle

Use framed JSON messages (for example JSON lines with correctly escaped payloads) on child stdin/stdout. Commands carry request IDs, operation names, and typed parameters; progress, stream, result, and error events correlate to those IDs. Logs use stderr or dedicated redacted sinks. Bound message sizes and split oversized content; never interpolate document text into shell commands.

Backend startup has initializing/ready/failed states. A request cannot assume readiness before handshake. Electron main coordinates graceful cancellation and bounded shutdown, then terminates only owned descendants when needed. Detect backend exits, settle UI requests, and allow a clean restart. Do not automatically replay completed mutating requests.

Use bounded workers for parsing/OCR and asynchronous I/O for API streaming. Keep DB writes serialized by the backend owner; do not share a connection across worker processes. Jobs track cancellation and commit boundary. Before-commit cancellation yields no captured item; after-commit cancellation reports the persisted state. Stable operation IDs and uniqueness constraints reconcile late events and retries.

### Parsing and retrieval

Normalize parsers to `ParsedDocument` / `SourceBlock`-style contracts containing source/version fingerprint, structure, ordered content, locator, parser version, and warnings. Detect text coverage per PDF page. Parser candidates: markdown-it-py, python-docx, pdfplumber; MarkItDown as a possible common converter. Following requested open-source research, prioritize evaluation of RapidOCR + ONNX Runtime CPU for scanned-page text recognition, with Docling as a complex-layout enhancement candidate and PaddleOCR as another evaluation route. No final OCR combination or launch-delivery policy is approved. Legacy DOC conversion remains subject to support-policy review. Local paths are the confirmed v1 file-address boundary.

Official-source research on 2026-10-20 read RapidOCR README/config/model-license notice, PaddleOCR README/installation, Docling README/RapidOCR example, and OCRmyPDF README via GitHub API. Links and detailed findings are in the Chinese technical page. Evidence supports advertised Windows/CPU/offline paths and available integration examples, not measured performance or product compatibility. RapidOCR code and covered upstream-derived weights are described as Apache-2.0, PaddleOCR repository as Apache-2.0, Docling code as MIT with separate model terms, OCRmyPDF code as MPL-2.0. Lock exact artifacts and independently review applicable dependency/model licenses before redistribution. OCRmyPDF is not prioritized because adding a PDF text layer is not the central v1 workflow.

Proposed processing routes readable pages to direct extraction and renders scanned pages for CPU OCR, preserving page/region mappings. Evaluate complex-column/table fixtures before deciding whether Docling is necessary. First-use model preparation with subsequent offline use is a recommendation only; bundled resources are an alternative. Neither delivery method nor OCR launch inclusion is confirmed.

Split along semantic structure where possible, preserve source locators, and retain parent context. Short documents may be sent whole; focused long-document questions use retrieval, while summaries use coverage-aware staged processing. Validate citations against the permitted block set rather than trusting model-generated filenames/page numbers.

Use Chinese-capable lexical retrieval plus semantic retrieval when configured. Evaluate FTS tokenization and an optional sqlite-vec extension on Windows. Merge and deduplicate results; calibrate retrieval/confidence against real samples. Do not equate a low match score with proven absence. Generation/embedding models may be configured independently; missing embeddings allow keyword-only operation.

### Capture and related knowledge

Distinguish canonical source material, user notes, model explanations, and reusable generated knowledge. Generate/extract candidate knowledge, validate completeness/provenance/citations, check exact/concept duplicates, and commit atomically. Preserve personal edits. Near-similarity alone does not justify overwriting or merging two items.

Use a stable recommendation operation/card identity. Assemble two/one/zero eligible existing cards plus one/two/three expansions. Display reasons and short previews; generate full expansion only on selection. Coalesce repeated in-flight selections and reuse captured concepts. Failed recommendation generation explicitly reports incomplete output.

### Data ownership and retention

Proposed records: knowledge, relations, sources/versions, blocks, citations/excerpts, use events, provider settings with credential references, API attempts, index metadata, and jobs. Use schema-versioned migrations and recoverable transaction boundaries.

Session caches hold temporary managed copies, never user originals. Session-end cleanup removes only verified owned cache paths. Captured knowledge retains necessary excerpts/locators so evidence remains readable without storing the entire temporary source. Explicit admission copies the source into the managed source store and indexes that version. An external file modification does not silently mutate the retained version.

Deletion cascades through relevant derived indices/relations while retained excerpts and citation availability remain truthful. A failed copy/commit must not leave a falsely admitted record. Reindex after incompatible model, dimension, parser, or chunking changes; canonical content remains intact.

### Frequency policy

User-confirmed option A: active detail opening counts as use; deduplicate by item and recorded local calendar date; three distinct use days in the trailing 14 days means 常用; item age >=30 days and no use in the trailing 30 days means 归档; otherwise 在学. Manual override wins until cleared. Background retrieval, generation and card display do not count. Preserve timezone/date context and original events. When frequency drops below the threshold, 常用 returns to 在学 until archive criteria apply. Opening an automatic archived item reactivates it; manual override remains authoritative.

Use the confirmed A thresholds for deterministic time-boundary tests. This is a product frequency policy, not a validated memory/mastery model.

### Providers, credentials, and statistics

The user selected GPT-first integration with DeepSeek, Claude and Grok also in scope. Exact model IDs, official/proxy endpoints, protocol variants and embeddings remain unverified. Implement explicit adapters for actual protocols, not a universal base-URL assumption or model-brand inference. Normalize text streams, cancellation/errors, structured results, capabilities, and returned usage. Consider Pydantic/httpx and OS-backed keyring implementations after validation. Keys are transient configuration input and protected stored secrets; plain settings contain only references. Do not expose keys or full private texts in logs.

Count attempts, including retries and embeddings, with purpose and timestamps. Store provider-reported usage separately from estimates. Record unknown usage, price snapshot and currency. Do not add currencies without a defined conversion, assume cancelled calls are free, or count both cumulative stream usage and its final snapshot twice.

Render untrusted document/Markdown content with script filtering and Electron isolation. Model tools are allowlisted and scoped; source text cannot authorize commands, credential reads, or arbitrary file writes. Send only required scope context to configured external APIs and communicate that local storage does not imply offline inference.

## Planned File Changes

Current environment preparation includes the following paths and updates:
- `docs/确认页/确认文档总览.md`: navigation and current status.
- `docs/确认页/个人知识库/产品方案.md`: full product behavior and UI/sequence confirmation.
- `docs/确认页/个人知识库/技术设计.md`: architecture and candidate validation boundaries.
- `docs/确认页/个人知识库/实施与验收.md`: delivery phases, acceptance cases, unresolved choices.
- The five Markdown records in this task directory.
- `docs/确认页/个人知识库/开发环境.md`: confirmed paths, versions, rebuild instructions and limits.
- `.gitignore`, `package.json`, `package-lock.json`, `requirements-dev.in`, `requirements-dev.lock.txt`: isolated development dependency setup.
- `scripts/Enter-Dev.ps1`, `scripts/Install-Electron.ps1`, `scripts/prepare-ocr.py`, `scripts/check-node.mjs`, `scripts/check-python.py`: process-local environment, verified official Electron download, checked OCR resources and synthetic smoke checks.
- `environment-models.lock.json` and environment-check JSON receipts in this task: model provenance/hashes and environment evidence.
- Generated files: project `.venv` and `node_modules`; download caches under `D:/dev-tools/cache`; models/config/receipt under `D:/dev-models/KnowledgeBase/rapidocr`.

The current product implementation is under `apps/desktop/`, `services/knowledge-agent/`, `contracts/`, and `tests/`; fixtures are generated inside temporary test directories. The later user request authorizes development and Git, while OCR launch delivery remains undecided.

## Documentation Plan

Maintain the current Chinese pages in place, keeping approval separate from implementation/verification. Purpose, scope, approach, usage, effects, and choices use a concise professional explanation followed by a plain-language restatement. The product page includes a UI wireframe and a Mermaid sequence diagram. New compatibility findings update the same pages and corresponding records; material product-scope changes require review. Human readers need not inspect internal execution checklists.

## Verification Plan

Environment verification covers dependency integrity, React/SWC/Vite/Electron execution, Pydantic/httpx mocks, synthetic MD/DOCX/PDF parsing, PDFium rendering, SQLite FTS5/vector loading, disposable Windows credentials, checked local OCR models and offline CPU Chinese/English recognition. GitHub PowerShell endpoints returned 200; Node direct github.com timed out while the official API asset path worked. Install-Electron.ps1 downloads from the official release API and checks the npm package's SHA-256 before extraction. Model copies are checked against the pinned RapidOCR model metadata. No global runtime upgrade or permanent system environment change is required. No product AC is established by these checks.

Future authorized verification combines deterministic domain tests, controlled provider responses, licensed/deidentified document fixtures, interactive citation checks, failure injection, owned-process shutdown inspection, and a clean Windows packaged-app run. Validate binary extension loading, parser/model resource delivery and licenses before dependency lock-in. Record exact commands/results only when actually performed in verification.md.

## test0.01 Implemented Design

- `apps/desktop/main/worker.ts` owns one UTF-8 JSON-lines Python process tree, readiness/pending requests, failure rejection, cancellation and 2.5-second graceful shutdown before owned-tree termination. Windows venv uses a launcher plus runtime; suspended-tree fault injection verified forced cleanup.
- `apps/desktop/main/index.ts` owns singleton startup, sandboxed windows, sender/frame validation, IPC operation allowlist and file picker. `preload/index.ts` exposes typed bounded operations and Electron file-path extraction without Node access in the renderer.
- `renderer/src/main.tsx` provides the full local desktop navigation, note CRUD, attachment status, path/picker/drop inputs, scope, safe text/citation display, API settings and unknown/currency-aware usage. Source HTML is rendered as text; a Markdown visual renderer is not implemented.
- `services/knowledge-agent/store.py` owns SQLite schema 1, canonical notes, local use dates/timezones, providers, attempts and admitted sources. Search is bounded Chinese-bigram/English lexical ranking over the latest 5000 notes, returning at most 200. No semantic vectors or concept-level similarity are advertised.
- `parsers.py` parses copied session snapshots, not mutable original paths. MD/TXT preserve text positions, DOCX preserves body/table sequence and PDF pages preserve locators; limits/warnings describe omitted images, scans and structures. Single-file limits: 50MiB, PDF 200 pages and extracted text 2M characters.
- `service.py` handles strict/mixed/knowledge scopes, up to 20 attachments, 28000-character evidence, full-summary rejection on exceeded coverage, retained copies and cleanup, local-first exact reuse, per-query in-flight locks and atomic capture with generation keys. Exact-title/content/query deduplication protects edits; semantic duplicates remain possible.
- `providers.py` isolates Windows Credential Manager entries and explicit Responses/Chat Completions/Anthropic SSE adapters. It checks normal termination, bounds output, validates generated title/content and allowed citation IDs, records every attempt and keeps missing usage unknown. It does not verify factual entailment or model quality. Price snapshots use user-supplied base input/output rates only.
- `tests/` constructs MD, DOCX and mixed text/blank PDF fixtures, protocol and mock-provider data, cancellation, transaction-trigger faults and a disposable Windows credential entry. `scripts/check-desktop.mjs` drives the real isolated Electron application over DevTools and verifies normal and suspended-worker shutdown.
- `VERSION`, package metadata, UI and preload identify test0.01 (npm semver `0.0.1-test.0.01`). README, CHANGELOG, launch scripts, Git attributes and ignores make local review/reproduction possible. The app still requires the development runtime; no installer or remote push was performed.

Official Responses and Chat Completions schema pages were fetched on 2026-10-20 from developers.openai.com before adapter implementation. Anthropic and third-party real wire compatibility remain unverified beyond the explicit mock adapters. No model ID or current price is hardcoded or claimed tested.
