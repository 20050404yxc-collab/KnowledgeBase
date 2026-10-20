# Verification Record

## Revision 2 Historical Environment and Scope

2026-10-20; Windows PowerShell; workspace `D:/code/KnowledgeBase`. Revision 1 was documentation-only. Revision 2 adopts the user-selected architecture and development rules and changes release version literals; no business logic, dependencies or data changes.

| AC / standard | Method | Result | Evidence / limitation |
|---|---|---|---|
| AC-01 | Revision-1 complete source reading and SHA256, unchanged source scope | passed | Fingerprints recorded in proposal; no original source edits |
| AC-02/03 | Revision-2 architecture/AGENTS review, Python link/fence check and git diff --check | passed | Ten affected Markdown files checked with no broken links or unbalanced fences; root rules preserve supplied reading instructions |
| AC-04 | Python comparisons to HEAD of source literals, package lock and credentials adapter | passed | Six source/test files differ only by test0.01 → test0.02; dependencies unchanged; original credential service retained; package/lock/VERSION agree |
| AC-04 | npm.cmd run typecheck; npm.cmd run build | passed | Strict TypeScript check and all three production bundles built |
| AC-04 | .venv/Scripts/python.exe -m pytest tests -q | passed | 37 passed in 2.23 seconds |
| AC-04 | .venv/Scripts/python.exe -m ruff check services/knowledge-agent tests | passed | All checks passed |
| AC-04 | npm.cmd run test:ui | failed: environment collision | Existing user Electron instance uses the same profile/single-instance lock; test timed out discovering a debug target. User instance was preserved |
| AC-04 | node artifacts/test0.02/check-desktop-isolated.mjs | passed | Same desktop test body and production bundle, launched through an ignored wrapper setting a separate Electron profile inside temporary KB_DATA_DIR; 11 checks passed, including edit/search/attachments/restart and normal/forced worker shutdown. Report: artifacts/test0.02/desktop-check.json |
| AC-04 | git commit; git tag -a test0.02; git push --atomic origin main refs/tags/test0.02; git ls-remote | passed | Release commit 82c412bcd58f1828834550a79edb0b93e77cd143 uploaded; remote main and peeled test0.02 both matched. Annotated tag object: 4dfe81a32ee0335188a9057d966bf721251b3b9f. This verified completion record is a later documentation-only commit; the release tag remains on the release commit |

## Documentation Review

Chinese page states effective revision-2 approval, purpose, scope, how, effect, usage and limits. Root AGENTS.md preserves the original reading/verification rules and binds future development to the standard. Sequence diagram describes normative cancellation/commit order, not a completed architecture migration. No UI redesign or diagram-rendering claim is made.

## Revision 2 Historical Unverified Items

Full architecture conformance, real-provider behavior, performance, migrations and packaging remain unverified. Standard desktop command requires the regular app to be closed or profile isolation; the ignored wrapper supplied isolation without changing tracked product/test logic. Generated validation artifacts are ignored and not published. User adoption/publish authorization is explicit; full architecture migration has not been performed.


## Revision 3 — Actual normalization / test0.03

Date: 2026-10-20. Windows PowerShell, D:/code/KnowledgeBase, main based on b73b239. User explicitly authorized applying the standard and committing code. Verification uses existing project .venv/node_modules, synthetic documents, fake credentials, HTTP mocks and independent Electron profile/data; no user app was stopped and no real provider was called.

| AC / standard | Actual method | Result / scope |
|---|---|---|
| AC-05/08 | npm.cmd run check:standards | passed: 63 TS/JS files; 37 Python files. Headers, names, <=80 effective lines and selected dependency boundaries; Python function contracts/return annotations; TS branch braces. Semantic/comment quality still requires review |
| AC-08 | npm.cmd run format:check; npm.cmd run lint:python | passed: Prettier; Ruff imports/syntax and format for services/tests/scripts |
| AC-05/06/08 | npm.cmd run typecheck | passed: strict TS, noUnusedLocals, noUnusedParameters |
| AC-05/06/07 | npm.cmd test | passed: 47 tests, final run 5.73s. Existing behavior plus shared protocol samples, malformed frames, cancelled parsing/commit/waiters, credential compensation and simultaneous primary/cleanup/accounting failures |
| AC-06/07 | npm.cmd run test:host | passed: 5 tests. Shared protocol, malformed DTOs, timeout/late result, duplicate ID/committed result and worker-exit/retry lifecycle |
| AC-05/08 | npm.cmd run build | passed: main, preload and renderer production bundles; repeated only after final preload validation change |
| AC-05/07 | npm.cmd run test:ui | passed: built app, 11 checks. Note edit/safe text, Chinese search, attachment/offline evidence/citation/retain, sources/providers, persistence/restart, no offline API attempts, normal and 2.5s forced shutdown of owned workers. Ignored report/screenshots under artifacts/test0.03; final rebuild/regression rerun after last boundary changes |
| AC-08 | PowerShell Language.Parser for three renamed .ps1 scripts; node --check for maintenance .mjs; py_compile for environment/OCR helpers | passed syntax; install/download/preparation scripts intentionally not executed |
| AC-09 | Compare original lock entries, actual executescript SQL constants, credential SERVICE and metadata | passed: existing lock entries unchanged; sole added package prettier@3.6.2. SQL schema identical after whitespace normalization, user_version=1. SERVICE remains KnowledgeBase.test0.01; VERSION/package/lock report test0.03 / 0.0.1-test.0.3 |
| AC-09 | git fetch origin; compare main baseline | passed: origin/main aligned before publication; no force push or old tag replacement permitted |

Chinese docs reconciled: standard status/current paths, migration explanation, AGENTS, README/CHANGELOG, environment script names/tooling and overview-owned navigation. Existing pending API/model plan changes in product/technical docs and the product task remain excluded. Mixed overview changes are staged from HEAD plus only this task's hunks.

### Revision 3 limits

Static rules cannot prove every branch's semantics, comment accuracy, effects or resource ownership. The tests cover specified regression/failure paths, not exhaustive faults. Real provider credentials/paid calls, complex document quality/OCR, runtime performance, clean-machine install/packaging and the pending API/model increment are unverified. No schema migration or production-data exercise occurred. The simpler documentation-only adoption remains available in test0.02 but did not satisfy this request to normalize actual code.

### Revision 3 publication

Staged review passed for 13 Markdown files (links/fences), excluded user plans, artifacts and credential patterns; git diff --cached --check passed. Actual release commit: 9385b8aab55429a597952cf6317874ae5ef01c37. Annotated tag object: 9fc71e19b2e584e54509fc6198ff7700554e5681. git push --atomic origin main refs/tags/test0.03 succeeded; git ls-remote confirmed both remote main and peeled test0.03 matched the release commit. Existing test0.01/test0.02 tags were not changed. A documentation-only completion commit records these results and does not move the release tag. Final desktop rerun after the last preload change also passed all 11 checks.
