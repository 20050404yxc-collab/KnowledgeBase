# Documentation Design

## Current State and Evidence

README and package.json establish the Electron/React/TypeScript/Python/SQLite stack. electron.vite.config.ts defines three desktop entries; tsconfig.json enables strict checking. contracts/desktop.ts has a generic request API. main/index.ts and main/worker.ts implement trusted IPC and worker lifecycle. worker.py dispatches JSON Lines to KnowledgeService; service.py directly accesses store.db. renderer/src/main.tsx combines several pages and interactions.

These are targeted static observations, not a conformance audit. Additional review found bucket_for in store.py is pure domain logic, while providers.py mixes protocol, credentials, configuration orchestration, accounting SQL and answer validation. Existing product verification remains historical.

## Approach

Maintain one effective standard under docs/确认页/工程规范/ and add a root AGENTS.md binding future work. Replace the initial three-layer mapping with React/Electron/Python boundaries, Python entrypoints/application/domain/infrastructure, application-owned ports and bootstrap composition; frontend uses app/features/shared. Preserve current launch roots. Retain language-specific comments and naming, detailed stage/branch explanations and the 80-effective-line rule.

No architecture interfaces, schemas, migrations, formatters or dependencies are implemented. Synchronize test0.02 public literals in VERSION, package.json/lock, Electron main/preload/UI, Python worker/service and desktop-test report. Leave providers.py SERVICE unchanged to retain secrets. npm uses valid SemVer 0.0.1-test.0.2. Exact refactoring batches remain later work.

## File Changes

- New: effective standard and root AGENTS.md.
- Modified: overview, README and CHANGELOG for effective rules and release scope.
- Modified version literals only: VERSION, package.json, package-lock.json, apps/desktop/main/index.ts, apps/desktop/preload/index.ts, apps/desktop/renderer/src/main.tsx, services/knowledge-agent/worker.py, services/knowledge-agent/service.py, scripts/check-desktop.mjs.
- New/updated: this task's proposal/specs/design/tasks/verification records.
- Unchanged: existing product task, source standards, credential adapter identity, data, dependencies and global skills.

## Verification Plan

Check AC-01/02 against sources and targeted evidence; check links, fences and changed-file scope for AC-03. Verify version strings, lockfile dependency preservation and credential identity for AC-04, run TypeScript checking, existing Python tests, Ruff and build; run isolated desktop checks after build because visible/runtime versions changed. Verify remote refs after publishing. Record actual evidence, not assumed success.
