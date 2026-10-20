# Requirements

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
