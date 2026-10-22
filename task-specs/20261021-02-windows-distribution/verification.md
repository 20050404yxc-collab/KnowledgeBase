# Verification Record

## Environment and Scope

Planning inspection on Windows PowerShell in D:/code/KnowledgeBase, 2026-10-21 Asia/Shanghai. Read-only source checks and documentation writes only. No build, provider, credential or user database operation.

| AC / standard | Method | Result | Limitation |
|---|---|---|---|
| Current-state evidence | Read package.json, host startup, worker launch, restricted storage IPC, snapshots and credential adapter | inspected | Confirms development assumptions only |
| Plan routing | Search confirmation docs and all three existing task groups; inspect broad product proposal/design | inspected | Existing product work excludes release; delivery is linked separately |
| R1 documentation | Resolve relative Markdown links in all six new plan/record files; git diff --check; scope review | passed | Paths exist; tracked diff has no whitespace errors. Only documentation changed; installer behavior remains unverified |
| AC-01–06 | Build, automated behavior, packaged execution and clean Windows install/upgrade/uninstall | not run | Implementation has not started |

## Unverified Items

Installer pages, actual destinations, deployment atomicity, frozen backend dependencies, Windows runtime compatibility, test credentials, existing-data retention, package size, license audit, signatures, SmartScreen and real-provider behavior have no evidence yet. Prior project test passes are not evidence for this planned installer.

## R2 Path Correction — 2026-10-22

Scope: preserve the existing dirty R1 workspace, correct installer path validation, reduce rejection of ordinary data-root contents, and regenerate the local candidate. No production installation, registry modification, real database operation, credential access or paid API call.

Cause: a compiled diagnostic fixture reproduced empty results from NSIS GetFullPathName for nonexistent targets, then false overlap reporting. The replacement uses checked Win32 lexical normalization, expands existing prefixes (including short names), handles drive roots explicitly, and preserves the first error. Ancestor checks capture Win32 errors with System::Call ?e rather than a separate GetLastError call.

| AC / scope | Command or method | Result | Evidence / limitation |
|---|---|---|---|
| AC-02/03/05 native installer paths | node scripts/check_installer.mjs | passed | 28 ordered location scenarios, short-name overlap, actual page-leave via hidden native EDIT controls, writable-parent probe and locator/ordinary-file/database retention. Latest fixture: system TEMP/kb-installer-zipIck. Includes actual C:/D: selection, Chinese/space/new/nested/root-adjacent paths, >220 path, dot/trailing-dot/case aliases, prefix siblings, overlap, links, conflicts and missing original DB. Validation creates no destination directories. |
| Project mandatory aggregate | npm run check | failed (pre-existing test date collision) | Standards, Prettier, Ruff, Python format and TypeScript passed. Python: 272 passed, 1 failed; chain stops before host/build. tests/test_diagnostics.py::test_each_worker_start_creates_a_new_dated_log expects 2026-10-22-1-worker.log, but diagnostic_session already created that date's first file using the real date; actual is sequence 2. Fixture uses real clock before monkeypatching. No diagnostic product/test changes made in this installer scope. |
| AC-03 installed storage and host contracts | npm run test:host | passed | 27 tests; adds ordinary file/prefix sibling/long data-root regression; retains locator, missing-DB, override and link rejection coverage. |
| Production bundles | npm run build | passed | Desktop main/preload/renderer bundles built independently after aggregate stopped. |
| Desktop UI and lifecycle | npm run test:ui | passed | artifacts/0.1/desktop-check.json reports passed; isolated profiles/data and mock providers; no production knowledge or credentials. Does not validate a clean-machine installer. |
| Final changed scripts | node scripts/check_standards.mjs; prettier --check scripts/check_installer.mjs tests/storage_location.test.mjs | passed | 128 TS/JS files checked; latest test edits formatted. NSIS function-size review found no function over 80 effective lines. |
| Documentation and whitespace | Relative-link resolution; git diff --check | passed | Affected topic/overview/task links resolve. Existing line-ending conversion warnings are not whitespace errors. |

Remaining: clean Windows installation, installed-package GUI smoke, upgrade/repair/uninstall/reinstall, ACL-denied destination testing, actual very-long payload compatibility, signatures/SmartScreen and real-provider behavior are not established by this correction. Local candidate remains unsigned. The unrelated date-dependent Python test prevents claiming aggregate check success; no release/publication approval is implied.

### R2 candidate artifact

- Final build: node scripts/build_installer.mjs --prepackaged release/win-unpacked; passed. Log: build/installer-path-fix-build.log. Prepackaged payload came from the preceding successful local desktop packaging; only NSIS rules changed afterward.
- Installer: release/KnowledgeBase-Setup-0.1.0-x64.exe; 130264342 bytes; unsigned.
- SHA-256: cfa4021e63c9a2d0ff30fc31bdff85692ff6519d1c03c5788a79e0010bc1a3dd.
- Source installer/paths.nsh SHA-256: f20e612e06bccd5fabae3dc09cbc737b351d01175aa9c3400011b089fdc06b20.
- node scripts/release_manifest.mjs: passed; checksum and manifest regenerated after the final build. No external publication or production installation performed.

## Publication preparation — 2026-10-22

User explicitly authorized Git push and GitHub Release upload. Repository origin is 20050404yxc-collab/KnowledgeBase (private); no existing GitHub releases or v0.1.0 tag at inspection. No visibility change requested.

The pre-existing fixed-date diagnostics test was corrected by using an isolated nested log directory after the clock patch. Its fixture-created real-date file can no longer influence the expected sequence. Product logging and the candidate EXE are unchanged. README now describes 0.1 installation, manual upgrades, data location, release download, and verification limits.

- npm run check: passed, exit 0. Includes 273 Python tests, 27 host tests, standards/format/Ruff/TypeScript and desktop bundles. Log: build/release-prepush-check.log. This supersedes the earlier aggregate failure without erasing that evidence.
- npm run test:ui: prior R2 pass reused; no desktop product code changes since that run.
- Candidate integrity: local EXE SHA-256 still cfa4021e63c9a2d0ff30fc31bdff85692ff6519d1c03c5788a79e0010bc1a3dd; 130264342 bytes. EXE plus .sha256 are the authorized release assets, not Git source-tree content.
- Clean-machine and provider limitations remain unchanged.

## GitHub publication — 2026-10-22

- Source commit e61b3e1bdcf0d1d3137c0c90bb159cd03ae6d061 pushed to origin/main; annotated tag v0.1.0 pushed and points to that commit. No force push or tag replacement.
- Release 420567195 published at https://github.com/20050404yxc-collab/KnowledgeBase/releases/tag/v0.1.0; draft=false, prerelease=false. Repository visibility remains private; downloads require repository access.
- Uploaded KnowledgeBase-Setup-0.1.0-x64.exe (130264342 bytes) and KnowledgeBase-Setup-0.1.0-x64.exe.sha256 (100 bytes). GitHub-reported sizes and SHA-256 digests match the local assets; EXE digest is cfa4021e63c9a2d0ff30fc31bdff85692ff6519d1c03c5788a79e0010bc1a3dd.
- Assets were verified before publishing the draft. Build outputs and API response records remain ignored local artifacts, not source-tree content. Publication does not establish the unverified installation/provider acceptance listed above.
