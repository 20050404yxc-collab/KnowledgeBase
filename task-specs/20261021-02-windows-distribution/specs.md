# Spec Deltas

## ADDED Requirements

### Requirement: AC-01 Self-contained installation

The distribution SHALL install and start the existing product without preinstalled Node.js, Python, development dependencies or installation-time runtime downloads. Online model operations MAY require network and user-provided API settings.

#### Scenario: Clean offline Windows
- GIVEN an isolated Windows 11 x64 user account without development runtimes
- WHEN the complete installer runs without network access
- THEN the installed UI and Python backend SHALL start and support existing local operations.

### Requirement: AC-02 Explicit location confirmation

Before deploying program files or initializing business data, the installer SHALL allow a first-time user to select separate program and business-data locations and SHALL show effective absolute paths for program, database, sources, logs, sessions and recovery points. It SHALL disclose fixed per-user locator/profile storage and Windows-managed credentials. The user SHALL be able to go back or cancel. Unsafe overlapping locations, unsupported or unwritable directories SHALL fail visibly before commitment.

#### Scenario: Custom data disk and cancellation
- GIVEN a user selects program files on C: and a dedicated data folder on D:
- WHEN the final confirmation page is displayed
- THEN all derived business-data paths SHALL reflect D: and fixed system storage SHALL be disclosed.
- WHEN the user cancels
- THEN no program deployment, business database initialization or data migration SHALL occur; installer temporary extraction is allowed.

#### Scenario: Invalid destination
- GIVEN a destination is unwritable or program and data directories overlap
- WHEN the user attempts to proceed
- THEN installation SHALL be blocked with an actionable explanation, without falling back silently.

### Requirement: AC-03 Stable and consistent data discovery

Installed host, backend, diagnostics and path display SHALL use the confirmed data root. A small fixed per-user locator SHALL persist it independently of version and installation directory. Missing/corrupt/inaccessible locator targets SHALL cause visible recovery behavior, never a silent switch to an empty library. Existing default development data SHALL be identified and explicitly confirmed before reuse. Development/test isolation SHALL remain available without accidental installed-run environment overrides.

#### Scenario: Restart with selected root
- GIVEN successful installation with a selected data root
- WHEN the installed app restarts
- THEN business operations and displayed paths SHALL still refer to that root.

#### Scenario: Data disk unavailable
- GIVEN the recorded data location is unavailable
- WHEN the user launches the installed app
- THEN it SHALL report the inaccessible location without creating an empty replacement library.

### Requirement: AC-04 Manual upgrade and compatibility

The installer SHALL identify an existing per-user installation with a stable identity, display old/new versions and existing paths before confirmation, and upgrade program files while preserving business data, settings and Windows credential identity. No automatic update check/download/install SHALL be added. Upgrade SHALL retain existing locations rather than relocate them. Older-over-newer installation SHALL be rejected; same-version repair SHALL preserve data. Running instances SHALL be handled through bounded app-owned shutdown, never global Python termination. Installation failure SHALL not publish a new locator as a successful installation. No new schema migration is included.

#### Scenario: Upgrade preserves user changes
- GIVEN an isolated older installation containing manual edits, sources, settings and test credentials
- WHEN the user confirms a newer full installer
- THEN the program version SHALL change and existing state and locations SHALL remain available.

#### Scenario: Running instance or failed upgrade
- GIVEN the old application is running or deployment fails
- WHEN installation cannot complete safely
- THEN the installer SHALL request closure or report failure without false success, data overwrite or committed incomplete location changes.

#### Scenario: Version safety
- GIVEN a newer version is installed
- WHEN an older installer runs
- THEN replacement SHALL be refused.
- GIVEN the same version is reinstalled for repair
- THEN program repair SHALL preserve the confirmed paths and user state.

### Requirement: AC-05 Uninstall and reinstall retention

Uninstall SHALL remove only managed application files, shortcuts and installation registration. Business data, locator/profile state and credentials SHALL be retained by default, with no new purge option in this scope. User source originals SHALL never be removed. Reinstallation SHALL rediscover and display the retained data root for confirmation.

#### Scenario: Uninstall and reinstall
- GIVEN a configured installation with isolated knowledge and retained sources
- WHEN it is uninstalled and reinstalled
- THEN the old data location SHALL be offered for explicit confirmation and user content SHALL remain intact.

### Requirement: AC-06 Truthful release and evidence

New public version declarations SHALL be synchronized to 0.1/0.1.0 without rewriting historical evidence or versioning persistent identities. A deliverable SHALL include a checksum and license/signature information. Evidence SHALL distinguish code checks, development UI, packaged execution, clean-machine installation and unverified real-provider behavior. Packages SHALL exclude production data, secrets and development-only resources.

#### Scenario: Release review
- GIVEN a candidate artifact
- WHEN reviewed for distribution
- THEN its reported version, contents, SHA-256, license notices and actual verification scope SHALL be reviewable, with unrun checks explicitly unverified.

## R2 Path validation correction (AC-02/03/05)

- Nonexistent local destination directories SHALL normalize without creation, including Chinese, spaces, nested components and separate fixed local drives. Page input and shared validation SHALL use the same normalized paths.
- Failed normalization/validation SHALL preserve the first actionable error and SHALL NOT compare empty replacement paths for overlap.
- The installer SHALL NOT apply an arbitrary 220-character root limit; actual OS/component failure SHALL remain visible. This does not promise unlimited installed payload paths.
- Unrelated ordinary files SHALL NOT make a business-data root invalid. Without a recognized original database/locator, conflicting managed directories or SQLite companion files SHALL block takeover. Managed child links and wrong file/directory types SHALL be rejected.
- Empty/dedicated binary targets, overlap/root/link rejection, writable-parent probing and missing-original-library protection SHALL remain.

Scenario: a user enters two independent, not-yet-existing folders matching the reported layouts; the actual location-page leave handler SHALL accept them without creating either folder. Sibling names with shared prefixes SHALL pass; identical/nested/normalized-overlap paths SHALL fail.
