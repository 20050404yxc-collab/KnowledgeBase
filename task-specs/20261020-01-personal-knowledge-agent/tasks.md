# Execution Tasks

Read [proposal](proposal.md), [specs](specs.md), [design](design.md), and [evidence](verification.md). Environment preparation is authorized; product feature implementation and full revision-2 approval remain pending.

## 0. Documentation and decisions

- [x] 0.1 Inspect local documentation/task locations before creating the first record; evidence: workspace discovery in verification.md.
- [x] 0.2 Consolidate confirmed decisions and pending assumptions into Chinese confirmation pages and English task records; evidence: the linked revision-1 artifacts.
- [x] 0.3 Verify links, artifact structure, AC/scenario coverage, and documentation consistency; evidence: nine Markdown artifacts, 18 resolved local links, 19 requirements with 30 scenarios and full task/evidence coverage; see verification.md.
- [x] 0.4 Record the user's confirmed frequency A, mainstream-model direction, local paths and Windows baseline; preserve the distinction between selected decisions and full-plan approval.
- [x] 0.5 Research existing open-source OCR as requested; evidence: official RapidOCR/PaddleOCR/Docling/OCRmyPDF source review recorded in the Chinese technical page. No runtime or final-library approval inferred.
- [x] 0.6 Update the same nine documentation artifacts to revision 2 for the latest user request; preserve candidate/confirmed status and approval scope.
- [x] 0.7 Recheck changed revision-2 links, AC mappings, consistency and statuses; evidence: nine Markdown files, 19 resolved local links, 19 ACs, 30 scenarios and full task coverage, zero static-check issues; see verification.md.
- [ ] 0.8 Review full revision 2 and resolve remaining provider configuration, OCR/DOC delivery and sample/measurement details; do not infer implementation permission from discussion decisions.

## 1. Compatibility and packaged technical validation

- [ ] 1.1 Retain confirmed Windows 11 x64 / 16GB / no-dedicated-GPU, frequency A and local paths; resolve actual official/proxy protocols for GPT/DeepSeek/Claude/Grok, sample documents, concrete test machine and OCR/DOC launch policy; AC-03–06, AC-11–13, AC-18.
- [ ] 1.2 Create an authorized desktop/worker/protocol skeleton under `apps/desktop/`, `services/knowledge-agent/`, and `contracts/`; demonstrate ready/stream/error/cancel/shutdown; AC-01, AC-15, AC-17.
- [ ] 1.3 Evaluate and lock parser candidates with MD/DOCX/text-PDF Chinese fixtures, page/block locators and partial scans; prioritize RapidOCR + ONNX Runtime CPU evaluation, assess Docling if layout fixtures need it, measure dependency/model preparation, cold/warm latency, memory and license provenance; resolve OCR/DOC gate explicitly; AC-04–06, AC-18.
- [ ] 1.4 Validate provider streaming, capability testing, credential access and returned usage with actual selected protocol; AC-12–13, AC-17.
- [ ] 1.5 Package an early Windows application with the Python runtime and validate the minimal file/question/citation/save flow on the confirmed clean target; record binary-extension/dependency evidence; AC-01, AC-05, AC-08, AC-18–19.

## 2. Documents and sources

- [ ] 2.1 Implement equivalent attachment entry points and visible per-file job states; AC-03–04, AC-15.
- [ ] 2.2 Implement scope handling, focused retrieval, coverage-aware summaries, multi-file citations and conflicting-evidence presentation; AC-05–06.
- [ ] 2.3 Implement temporary sessions, explicit source admission, evidence excerpts, source deletion and failure-safe managed-file cleanup; AC-07, AC-16, AC-19.

## 3. Knowledge and related learning

- [ ] 3.1 Implement persistent knowledge and Chinese keyword retrieval with optional versioned semantic indexing and disclosed fallback; AC-02, AC-14, AC-19.
- [ ] 3.2 Implement complete-content capture, provenance, duplicate handling and protection of user edits; AC-08, AC-16, AC-19.
- [ ] 3.3 Implement relevant three-card assembly for all inventory cases, expansion on selection, in-flight deduplication and error recovery; AC-09–10, AC-15.

## 4. Frequency and API management

- [ ] 4.1 Implement confirmed usage-event policy, time-controlled bucket calculation and manual overrides; AC-11.
- [ ] 4.2 Implement multi-configuration selection, capability tests, credential storage and offline/degraded UI; AC-12, AC-14, AC-17.
- [ ] 4.3 Implement per-attempt accounting, missing-usage handling, price snapshots and currency-safe summaries; AC-13.

## 5. Integration, documentation, and acceptance

- [ ] 5.1 Verify cancellation/commit boundaries, crash recovery, shutdown and duplicate suppression under faults; AC-08, AC-10, AC-15, AC-19.
- [ ] 5.2 Verify maintenance actions, index invalidation/rebuild and durable-data behavior without modifying user originals; AC-07, AC-16, AC-19.
- [ ] 5.3 Run complete accepted fixture/provider/UI/clean-Windows checks; record actual environment and evidence for AC-01–19.
- [ ] 5.4 Reconcile the same Chinese pages with implemented support, known limits, install prerequisites and troubleshooting; verify status and all relevant links; AC-01–19.
- [ ] 5.5 Deliver the agreed installer and evidence only after required checks pass; leave unverified scope incomplete; AC-18 and final acceptance.

## Handoff

- Selected workflow mode, current plan revision, and approval basis: environment preparation authorized and completed for the explicitly confirmed locations; product revision 2 remains pending.
- Current step and actual progress: Python and Node/Electron dependencies installed and locked, OCR resources prepared/hashed, synthetic environment checks passed, environment documentation reconciled. All product ACs remain not run.
- Last observed workspace state: environment manifests/locks/scripts/receipts plus project `.venv` and `node_modules`; models at `D:/dev-models/KnowledgeBase/rapidocr`, caches at `D:/dev-tools/cache`. No product code, installer or model API call. Workspace has no Git repository metadata; Git was reused but `git init` was not requested or performed.
- Required input: actual provider endpoints/protocols/model IDs/embedding availability, OCR/DOC launch policy and resource delivery, representative files/concrete machine and measured limits. Frequency A, local paths and Windows baseline are confirmed and must not be re-asked.
- Next action: review the three Chinese topic pages and resolve material pending choices. Subsequent implementation requires user authorization and resolution of decisions affecting that work.
- Unverified work: all product ACs, complete redistribution license audit, representative parsing/OCR quality, provider protocols, Chinese retrieval, product lifecycle, runtime resource limits, packaging and clean-machine operation. Base SQLite extension loading and local CPU OCR smoke checks have passed.

## Environment Preparation (authorized 2026-10-20)

- [x] E.1 Inspect existing tools/platform and confirm installation locations before mutations.
- [x] E.2 Install isolated Python and Node/Electron candidate dependencies; retain exact versions and dependency locks; ENV-01/02.
- [x] E.3 Verify CLI/imports, basic document parsing, SQLite extension and CPU OCR runtime/model readiness; record actual limitations; ENV-02.
- [x] E.4 Reconcile Chinese environment instructions and these execution records; do not claim product ACs passed.
