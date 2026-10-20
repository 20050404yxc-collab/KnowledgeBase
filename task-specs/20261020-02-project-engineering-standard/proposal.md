# Task: Adopt project standard, normalize existing code and publish test0.03

- ID: 20261020-02-project-engineering-standard
- Status: completed revision 3 (revision 2 completed)
- Workflow mode: execute
- Plan revision: 3
- Approval status: approved
- Approved revision: 3
- Approval basis: Architecture adoption and publication were approved in revision 2. The follow-ups “进行规范” and “规范完提交代码” explicitly authorize applying that standard to existing code and committing it. The earlier Git upload/version iteration authorization remains effective for this continuation.
- Updated: 2026-10-20
- Docs language: Chinese
- Task-specs language: English
- Human documentation: [Project standard](../../docs/确认页/工程规范/项目编码与分层规范.md), [existing-code normalization](../../docs/确认页/工程规范/存量代码整改.md)
- Related tasks: [Existing product development](../20261020-01-personal-knowledge-agent/proposal.md)
- Plan routing: new-linked
- Routing basis: Targeted search found product/environment plans but no engineering-standard topic. This is a distinct documentation deliverable, not a revision of product behavior or historical test evidence.

## Intent and Scope

Revision 3 is explicitly authorized by the user's follow-up “进行规范” and “规范完提交代码”. Implement actual normalization of existing owned code, with process boundaries, backend ports and four layers, frontend features, validated transport, source conventions and risk-specific regression. Preserve schema, wire names, credentials identity, user data paths and supported UI behavior. Update maintenance scripts and tests where required by moves and conventions. Publish test0.03 after verification. Existing uncommitted product/model-selection planning documents are preserved and excluded from this implementation commit.

Revision 2 delivered standard adoption, root AGENTS.md, Chinese navigation and test0.02 publication. Its original version-only acceptance and evidence remain historical; they do not establish revision-3 conformance.

Revision 3 includes application ports, feature modules, runtime protocol validation, source conventions, formatter configuration and narrow architectural checks. Add pinned Prettier 3.6.2 as a development formatter; do not upgrade existing dependencies. Schema/data migration, API/model-selection features from the separate pending product plan, OCR and packaging are excluded. Credential identity stays KnowledgeBase.test0.01.

## Approach and Acceptance

Apply the effective rules to the supported code while preserving behavior and launch roots. AC-01–04 retain adoption/publication history; AC-05–09 cover actual layering, contracts, lifecycle, conventions and test0.03 delivery. Tests use synthetic files, in-memory credentials and mocked HTTP with isolated profiles/data. Do not stop for approval already supplied.

## Standards and Provenance

| ID | Source | Read date / fingerprint | Applicability and status |
|---|---|---|---|
| SRC-CPP | `D:/code/temp/cpp-coding-standard.md` | 2026-10-20; SHA256 `88AB56BAA546A3A8159D05D215B8484BDC5D5D355B22AAB68ACC19A621D3E0FA` | User-designated source, read completely; translate applicable principles, explicitly adapt language syntax |
| SRC-PRI | `D:/code/temp/工程分层pri规范.md` | 2026-10-20; SHA256 `1E05F0093E8BA2445435BEF66511A2ACC8C70B4FEEDEFC0DD0F22DCED0590723` | User-designated source, read completely; adapt responsibilities/dependencies, qmake files inapplicable |
| USER-READ | AGENTS instructions supplied in chat | 2026-10-20 | Active targeted-reading, chain-tracing and evidence rules |
| WORKFLOW | Installed general-engineering skill and task-workflow, confirmation-maintenance, standards-index references | 2026-10-20 | Active documentation workflow; no bundled language standard |
| PROJECT-01 | Human standard linked above | Revision 2, adopted by explicit user selection | Mandatory project-only standard; no global skill installation changes |

The new supplied standards supersede the earlier no-additional-standards choice for this new objective. Historical product approvals and verification are not rewritten. The Qt/C++ skill was initially inspected, then replaced with general-engineering after inspection established no Qt/C++ project. No source standard is edited, retired, or globally registered.

## Decisions and Revision History

- Revision 1 was a generated draft using a global three-layer mapping; no adoption was inferred.
- User challenged that mapping. Static review of providers.py and store.py supported separating domain rules, application orchestration and technical adapters.
- Revision 2 follows the user's explicit selection of the displayed recommendation and requirement that future development comply. User then explicitly authorized Git upload/version iteration.
- Keep current technology/launch roots and preserve credential identity. Version-only historical edits have a narrow documented exception from whole-function comment/size remediation; no logic changes are covered by that exception.
- Origin is https://github.com/20050404yxc-collab/KnowledgeBase.git. Fetch confirmed local main and origin/main aligned before changes. Release commit 82c412bcd58f1828834550a79edb0b93e77cd143 and its new annotated test0.02 tag were pushed atomically without force; remote main and peeled tag matched that release commit. A subsequent documentation-only commit records this verified publication, leaving the release tag unchanged.
- Revision 3: the user explicitly requested normalization and a code commit. Implement the already selected architecture, source conventions and affected tests/scripts; publish test0.03. New evidence supersedes only affected implementation claims.
- Pre-existing changes in product/technical pages and all five files under task-specs/20261020-01-personal-knowledge-agent belong to the separate pending API/model plan. Preserve and exclude them. The overview contains mixed changes; stage only this task's navigation/version hunks. The environment page's script-name and formatter updates belong to this refactor.

- Revision-3 release 9385b8aab55429a597952cf6317874ae5ef01c37 and annotated test0.03 (object 9fc71e19b2e584e54509fc6198ff7700554e5681) were pushed atomically; remote main and peeled tag matched. A documentation-only completion commit follows without moving the release tag.
