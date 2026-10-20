# Requirements

AC-01–04 below describe the completed revision-2 adoption. Revision-3 implementation and release criteria are AC-05–09; version-only restrictions in the historical scenarios do not apply to the authorized refactor.

## ADDED

### AC-01: Traceable adaptation

The effective standard SHALL identify the supplied sources, retain applicable quality principles and explicitly explain differences caused by the project's actual languages, architecture and build system.

#### Scenario: Source assumes Qt and qmake

Given the project uses Electron and Python, when reading the draft, the maintainer can distinguish retained layering requirements from inapplicable .pri, header, pointer and QObject syntax without being asked to migrate stacks.

### AC-02: Actionable project rules and adopted architecture

The standard SHALL define responsibilities, allowed dependencies, naming, formatting, comments, protocol boundaries, cancellation, resource ownership, persistence and risk-based verification. It SHALL use the selected process boundaries, four backend layers and frontend feature modules, separating execution flow from import direction. Suggested future structure SHALL be distinguishable from current implementation.

#### Scenario: Reviewing the planned split

When reviewing the monolithic UI and direct SQL in the service, the maintainer can identify intended ownership and compatibility obligations without interpreting the draft as a completed refactor.

### AC-03: Mandatory adoption and bounded implementation

The delivery SHALL provide a navigable Chinese effective standard and root development instructions, preserve the supplied reading/verification rules, distinguish adoption from architecture migration and disclose verification limitations.

#### Scenario: Future development starts

A developer can locate the binding standard from root AGENTS.md and README. The adopted architecture is not presented as implemented, and existing historical acceptance claims are unchanged. Source edits in this release only change version literals.

### AC-04: Compatible version iteration and publication

Release metadata SHALL consistently identify test0.02 and npm 0.0.1-test.0.2. Persistent credential identity, data locations, dependencies and business behavior SHALL remain unchanged. The release SHALL be committed and published with a new tag to the configured origin using a normal push.

#### Scenario: Upgrade keeps stored credentials accessible

The app and worker report the new public version while the credentials adapter still uses its original service identity. Package and lockfile versions agree without dependency changes.

#### Scenario: Publishing succeeds or fails

On success, the remote main commit and test0.02 tag match local Git. On failure, report the actual failure and retain local work without claiming upload success or using force push.

### AC-05: Actual responsibility and dependency boundaries

Existing owned product code SHALL use app/features/shared in React; separate window, IPC, worker and request lifecycle modules in Electron; and a legal knowledge_agent package with entrypoints/application/domain/infrastructure and bootstrap. Application code SHALL access concrete resources through application-owned ports, with SQL confined to infrastructure. Pure domain rules SHALL perform no external I/O.

Scenario: the launch commands and worker.py remain usable after old monoliths are removed; existing search, notes, questions, recommendations and accounting still pass their behavior tests.

### AC-06: Validated compatible contracts

Operation names SHALL map to request/result types without arbitrary caller result assertions. Unknown messages and operation results SHALL be validated at trust boundaries. Python and TS SHALL test shared protocol samples. Wire names and null/unknown semantics SHALL remain compatible.

Scenario: malformed frames/results are rejected predictably; later valid frames remain usable. Prototype operation names, invalid IDs and duplicate in-flight IDs cannot replace a legitimate request.

### AC-07: Cancellation, compensation and resource ownership

Cancellation before the final synchronous commit SHALL leave no captured knowledge. Parsing cancellation SHALL transfer cleanup to the actual thread completion; shutdown SHALL settle work before closing resources and force only the owned process tree after the existing grace. Same-question locks SHALL count waiters and be reclaimed. Failed configuration/file writes SHALL compensate; compensation/accounting failures SHALL preserve primary exceptions. Requests SHALL settle once and release timers, and late results SHALL not revive a timeout.

Scenario: isolated failure tests cover cancelled parsing, commit checkpoint, cancelled lock waiters, credential restoration, simultaneous primary/cleanup errors and unknown usage; built desktop checks cover normal and forced shutdown.

### AC-08: Maintained source conventions

Touched owned source SHALL follow the adopted filenames, Chinese headers/contracts/steps, language formatting and 80-effective-line function limit including JSX. Pinned Prettier and Ruff configuration SHALL be reproducible; static checks SHALL cover documented naming, headers, function scale and selected imports. Comments, semantics and resource ownership still require review, without claiming complete static enforcement.

Scenario: npm run check verifies applicable static rules, formatting, strict/no-unused TS, backend/host tests and build. Renamed scripts are referenced by actual launch/environment commands and pass syntax checks.

### AC-09: Release and scope preservation

Public versions SHALL consistently identify test0.03 / 0.0.1-test.0.3; credential service, schema and data locations SHALL retain their established identity. The commit SHALL exclude the unrelated pending product plan, secrets, data and artifacts. Publish normal main and a new annotated tag without replacing old tags. Report actual verification limits.
