# Task: Adopt project engineering standard and publish test0.02

- ID: 20261020-02-project-engineering-standard
- Status: completed
- Workflow mode: execute
- Plan revision: 2
- Approval status: approved
- Approved revision: 2
- Approval basis: User selected the recommended process-boundary/backend-four-layer/frontend-feature architecture and explicitly requested adding the standard as mandatory for future development, then authorized Git upload and a version iteration. Scope is adoption, development instructions, version metadata and publishing, not an architecture migration.
- Updated: 2026-10-20
- Docs language: Chinese
- Task-specs language: English
- Human documentation: [Project standard](../../docs/确认页/工程规范/项目编码与分层规范.md)
- Related tasks: [Existing product development](../20261020-01-personal-knowledge-agent/proposal.md)
- Plan routing: new-linked
- Routing basis: Targeted search found product/environment plans but no engineering-standard topic. This is a distinct documentation deliverable, not a revision of product behavior or historical test evidence.

## Intent and Scope

Adopt the two supplied standards' applicable quality principles with the user-selected architecture. Maintain the Chinese standard and navigation, add a root AGENTS.md, synchronize release metadata to test0.02 (npm 0.0.1-test.0.2), and commit/tag/push to the configured origin.

Architecture refactoring, dependencies, schemas, user data and automatic enforcement tooling are out of scope. Source changes are restricted to public version literals. Credential service identity stays KnowledgeBase.test0.01. Existing historical evidence is retained without relabeling.

## Approach and Acceptance

Distinguish an effective maintenance rule from unmigrated implementation. Replace the global three-layer proposal with process boundaries and Python entrypoints/application/domain/infrastructure, using application ports and bootstrap wiring. Frontend uses feature modules. AC-01 traceable adaptation, AC-02 actionable architecture, AC-03 adoption and scope, AC-04 release compatibility and publishing are defined in specs.md.

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
- Full architecture migration remains future work; this task does not fabricate its authorization or completion.
