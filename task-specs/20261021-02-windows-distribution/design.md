# Implementation Design

## Current State and Evidence

- package.json uses electron-vite build/preview and version 0.0.1-test.0.3; no installer dependency/configuration was found.
- apps/desktop/main/index.ts sets app name KnowledgeBase, uses KB_DATA_DIR or app.getPath('userData'), and constructs WorkerBridge from the development root.
- worker_bridge.ts launches .venv/Scripts/python.exe and services/knowledge-agent/worker.py with --data-dir. Packaged startup must replace this resource assumption while preserving JSON Lines and lifecycle behavior.
- storage_settings.ts exposes the effective data root, knowledge.sqlite3, sources and logs via restricted IPC. FileSnapshots adds sessions under the root; schema recovery points are also data-owned.
- secret_vault.py explicitly uses WinVaultKeyring and stable service KnowledgeBase.test0.01.
- Existing broad technical design anticipates bundled Python and system-user-data defaults; the current product revisions exclude release. This separate installer plan extends delivery only.

## Technical Approach and Ownership

Use pinned electron-builder/NSIS and a custom include/script for first-install directory selection and final review. Use PyInstaller directory output for the minimal actual Python backend dependencies, including Windows credential backend and parser resources. Resolve packaged worker through Electron resourcesPath outside asar; development keeps its existing entry. Verify dynamic dependencies and subprocess-tree ownership rather than assume freezing preserves them.

Use a stable per-user installation identity and locator under the existing KnowledgeBase system application-data identity. Default binaries use LOCALAPPDATA/Programs/KnowledgeBase; default business data continues APPDATA/KnowledgeBase. Custom business roots do not relocate the locator or Electron profile/cache. The wizard expands all values to absolute paths and derives database/sources/logs/sessions/recovery locations from one root. API credentials remain Windows-owned. Document Windows/installer temporary storage separately; do not promise total file placement control.

Resolve and validate paths before any diagnostics/backend initialization, then pass one resolved business root to all consumers. Explicit development/test mode keeps KB_DATA_DIR isolation; ordinary installed startup must not let an inherited environment silently override the persisted choice. Invalid/missing recorded targets block silent fallback. A recognized existing default legacy library must be redisplayed and confirmed. Do not inspect production database content as part of planning/testing.

The installer owns deployment and location recording, not knowledge SQL or migrations. It checks access/space, disallows overlapping binary/business roots and unsuitable directories, requests ordinary shutdown, commits the locator only after successful deployment and reports errors safely. Existing app migrations remain app-owned with their current recovery behavior. No new schema or business protocol is planned.

For upgrades, redisplay both previous locations and version transition; no relocation in this first upgrade workflow. Stable identity detects upgrades; reject downgrade and permit same-version binary repair. Uninstall removes only managed binaries/shortcuts/registration and retains locator, profile, data and credentials. Never recursively delete a selected user data root or original import sources.

## Planned File Groups

- package.json and package-lock.json: pinned packaging dependency and scripts; later version synchronization.
- New installer/build configuration under a dedicated build/installer source directory and scripts/: NSIS pages, payload selection, freeze recipe, deterministic staging and checksum generation. Final filenames follow repository standards; no build artifacts committed.
- apps/desktop/main/index.ts, worker_bridge.ts and a dedicated storage/location resolver: installed resources, early path resolution, diagnostic/session/lifecycle continuity.
- storage_settings.ts and affected settings presentation only if needed to expose the same effective paths and concise system-storage explanation; restricted IPC remains intact.
- VERSION, public TS/Python version declarations and current release/readme guidance: synchronize new release without replacing historical evidence or identities.
- Tests: actual path failure/security/lifecycle risks, upgrade/retention and packaged smoke checks with isolated fixtures and test-only credentials.
- Human docs: this installation page and overview now; reconcile actual README/technical current-behavior guidance during implementation. Existing text is a current description of development behavior, not a code mismatch.

## Verification Plan

AC-01: frozen-worker protocol/local parser tests and packaged desktop smoke in isolated profiles, then clean Windows offline install without runtimes.
AC-02/03: Chinese/space paths, alternate disk, overlap, permissions, unavailable location, cancel, corrupt locator, inherited environment, legacy-data recognition and effective path consistency. Trace safe failure diagnostics without private paths/body contents.
AC-04/05: synthetic old installation/data plus test credential; newer overwrite, same-version repair, older rejection, active-instance handling, failure state, uninstall/reinstall retention and original-file hashes. Never exercise against the user's live knowledge.
AC-06: npm run check, npm run test:ui, artifact manifest, version references, SHA-256 and license notices; exclude secrets/dev packages. Record signature state and actual Windows prompts. Inspect clean-machine evidence separately; local packaged execution does not substitute for it. No paid providers or production credentials.

Risks: NSIS custom-page persistence, early path resolution before logging, Electron/Python resource paths, Windows keyring hidden imports, uninstall ownership, interrupted upgrade and misleading empty-data fallback. Size, clean-machine availability, distribution licenses and SmartScreen results remain unverified.

## R2 correction

Cause reproduced in a compiled isolated NSIS fixture: NSIS GetFullPathName returns an empty value and error for missing targets; KBLocationLeave ignored that error and later overlap logic overwrote the message. Existing harness only called KBValidatePath with an existing folder.

Normalize lexically using Win32 GetFullPathNameW (checked result and buffer length), then validate ancestors without creating targets. KBValidateLocations owns the full ordered check and early returns; KBLocationLeave reads controls and delegates. Retain directory/reparse/access checks and unchanged persisted locator format. Remove 220 limit and broad nonempty-data check; permit ordinary root files but reject unrecognized reserved-name takeover and invalid managed child types/links. Runtime behavior remains compatible and receives regression tests.

Verification extends native NSIS tests to hidden edit controls and actual page-leave calls, missing nested/Chinese/space paths, dot segments, roots, prefix siblings, overlap, links, conflicts, write probing, and locator/data retention. Rebuild the local installer only after project/UI checks. Clean-machine acceptance and actual removable/network/very-long payload paths remain outside verified scope.
