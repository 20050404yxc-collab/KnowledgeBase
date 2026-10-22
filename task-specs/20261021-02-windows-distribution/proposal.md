# Task: Windows 0.1 distribution and manual upgrades

- ID: 20261021-02-windows-distribution
- Status: implementing
- Workflow mode: execute
- Plan revision: 2
- Approval status: approved
- Approved revision: 2
- Approval basis: User selected no automatic updates, manual upgrades through future releases, and confirmation of installation and storage locations before installation. The user then instructed “开始” after the complete R1 plan and document link were displayed; this authorizes implementation of that plan under developer autonomy instructions. No external publication is included.
- Updated: 2026-10-22, Asia/Shanghai
- Docs language: Chinese
- Task-specs language: English
- Human documentation: [installation and release](../../docs/确认页/个人知识库/安装与发布.md)
- Related tasks: 20261020-01-personal-knowledge-agent; 20261020-02-project-engineering-standard; 20261021-01-diagnostics
- Plan routing: new-linked
- Routing basis: Searched the confirmation overview, installation/release/storage documentation and existing task proposals/designs. The broad v1 task mentions future packaging, but its current product revisions explicitly exclude release; diagnostics and engineering tasks also exclude release. This is the distinct first distributable installer objective, linked to those effective baselines without reopening their business revisions. No dedicated installer plan or packaging configuration was found.

## Intent and Scope

Deliver the existing Windows desktop product as a complete EXE installer with explicit location confirmation and subsequent manual upgrades preserving user state. Display 0.1, use SemVer 0.1.0. Include Python runtime packaging, packaged host startup, install-time data selection, stable discovery, upgrade/repair/uninstall behavior, release records and verification. No updater, new business capabilities, new schema, paid calls, production-data operations, external publication or automatic signing purchase.

## Approach

Use pinned electron-builder/NSIS with custom pages and a PyInstaller directory payload. Separate binaries, selected business data and fixed per-user path discovery/profile state. Show effective absolute paths before committing installation. Keep the same app/install/credential identity on future releases; reuse and redisplay existing paths. Reject relocation during upgrade for this first implementation.

## Acceptance Criteria

AC-01 self-contained offline installer; AC-02 pre-install path confirmation; AC-03 consistent validated storage discovery; AC-04 manual upgrade and compatibility; AC-05 uninstall/reinstall retention; AC-06 honest verification and release metadata. See specs.md for behavioral requirements and scenarios.

## Standards

- Active: root AGENTS.md and user-provided read/verification constraints.
- Active authority: docs/确认页/工程规范/项目编码与分层规范.md, revision 2; read 2026-10-21. Applies to touched source, scripts, packaging, lifecycle, security, docs, dependencies and version maintenance. No exception requested.
- General-engineering SKILL.md, confirmation-maintenance.md, task-workflow.md and standards-index.md consulted. The skill index supplies no extra language standard. The project authority remains in place, not copied to global skills.
- Preserve current business/protocol/schema and stable credential service KnowledgeBase.test0.01; defaults continue the current KnowledgeBase user-data identity. User-selected custom data roots are an explicit addition, not a version-driven relocation.
- Required implementation checks: npm run check; npm run test:ui; packaged behavior and clean-machine install/upgrade/uninstall verification. Existing product test results are not installer evidence.

## Decisions and Limits

Confirmed requirements: first 0.1 formal release; EXE delivery; no automatic updates; future manual upgrades; all meaningful program/data locations shown before installation.

Proposed details for review: per-user installation; one selectable local business data root; subordinate paths derived and displayed; profile/path-discovery state and Windows credentials remain in system-managed per-user locations; no upgrade relocation; no downgrade; same-version repair; uninstall retains data and credentials. Target Windows 11 x64/16GB is the existing acceptance baseline, not a measured minimum. Signing, final package size, license audit and clean-machine availability remain unverified. Migration to another data location is a separate scope.

## Plan Changes

R1 records the user's added path-confirmation and manual-upgrade requirements in the full initial installer plan. No earlier approved installer revision exists. Product files, version and dependencies remain unchanged this turn.

## R2: Correct path validation and reduce unnecessary rejection

Authorization: On 2026-10-22 the user instructed “按推荐来” after the concrete recommendation to fix new-directory false rejection, simplify restrictions, and retain deletion/database/access protections. This authorizes implementation and verification of this identified correction under the developer autonomy instructions; no new confirmation is needed. R1 delivery work already present in the workspace is preserved.

Scope: installer/paths.nsh, native installer regression harness, storage-location regression tests, related records/page/navigation, and regenerated local installer/checksum. Replace existence-dependent normalization, preserve first failure, remove arbitrary 220-character rejection, allow unrelated ordinary files in the data root while protecting conflicting managed names. Retain program isolation, fixed local disks, link protection, existing-library safeguards and access checks. No schema, credential, version or publication change.

## Release publication authorization — 2026-10-22

The user explicitly instructed “上传git，然后这个安装包放到GitHub的release中”. This authorizes committing/pushing the existing distribution changes to origin/main and publishing the exact existing EXE plus checksum as GitHub Release v0.1.0. It supersedes the earlier no-publication scope only for this repository/release; repository visibility remains unchanged (private). The existing credential helper may be used without printing secrets.

Before committing, isolate the fixed-clock diagnostics test from the fixture's real-date log directory, update README/install records, run mandatory check and reuse valid desktop evidence unless desktop/product code changes. This test-only correction does not alter the EXE. No production install, API usage or code signing change.
