# Spec Deltas

## Revision 10 sphere navigation (planned, not implemented)

### Requirement: R10-01 Three-level spatial navigation (AC-01/02/14)
Saved knowledge in Library, Frequent, Learning and Archive SHALL render category spheres at the root. Selecting a category SHALL center that sphere and arrange its subcategory spheres around it. Selecting a subcategory SHALL center that sphere and present knowledge titles connected by horizontal lines. Selecting a title SHALL invoke existing detail opening by stable ID. Breadcrumbs and Back SHALL restore the parent view. Sphere movement SHALL respect reduced-motion preferences and preserve readable labels.

#### Scenario: Enter and return
Given multiple categories and subcategories, navigating root → category → subcategory → knowledge SHALL preserve the exact chosen classification and detail ID. Returning SHALL show the previous level with the relevant parent focused. Keyboard users SHALL have equivalent access.

### Requirement: R10-02 Complete and isolated navigation (AC-02/11/15/19)
Focus paths and presentation pages SHALL be owned by their originating page. Existing query/bucket filtering, counts, branch cursors, stale-result rejection and invalidation SHALL remain authoritative. Every node SHALL remain reachable through bounded pagination. Query changes SHALL return to matching root categories; invalid paths after refresh SHALL fall back to the nearest valid ancestor. Category browsing SHALL NOT record active knowledge use, call a model or write classification. No R9 merge, concurrency or migration capability is implied.

#### Scenario: Large, changing and narrow library
Given more than 200 leaves, many sibling categories, long labels and narrow windows, every filtered leaf SHALL remain accessible with readable non-overlapping labels and valid horizontal connectors. Rapid navigation, late responses, empty results, failures/retry, section changes and removed categories SHALL NOT select an unrelated node or leave an unreachable view. Existing knowledge detail and usage semantics SHALL remain unchanged.

## Revision 9 requirements (planned, not implemented)

### Requirement: R9-01 Opposite-direction workers and coverage ledger
One restructuring task SHALL own two analysis workers with independent model context, claiming from opposite ends of a snapshot ordered by creation time and ID. Claims SHALL be exclusive. Validated per-item/chunk evidence, coverage, agent, version, candidates and status SHALL be recorded in session state. Total coverage SHALL count each source exactly once; meeting at the center SHALL NOT duplicate processing. Existing single top-level generation-task policy remains.

#### Scenario: Odd-sized inventory and asymmetric workers
Given 13 sources with long bodies and supplements and one slower worker, both workers SHALL eventually cover all authorized chunks exactly once without concurrent ownership of an ID. A retry SHALL preserve successful coverage and reprocess only failed/incomplete chunks. Closing the backend discards unconfirmed records without altering official knowledge.

### Requirement: R9-02 Bounded cancellation, failure and accounting
At most two analysis calls SHALL be in flight. Each call SHALL have an attributable ID, attempt accounting and bounded stage. One-worker failure SHALL allow preservation of the other's valid current chunk, then pause scheduling. Explicit cancellation SHALL cancel/join both workers and prevent late writes/new claims. Navigation SHALL retain the task. Invalid summaries SHALL distinguish missing/type/empty/length conditions with source/chunk context; no silent truncation or automatic retry.

#### Scenario: Failure, cancellation and late response
When one worker returns an oversize summary, its last valid record and the other's successful current chunk remain visible. Explicit retry affects only incomplete work. Discard during either call prevents both late responses from reviving the draft and leaves no in-flight child request.

### Requirement: R9-03 Global structure and reviewed duplicate groups
The system SHALL reconcile all workers' records and cross-worker/batch duplicate candidates before structure approval. Duplicate evidence SHALL distinguish equivalent, partial overlap, related and conflicting content, with original overlaps and unique details. Similar titles or transitive similarity SHALL NOT authorize merging. Users SHALL correct/add candidates and decide each group, including survivor ID/title/path and conflicting manual bucket. Each source SHALL map exactly once to a target; confirmed groups may map multiple sources to one target. Unknown IDs, incomplete coverage, undecided groups and unresolved path collisions SHALL block preparation. Structure/map/decision changes SHALL invalidate approval and affected content.

#### Scenario: Non-transitive overlap and rejected merge
If A overlaps B and B overlaps C but A and C conflict, the component SHALL NOT become an automatic merge. Users may retain separate sources, adjusting colliding titles/paths before approval. Cross-worker candidates SHALL be included even when the earlier worker could not yet see the later record.

### Requirement: R9-04 Source extraction and optional explanations
After structure approval the system SHALL extract relevant content from full original bodies/supplements using the confirmed map, with verifiable IDs/versions/locators and citation provenance. Compressed summaries alone SHALL NOT be final content evidence. Consolidation SHALL preserve unique details/qualifications and present contradictions without inventing resolution. Model explanations SHALL be separately labeled, optional and unselected by default, without borrowed unsupported citations or network access. Manual/edited originals remain intact; existing generated-body replacement limits apply. Oversize content SHALL remain incomplete, never lose its tail silently.

#### Scenario: Unique tail and model-only explanation
When two overlapping notes contain different final-chunk constraints and an edited supplement, the consolidated proposal SHALL preserve both constraints and original supplement. A model explanation appears separately and is excluded until selected.

### Requirement: R9-05 Two approvals and atomic group acceptance
Structure approval SHALL authorize preparation only. Final content approval SHALL select each accepted merge group as a complete unit, with all unique content retained. Directory-only application SHALL NOT execute merges; users must cancel merges/reapprove or accept complete group contents. The final request SHALL bind structure, source map, group choices and content versions. Unselected changes SHALL remain unchanged. Stale content/membership/classification/merge versions SHALL reject application; use-day updates alone SHALL NOT invalidate it. A unique consistent recovery point, transactional application/index synchronization and idempotent receipt remain required.

#### Scenario: Directory-only request with merge
Given an approved many-to-one map, an empty content selection SHALL reject application without modifying the library. Given a valid final selection, a storage failure SHALL roll back mappings, text and index changes together; repeated successful submission SHALL return the same receipt.

### Requirement: R9-06 Traceable canonical merging and migration
A confirmed merge SHALL retain original records, edited text, supplements, citations and source versions, with canonical-ID mappings and provenance. A recoverable, additive schema 3-to-4 migration SHALL represent this state; unknown higher versions SHALL be refused. Old IDs SHALL open the survivor with a read-only original view. Ordinary trees/search/recommendations/reuse SHALL resolve canonical IDs and avoid duplicate results while retaining all source content for retrieval. Survivor ID/manual bucket SHALL follow user choice; use days SHALL aggregate as a set without recording restructure as use. Repeated restructuring SHALL cover retained sources without treating them as independent active notes. Ordinary deletion of merged groups SHALL be refused with explanation; no physical deletion or unmerge feature is included.

#### Scenario: Restart, old link and hidden source content
After a confirmed merge and restart, an old source ID SHALL resolve correctly, its original text remains viewable and searchable under the survivor, and capture receipts/generation reuse SHALL NOT recreate it as a duplicate. Migration or transaction faults SHALL preserve recoverability and stop writes rather than create an empty database.

### Requirement: R9-07 Review UI and truthful limits
The UI SHALL show distinct worker/coverage/status counts, paged per-item records, duplicate evidence/decisions, source mappings, content provenance and independently selectable explanations. Draft records remain session-local. Costs/unknown usage SHALL remain attributable; no speed, cost or perfect semantic-duplicate guarantee is implied. Implemented R8 and planned R9 behavior SHALL be labeled separately until verification.

#### Scenario: Review on narrow windows
Users SHALL reach both worker failures, each duplicate decision, full source/diff detail and final controls without page overflow or an implied preselected merge/model supplement. Invalid outputs SHALL identify the failed source/chunk rather than claim a directory failed before classification.

## Revision 8 requirements (implemented; isolated evidence in verification.md)

### Requirement: R8-01 Navigation-independent task execution
The system SHALL continue planning, learning, expansion, batch and restructuring tasks across page navigation using task-owned input, model, permissions and cancellation state. Progress/errors/results SHALL remain associated with the originating page/plan. Ordinary reading selections SHALL NOT stop a batch. One generation workflow at a time remains supported; a global task indicator SHALL offer return and explicit cancellation.

#### Scenario: Navigate during a multi-stage batch
- GIVEN a batch with pending items and an active model request
- WHEN the user navigates to another page, reads knowledge and later returns
- THEN remaining selected items continue without duplicate requests, the original page displays its outcomes, and the other page retains its own state.
- AND cancellation between material audit and generation prevents the next stage; committed knowledge remains accurately reported.

### Requirement: R8-02 Complete hierarchy in library and all buckets
The library, 常用, 在学 and 归档 pages SHALL display saved knowledge by category/subcategory/point using the same classification. The library SHALL include all frequency buckets. Each bucket SHALL filter before counts, grouping, search and pagination, omit empty paths, and retain independent expansion/filter/cursor/reading/scroll state. Legacy/manual unclassified notes SHALL remain accessible. Candidate learning directories SHALL be visibly distinct from saved trees; existing bucket questions and editing SHALL remain available.

#### Scenario: Inventory exceeds the old list limit
- GIVEN more than 200 notes in each bucket, shared category names and unclassified notes
- WHEN browsing/searching each page through all pages of leaves
- THEN every matching saved ID is reachable exactly once in its path, counts match scope, and no out-of-bucket leaf/count leaks.
- AND manual or time-based bucket changes move the leaf without changing its classification; tree expansion never records active use.

### Requirement: R8-03 Full-inventory outline proposal before mutation
Restructuring SHALL account for every knowledge ID and its supplements through bounded key-point summaries and model batches, report coverage and return a proposed complete category tree with old/new paths and reasons before formal mutation. Missing/duplicate/unknown IDs, incomplete results or unresolved identity/path collisions SHALL block confirmation. User adjustment requests SHALL invalidate prior outline confirmation.

#### Scenario: Long-tail content and invalid model coverage
- GIVEN notes with meaningful sections near the end and independently meaningful supplements
- WHEN the model returns an incomplete, duplicate or colliding mapping
- THEN the system identifies incomplete/conflicting coverage, cannot claim complete scanning and leaves formal knowledge unchanged.

### Requirement: R8-04 Outline approval followed by selected content-diff approval
Only explicit approval of the current outline revision SHALL permit preparation of necessary content suggestions. The system SHALL show old text, proposed text, differences and reasons and SHALL require final explicit acceptance of selected update IDs or directory-only application. Generated unedited bodies MAY be replaced only when selected; manually created/edited bodies and supplements SHALL be preserved, with separately accepted organizational supplements instead. Citations, IDs and prior supplements SHALL remain intact. Navigation SHALL preserve pending previews.

#### Scenario: Accept directory but reject body changes
- GIVEN an approved outline and generated-body/manual-note suggestions
- WHEN the user applies directory-only, or selects only one eligible update
- THEN no unselected body is changed, manual original text remains intact, and no official mutation occurred merely from preparing previews.

### Requirement: R8-05 Recoverable atomic restructuring with stale-plan protection
Final apply SHALL create a consistent pre-change recovery point, validate the complete inventory/content/supplement/classification snapshot, and atomically commit approved paths/updates plus all affected search indices. Changed inventory or content SHALL reject the stale plan. Repeated final confirmation SHALL be idempotent. No automatic merge/deletion is authorized. Frequency metadata and usage SHALL be preserved; summaries SHALL NOT count as active use.

#### Scenario: Editing during review or storage failure
- GIVEN a complete proposal awaiting final confirmation
- WHEN a note is added/deleted/edited/reclassified, or a fault occurs during atomic application
- THEN stale proposals are rejected or writes roll back entirely, original knowledge stays recoverable, and no false success appears.
- AND a successful classification change is immediately reflected in knowledge/supplement search and all four page trees.

### Requirement: R8-06 Automatic classification for new question/expansion captures
New formal knowledge from normal questions, directory learning and recommendation expansions SHALL have validated category/subcategory paths committed atomically with content. Existing suitable paths SHALL be preferred when within allowed evidence scope; supplements SHALL inherit target classification. Files-only operations SHALL NOT read/send existing-library taxonomy. Reused knowledge SHALL NOT trigger redundant classification generation; invalid classification SHALL NOT be reported as saved success.

#### Scenario: Expansion after restructuring
- GIVEN an accepted reorganized library and a newly generated expansion
- WHEN the expansion is captured
- THEN its valid path follows the current suitable taxonomy and appears in all-library and appropriate frequency trees.
- AND malformed classification produces an explicit unsaved outcome; files-only classification uses only authorized generated/file content.

### Requirement: R8-07 Permission, cancellation and bounded resources
Navigation SHALL NOT revoke an active task's already-approved material/public permission. Permission SHALL remain bound to its exact point/challenge/task, never authorize another task, and be invalidated on cancellation or relevant input/material changes. Completed points SHALL use idempotent results; still-pending supplement review MAY retain its valid material context, and changed reading selection SHALL revoke the previous public challenge after active work settles. Every stage SHALL have its own request ID. Existing request timeouts, application exit cleanup, per-attempt accounting and no automatic retry SHALL remain. No restart continuation is promised. Protocol pages SHALL respect the existing frame limit.

#### Scenario: Cancel, change materials or close while away
- GIVEN an in-progress task whose originating page is hidden
- WHEN the user cancels, removes relevant materials, changes the source input, encounters timeout or closes the app
- THEN no later stage starts, uncommitted fragments are not captured, committed data is honestly reported, and pending IDs/subscriptions/permissions/drafts are settled and released.

## Purpose

Revision 8 is implemented under user authorization “开始改” and locally verified with isolated data and mocked models. R8-01..07 supersede navigation cancellation and flat saved-list requirements where explicitly stated; all other compatible R4..R7 protections remain. User selected diff-first content protection and later required all three bucket pages to be hierarchical as well as the new library page.

Revision 6 supersedes the earlier revision-5 draft and is implemented under the user authorization “进行开发”. R5-01..05 are retained with R6-01..03; R4 approval/evidence does not establish these new behaviors.

Revision 4 implements safe reading, independent lexical retrieval, question-point directories and continuing supplements. The user selected lexical-only scope and authorized implementation with "开始修改". R4-01..R4-08 below are locally verified with isolated data and mocked providers; real-provider quality, production migration and semantic search are not claimed.

Revision-3 API/model additions were authorized by "开始修改" and implemented on the test0.03 baseline. Current isolated evidence is in verification.md; prior test0.01 results remain historical and do not substitute for this validation.

Define the planned observable behavior of the personal knowledge desktop agent. These remain the full v1 requirements for authorized revision-2 development. test0.01 provides partial implementation evidence; it does not establish final launch acceptance or settle OCR/DOC decisions. Library candidates and implementation details belong in design.md.

## Authorized Environment Preparation (separate from product revision approval)

### Requirement: ENV-01 Confirmed isolated locations
Development dependencies SHALL use project `.venv` and `node_modules`, with new tool caches under `D:/dev-tools` and OCR models under `D:/dev-models/KnowledgeBase`, as explicitly confirmed by the user. Existing global runtimes SHALL be reused when compatible.

#### Scenario: Enter the prepared development environment
- GIVEN the confirmed Windows workspace and installed compatible runtimes
- WHEN the environment entry script is dot-sourced
- THEN Python resolves inside project `.venv` and cache/model settings resolve inside the confirmed directories
- AND no persistent system environment setting or global runtime replacement is required

### Requirement: ENV-02 Reproducible candidate readiness
The prepared environment SHALL retain exact dependency versions and model hashes and demonstrate basic local runtime/library execution using synthetic data. Results SHALL distinguish environment readiness from product acceptance.

#### Scenario: Verify installed candidates
- GIVEN the installed dependency locks and checked local models
- WHEN the supplied Node and Python environment checks run
- THEN frontend/native runtime execution, basic document parsing, SQLite extension loading and CPU OCR complete successfully
- AND offline OCR uses the recorded local resources without model downloads
- AND real providers, representative-file quality and installer acceptance remain explicitly unverified

## ADDED Requirements

### Requirement: AC-01 Desktop interaction

The application SHALL provide a Windows desktop search/reading area, attachment controls, knowledge buckets, source-library access, provider settings, and usage statistics. Background work SHALL expose status without blocking normal window interaction.

#### Scenario: Reading while a document is processing
- GIVEN a document parsing task is in progress
- WHEN the user moves the window or opens an existing knowledge item
- THEN the application remains responsive and shows the task state
- AND parsing failure is displayed as failure rather than readiness.

### Requirement: AC-02 Existing-knowledge retrieval

The system SHALL search existing local knowledge before generating new learning content. It SHALL support keyword retrieval and semantic retrieval when a compatible embedding configuration exists. It SHALL distinguish sufficient, partial, and insufficient evidence without treating an exact-word miss as proof of absence.

#### Scenario: Rephrased query with an existing concept
- GIVEN an existing relevant item and the retrieval capabilities configured for the test
- WHEN the user asks about the concept in different wording
- THEN the relevant existing item is returned under the agreed retrieval test cases
- AND the search does not automatically create a duplicate concept.

#### Scenario: Partial evidence
- GIVEN the store only answers part of a question
- WHEN a response is produced
- THEN existing evidence and additional explanation are distinguishable
- AND original personal notes are not silently replaced.

### Requirement: AC-03 File input and attachment states

The system SHALL accept readable local files through drag/drop, a file picker, and pasted local file paths, including multiple attachments. V1 file addresses SHALL be limited to local paths; remote URLs and online documents are outside this release scope. It SHALL show per-file preparation/readiness/failure state and allow removal. Empty input SHALL NOT silently trigger a paid summarization request.

#### Scenario: Equivalent attachment entry points
- GIVEN the same readable supported file
- WHEN attached using any of the three entry points
- THEN it is available to the current question after preparation
- AND removing the attachment excludes it from subsequent questions in that scope.

#### Scenario: Invalid or inaccessible path
- GIVEN a path that cannot be opened
- WHEN the user submits it
- THEN the application identifies the failure without claiming the file was parsed.

### Requirement: AC-04 Document parsing and compatibility disclosure

The core format target SHALL include MD, TXT, DOCX, and text-based PDF with available structure and source positions preserved. The application SHALL detect unreadable/scanned content and partial parsing and SHALL NOT report unrecognized pages as fully processed. OCR selection SHALL be preceded by review of existing open-source projects. Scanned PDF/OCR and legacy DOC release inclusion SHALL be explicitly resolved before launch acceptance; completed research alone SHALL NOT count as runtime support.

#### Scenario: Text and scanned pages in one PDF
- GIVEN a PDF containing readable text and a scanned page
- WHEN the document is processed
- THEN supported content has page-linked evidence
- AND the scanned page is either recognized by the agreed OCR capability or explicitly reported as not recognized.

#### Scenario: Structured Word or Markdown content
- GIVEN a document containing headings, paragraphs, a table, or code
- WHEN processed by the selected parser
- THEN the supported structure and usable positions are retained
- AND unsupported structures are disclosed rather than fabricated.

### Requirement: AC-05 Scope, grounding, and citations

The application SHALL offer current-files-only, knowledge-only, and mixed scope. With attachments, mixed scope SHALL prioritize current files and label knowledge/model supplements. Answers SHALL cite actual available evidence with the best reliable locator. File-only answers SHALL disclose insufficient evidence rather than silently substituting general knowledge.

#### Scenario: No answer in file-only scope
- GIVEN current files do not support the requested conclusion
- WHEN the user asks in file-only scope
- THEN the answer reports insufficient document evidence
- AND does not attribute unsupported conclusions to the files.

#### Scenario: Citation navigation
- GIVEN an answer citing an available PDF page, Word paragraph, or Markdown block
- WHEN the user opens the citation
- THEN the corresponding source evidence is shown
- AND unavailable precision, such as stable Word page numbers, is not invented.

### Requirement: AC-06 Long-document and multi-document coverage

The system SHALL distinguish focused questions from whole-document summaries. It SHALL use a coverage-aware method for whole-document requests and identify source files in multi-document answers. Any partial coverage or input limit SHALL be disclosed.

#### Scenario: Whole-document summary exceeds one model input
- GIVEN a document larger than one supported input
- WHEN the user requests a whole-document summary
- THEN processing covers the document through the agreed multi-part method or explicitly reports uncovered content
- AND does not present a few retrieved passages as a complete reading.

#### Scenario: Conflicting sources
- GIVEN two attached documents make conflicting claims
- WHEN the user requests a comparison
- THEN the response distinguishes the claims and cites their respective files.

### Requirement: AC-07 On-demand source retention

Attachments SHALL be temporary by default. Explicit source-library admission SHALL retain a managed source copy and reusable index. Automatically captured knowledge SHALL retain necessary evidence excerpts and locators without silently retaining the complete temporary source. Cleanup SHALL NOT delete the user's original file.

#### Scenario: Temporary source after session cleanup
- GIVEN a temporary document produced a saved knowledge item
- WHEN its session ends and temporary managed copies are cleaned
- THEN the knowledge and necessary citation excerpts remain readable
- AND complete-source unavailability is disclosed
- AND the original user file remains untouched.

#### Scenario: Explicitly retained source
- GIVEN the user selects Add to source library
- WHEN the source is successfully saved
- THEN its managed version is available for later retrieval without reattachment
- AND a failed save is not reported as successful admission.

### Requirement: AC-08 Complete, attributable knowledge capture

Complete reusable new learning content SHALL be automatically captured into 在学 after successful generation and validation. Generated provenance and actual sources SHALL be retained. Repeated answers SHALL NOT automatically create duplicate concepts, and incomplete/cancelled/failed output SHALL NOT become a formal item.

#### Scenario: Successful new concept
- GIVEN relevant knowledge is insufficient and generation completes
- WHEN the result is validated as reusable and new
- THEN a knowledge item is saved in 在学 with generated provenance and available evidence
- AND no unsupported verified-source claim is attached.

#### Scenario: Generation fails before completion
- GIVEN partial streamed output
- WHEN the request fails or is cancelled before commit
- THEN no formal knowledge item is created from that partial output.

### Requirement: AC-09 Three related-learning recommendations

Under successful operation the system SHALL present three distinct relevant recommendations with reasons: two existing plus one expansion when at least two eligible existing items exist, one plus two when one exists, or three expansions when none exist. It SHALL NOT use irrelevant or duplicate items to fill the count; inability to form the list SHALL be explicit.

#### Scenario: Inventory-dependent composition
- GIVEN separately prepared stores with two, one, and zero eligible existing related items
- WHEN recommendations are requested for the same concept
- THEN successful lists use 2+1, 1+2, and 0+3 respectively
- AND each recommendation explains its relation.

#### Scenario: Recommendation generation failure
- GIVEN the system cannot form three valid recommendations
- WHEN displaying the result
- THEN it identifies the incomplete list or failure rather than fabricating knowledge entries.

### Requirement: AC-10 Expansion on click

Expansion cards SHALL initially contain a title, a reason, and a short preview. Full expansion content SHALL be generated on selection and automatically captured into 在学 only after success. Repeated selection SHALL reuse existing captured content or the in-flight request rather than create duplicates.

#### Scenario: Repeated expansion selection
- GIVEN an expansion card has been selected
- WHEN the same card is selected again during or after successful processing
- THEN there is at most one captured item for that operation/concept
- AND a failed generation offers recovery without saving a blank item.

### Requirement: AC-11 Usage-frequency buckets

The application SHALL use confirmed option A: 常用 requires at least three distinct active-use days within the trailing 14 days; 归档 requires item age of at least 30 days and no active use for 30 consecutive days; remaining automatic items and new items are 在学. Active use means opening item details, deduplicated per item and recorded local calendar day. Manual overrides SHALL take precedence. Archival SHALL NOT delete knowledge. Background retrieval, generation and recommendation display SHALL NOT count as active use. Policy changes SHALL preserve usage history. A previously archived item SHALL reactivate to 在学 on active use unless it meets 常用 criteria or has a manual override.

#### Scenario: Deterministic time-based transitions
- GIVEN controlled dates and events under option A: three use days/14 days and no use/age >=30 days
- WHEN automatic buckets are evaluated
- THEN frequently opened knowledge becomes 常用, old unused knowledge becomes 归档, and remaining automatic knowledge stays 在学
- AND a new unviewed item is not immediately archived.

#### Scenario: Manual override and daily deduplication
- GIVEN an item is manually fixed and another is opened repeatedly on one local day
- WHEN automatic calculation runs
- THEN the fixed item's bucket remains unchanged
- AND the repeated opens count according to the agreed daily-deduplication rule, not as multiple usage days.

### Requirement: AC-12 Provider configuration

The application SHALL target GPT as the primary generation integration and include DeepSeek, Claude and Grok in its mainstream-provider integration scope. It SHALL manage multiple configurations, keep model IDs configurable, allow independent selection of generation and embedding capabilities, and test the configured capability. Compatibility SHALL follow the actual official/proxy protocol rather than model branding. Unsupported protocols or missing embedding capabilities SHALL be explicit. Updating providers SHALL NOT erase knowledge.

#### Scenario: Generation-only provider
- GIVEN a supported provider/model can generate text but cannot embed
- WHEN tested and selected
- THEN its available capability is reported accurately
- AND semantic retrieval is not advertised as enabled by that test alone.

### Revision 3 acceptance scenarios (implemented; isolated evidence in verification.md)

#### Scenario: AC-12-R3 Edit and cancel
- GIVEN a saved provider and protected key
- WHEN edited and saved with a blank key
- THEN the same ID, active state and old secret are retained without duplicates or returning the stored key
- AND cancel changes nothing; replacement-key persistence failure has observable compensation.

#### Scenario: AC-12-R3 Model discovery and manual maintenance
- GIVEN a current endpoint/protocol draft and a new key or saved config ID
- WHEN models are requested
- THEN bounded authenticated GET discovery uses protocol-appropriate headers, sends no generation/question/document payload, and merges valid IDs without duplicates into the draft
- AND manual add/remove is available and only explicit save persists catalog/default changes
- AND errors, unsupported services, malformed/oversized responses and pagination limits preserve prior state with a visible outcome
- AND draft changes, cancellation and unmount invalidate late replies.

#### Scenario: AC-12-R3 Optional default and effective model
- GIVEN a provider with no catalog/default
- WHEN saved
- THEN saving succeeds without inventing a model
- AND composer offers use-default/concrete catalog models; an explicit valid model overrides the default without changing it
- AND required generation/tests without a model are rejected before network I/O while local retrieval remains usable
- AND legacy models remain defaults and catalog entries after migration.

#### Scenario: AC-12-R3 Effort and request snapshot
- GIVEN a composer model and effort selection
- WHEN a question or expansion needs generation
- THEN provider/model/effort are snapshotted and determine the actual request and recorded model
- AND default omits effort, Responses uses reasoning.effort and Chat uses reasoning_effort
- AND Anthropic initially offers only model-decided effort until its specific contract is implemented and verified
- AND protocol-expressible/model-unverified choices are identified; model ID listing alone proves no capability
- AND invalid/unsupported effort has a visible outcome, without temperature substitution, automatic retry or silent lowering
- AND model changes reset effort, provider changes isolate session selection, and later configuration edits do not retarget active requests.

#### Scenario: AC-12-R3 Reuse remains explicit
- GIVEN existing knowledge qualifies for reuse
- WHEN a different model is selected and the same question submitted
- THEN the original item and personal edits remain protected, with an explicit no-model-call notice and no forced regeneration.

#### Scenario: AC-13-R3 Actual model and price scope
- GIVEN prices configured for the default model
- WHEN another model is explicitly used
- THEN attempts/provenance record that actual model and prices/cost remain unknown
- AND changing the configured default clears old prices unless re-entered
- AND local reuse/discovery fabricate no generation attempts or token usage.

#### Scenario: AC-19-R3 Recoverable catalog migration
- GIVEN an isolated legacy database with knowledge, configs, generation keys and attempt history
- WHEN migration runs or repeats
- THEN an application-managed consistent backup precedes versioned incremental migration, catalog backfill is idempotent and original data/IDs/key references remain intact
- AND failure rolls back and blocks writes with recovery information instead of substituting an empty database.

### Requirement: AC-13 Usage and cost accounting

Model attempts SHALL be recorded with purpose, provider/model, outcome, elapsed time, and available returned usage. Retries and embedding calls SHALL be represented without double-counting. Missing usage SHALL be unknown, and estimated cost SHALL be distinguished from bills and grouped by currency unless an explicit conversion exists.

#### Scenario: Retry and cancelled request with missing usage
- GIVEN a generation retry and a cancelled embedding call without returned usage
- WHEN statistics are displayed
- THEN each attempt is represented once
- AND missing usage is unknown, not zero
- AND estimated prices are distinguishable from supplier charges.

### Requirement: AC-14 Offline and degraded operation

Local knowledge browsing and keyword search SHALL remain available without a working model API. Missing embeddings SHALL produce a disclosed keyword-only fallback. Failures SHALL NOT silently switch to an unselected provider or claim that AI generation succeeded.

#### Scenario: Network unavailable
- GIVEN retained local knowledge and an unavailable provider
- WHEN searching and requesting generation
- THEN local browsing/search remains usable
- AND generation failure and any retrieval degradation are visible.

### Requirement: AC-15 Cancellation, failure, and process lifecycle

The application SHALL expose task progress, cancellation, and failure, settle pending UI states after backend failure, and prevent duplicate persistence across retries. Shutdown SHALL terminate owned background work. Cancellation before commit SHALL prevent capture; cancellation after commit SHALL truthfully disclose persisted results.

#### Scenario: Shutdown during parsing
- GIVEN an active parsing/model task
- WHEN the application closes
- THEN owned work and the backend terminate within the documented shutdown policy
- AND no formal partial knowledge or orphaned owned worker remains.

#### Scenario: Backend failure and recovery
- GIVEN the backend fails during an active request
- WHEN the UI detects failure and the user retries after recovery
- THEN waiting state ends, failure is visible, and a previously committed result is not duplicated.

### Requirement: AC-16 Knowledge and source maintenance

Users SHALL be able to view, edit, and delete knowledge and manage retained sources. Automatic content SHALL NOT overwrite personal edits without explicit action. Source deletion SHALL update its indices and citation availability, explain its effects, and leave user-owned original files untouched.

#### Scenario: Source deletion with derived knowledge
- GIVEN a retained source supports a knowledge item
- WHEN the user confirms source deletion
- THEN the managed source and its searchable source index are removed
- AND retained knowledge excerpts remain with accurate unavailable-original status
- AND unrelated knowledge and the original user file remain untouched.

### Requirement: AC-17 Credential and content boundaries

Credentials SHALL be protected using operating-system credential facilities and SHALL NOT be stored in plain configuration, ordinary logs, or knowledge content. External API requests SHALL use the selected scope and necessary context. Document text and model output SHALL NOT gain filesystem, command-execution, or arbitrary desktop-operation authority.

#### Scenario: Hostile document instructions
- GIVEN a document contains text requesting command execution or credential disclosure
- WHEN used as question evidence
- THEN it remains source content and cannot authorize those operations
- AND credentials do not appear in rendered output or ordinary request logs.

### Requirement: AC-18 Windows installation

The agreed release SHALL install and perform its accepted core workflows on Windows 11 x64 with a 16GB RAM acceptance baseline and without requiring a dedicated GPU, a separately installed Python runtime, or a manually started backend. This baseline SHALL NOT be presented as a measured minimum requirement. Windows 10 and other architectures are not included in the v1 compatibility commitment. OCR/conversion/model dependencies and unsupported formats SHALL have an explicit delivery/support policy.

#### Scenario: Clean-machine smoke test
- GIVEN clean Windows 11 x64 with 16GB RAM, no dedicated GPU and no separately installed Python runtime
- WHEN the release is installed and the user asks a question using a supported file
- THEN the managed backend starts and the complete accepted workflow operates
- AND unavailable optional capabilities are clearly identified.

### Requirement: AC-19 Durable data and rebuildable indices

Formal knowledge SHALL be durably committed independently of rebuildable search indices. Source versions and index/model configurations SHALL remain consistent. An embedding-model or dimension change SHALL NOT mix incompatible vectors or delete source knowledge; migration or indexing failure SHALL be recoverable and accurately reported.

#### Scenario: Embedding configuration change
- GIVEN knowledge with an index built by one embedding configuration
- WHEN the model/dimension changes
- THEN incompatible indices are invalidated or rebuilt
- AND original knowledge remains accessible through local browsing/keyword retrieval.

#### Scenario: Failed persistence
- GIVEN a disk or transaction failure while saving a source/knowledge item
- WHEN the operation completes unsuccessfully
- THEN the application does not report a saved item
- AND partial managed files and database state are reconciled without altering user originals.

## MODIFIED Requirements

### Requirement: R4-01 Readable and safe knowledge content (AC-01/05/17)
The system SHALL render Markdown headings, emphasis, lists, tables and code safely, preserve editable source, and map authorized citation markers outside code to navigable references. Raw HTML, scripts and dangerous URLs MUST NOT execute.

#### Scenario: Markdown and malicious content in one result
- GIVEN complete content containing headings, bold text, a table, code with literal markers, authorized evidence markers and malicious HTML/URLs
- WHEN the user opens the detail
- THEN formatting and real references are readable, code remains literal, and active content is blocked
- AND old note source is not rewritten to achieve display formatting.

### Requirement: R4-02 Independent complete local lexical retrieval (AC-02/14/19)
The system SHALL expose a zero-model-call local search of knowledge, supplements and allowed retained source blocks, with grouped hits, excerpts, explicit scope and pagination. Retrieval MUST NOT silently exclude records merely because they are older than the latest 5000 entries. Frequency filters SHALL remain separate from themes.

#### Scenario: Offline retrieval of older supplements
- GIVEN more than 5000 notes, an older matching supplement and retained source, and no model/network
- WHEN the user searches all frequency buckets with Chinese and multiple keyword input
- THEN the older match and allowed source are reachable through pages with stable links and no model request
- AND limited synonym recall and actual scope are disclosed.

### Requirement: R4-03 Question points rather than question titles (AC-01/02/08)
The system SHALL normalize a question and return validated, bounded, theme-grouped knowledge points with focused titles, facets and existing/new/supplement/review statuses. It MUST NOT use a whole raw question as the new knowledge title or force multiple categories for a single simple point. A directory label alone MUST NOT count as captured knowledge.

#### Scenario: Several facets in one question
- GIVEN a question asking camera integration, UI responsiveness and reconnect handling
- WHEN the user requests decomposition with an available model
- THEN distinct focused knowledge points are returned in related themes rather than a single article named after the question
- AND invalid/duplicate/oversized plans fail observably while local results remain available.

### Requirement: R4-04 Selectable directory and on-demand details (AC-01/08/11/13)
The system SHALL show a directory before new detail generation. Opening existing content SHALL use local storage; new learning and supplements SHALL require selecting the relevant point/action. Unselected points MUST NOT generate detail or claim capture. Only active reading counts under the existing frequency policy; planning and each generation attempt SHALL be accounted separately.

#### Scenario: Open one of several planned points
- GIVEN a directory with an existing point and several new points
- WHEN the user opens the existing point then requests learning for one new point
- THEN the existing detail causes no model call and only the selected new point is generated and captured after complete validation
- AND returning to the directory retains completed statuses without generating the remaining points.

### Requirement: R4-05 Attributable incremental accumulation (AC-08/16/19)
The system SHALL preserve stable knowledge identity and original user-edited content, append attributable complete supplements to confirmed targets, and include supplements in subsequent reading/search. A repeated question or title MUST NOT alone suppress genuinely new facets or new attachment evidence. Supplements SHALL support independent edit/delete with index consistency.

#### Scenario: Later evidence enriches an existing point
- GIVEN an existing edited reconnect note and a later question with new backoff evidence
- WHEN the user requests and completes a supplement to the confirmed reconnect target
- THEN the original note remains unchanged and the supplement retains time/model/citations across restart
- AND editing/deleting that supplement updates search without deleting the original note or source file.

### Requirement: R4-06 Conservative identity and idempotency (AC-08/15/16/19)
The system SHALL distinguish same-named points in different contexts, reuse exact duplicate content and serialize or revalidate target writes. Ambiguous association and conflicting claims SHALL remain reviewable and MUST NOT silently merge or overwrite. Duplicate clicks/retries/terminal events MUST NOT duplicate capture.

#### Scenario: Concurrent enrichment and ambiguous names
- GIVEN concurrent requests to supplement one target and another context with the same short title
- WHEN completions arrive after a target edit or deletion
- THEN writes are revalidated, repeated content is stored at most once, and ambiguous/conflicting candidates require target confirmation or separate capture
- AND stale completions cannot recreate a deleted target or overwrite manual content.

### Requirement: R4-07 Scoped failure and cancellation behavior (AC-05/13/14/15/17)
The system SHALL retain local results on model failure, reject late UI responses, enforce selected evidence scope and report per-point commit outcomes. Cancellation before a point commits SHALL prevent that capture; previously committed points SHALL remain and MUST NOT be reported as undone. Model planning/detail requests SHALL use snapshotted configuration and no implicit retry.

#### Scenario: Cancellation after an earlier point committed
- GIVEN a completed first point and a second point generating within file-only scope
- WHEN the second request is cancelled or fails and a stale response arrives after a selection change
- THEN the first point remains, the second incomplete content is not captured, the active selection is unchanged and knowledge-library evidence never leaks into file-only scope.

### Requirement: R4-08 Recoverable additive migration (AC-16/19)
The system SHALL migrate schema 2 to 3 only after a consistent recoverable backup, atomically apply topic/supplement/index changes, preserve old records/configuration/frequency/credentials and idempotently reopen. Failed migration SHALL roll back and stop writes, while an unsupported newer schema SHALL be rejected. Old notes MUST NOT be rewritten or model-reclassified in bulk.

#### Scenario: Migration fault and retry
- GIVEN an isolated schema-2 database with edited knowledge, citations, uses and provider configuration
- WHEN a schema-3 migration fails mid-transaction then is retried after recovery
- THEN a consistent backup exists, the failure leaves version/data intact, and retry/reopen produces one valid migrated dataset
- AND old data remains readable/searchable with unchanged IDs, original content and credential identity.

## Revision 5 implemented requirements

### Requirement: R5-01 Qualified reusable knowledge (AC-01/08/14)
The system SHALL independently review planned candidates before presenting them as learnable knowledge. It SHALL retain reusable concepts, methods and practices, expose exclusion/uncertainty reasons, allow zero accepted points, and prevent unreviewed, rejected or uncertain candidates from automatic generation/capture. Non-knowledge answers SHALL remain viewable without automatic knowledge capture, including direct/related-generation paths.

#### Scenario: Resume facts mixed with technical practices
- GIVEN company names, dates, project names, responsibility statements and reusable technical methods
- WHEN planning and qualification complete
- THEN only qualified reusable points are learnable, with excluded reasons available
- AND an all-task input yields zero points instead of inventing one; review failure preserves local results without bypassing qualification.

### Requirement: R5-02 Relevant project context first (AC-03/05/08)
Project-dependent explanation SHALL request relevant project material and verify its sufficiency before generation. General conceptual explanations SHALL NOT assert facts about an unseen user project.

#### Scenario: Missing or irrelevant project material
- GIVEN a point about how the user's project implements a state machine
- WHEN no adequate related evidence is associated, including when unrelated files exist
- THEN the user is asked for specific material and the backend blocks project-specific generation
- AND adding supported files or snippets reevaluates adequacy without reading entire directories.

### Requirement: R5-03 Explicit public-example consent (AC-05/13/14/15)
Public-project search SHALL require explicit user permission bound to the current point, scope and visible query terms. Documents, models and ordinary learning actions SHALL NOT grant permission. Strict file-only scope SHALL remain closed to public sources until the user explicitly adds public-source permission for the current point and reconfirms the visible search terms.

#### Scenario: Stale or fabricated permission
- GIVEN an unconfirmed, cancelled, expired or different-point request
- WHEN a client or model attempts search or explanation using old consent
- THEN the backend rejects it without external project requests or capture
- AND late results cannot update another selection; committed results retain accurate reporting.

### Requirement: R5-04 Real bounded public-project evidence (AC-05/13/14/17)
After consent the system SHALL perform bounded read-only public GitHub repository/README retrieval, show at most three source-backed candidates and explain the selected example only after user selection. It SHALL preserve source URLs, positions, excerpts and retrieval time, distinguish examples from user-project facts, and never pass private project material into search queries implicitly.

#### Scenario: Retrieval unavailable or hostile
- GIVEN timeout, rate limit, no suitable result, malicious redirects or source instructions
- WHEN public-project lookup runs
- THEN it fails observably or returns verified retrieved candidates without retry, arbitrary host access, cloning or execution
- AND model memory cannot masquerade as retrieved evidence; public examples cannot become claims about the user's employment.

### Requirement: R5-05 Readable malformed bold without data loss (AC-01/14/16)
The reader SHALL conservatively repair unambiguous paired bold boundary whitespace in ordinary prose while preserving editable stored source, code, escapes, link targets, legitimate symbols, citations and existing active-content protections. It SHALL NOT delete symbols globally or rewrite old records.

#### Scenario: Screenshot-style malformed Markdown
- GIVEN `- **整体开发与设备接入： **独立负责` alongside code, escaped stars and references
- WHEN viewing the document
- THEN the prose label is bold without exposed formatting stars
- AND code/escapes and source editing remain unchanged, citations are usable and unsafe content remains blocked.

## Revision 6 implemented requirements

### Requirement: R6-01 Independent page contents and request ownership (AC-01/13/15)
Exploration, frequent, learning and archived sections SHALL have independent page contexts. Entering a bucket SHALL immediately show its own list/loading/empty view without exploration composer, directory, answer or recommendations. Filters, selections, scroll and reading state SHALL belong to each page; returning to exploration SHALL retain completed content and drafts. Unsaved note drafts SHALL NOT be silently discarded.

#### Scenario: Search in exploration, then switch with slow requests
- GIVEN exploration has search results and an answer, plus a pending list/detail request
- WHEN the user switches among all three frequency sections and returns
- THEN each initial view contains only that section's matched state, never old rows from another query/page
- AND late success/error/progress/cleanup cannot overwrite another page, clear a new request or navigate back to exploration
- AND precommit cancellation and completed-save reporting remain accurate, without deleting original files.

### Requirement: R6-02 Library-informed category and subcategory planning (AC-02/05/08)
Planning SHALL explicitly organize qualified points under category and subcategory. In an allowed library scope it SHALL prioritize semantically matching existing classification paths and related knowledge before inferring necessary new paths. Project-specific implementation SHALL remain distinct from reusable language/framework/method knowledge, with relationships rather than duplicate general concepts.

#### Scenario: Mixed project, C++ and Qt question
- GIVEN an existing library contains appropriate categories beyond the first six content hits
- WHEN planning a mixed question
- THEN the directory reuses relevant category/subcategory paths, infers missing classes as needed and displays concrete knowledge leaves
- AND project names may supply category context but are not knowledge leaves by themselves; unknown classification stays reviewable instead of forced merging.

#### Scenario: File-only scope and bounded context
- GIVEN file-only scope or a taxonomy exceeding the context budget
- WHEN building classification context
- THEN file-only planning does not read/send library taxonomy, while other scopes disclose actual summary coverage
- AND a partial set of note hits is not represented as full-library taxonomy.

### Requirement: R6-03 Compatible durable classification independent of usage buckets (AC-08/11/16/19)
New classifications SHALL survive capture, search, supplementation, restart and later planning without modifying usage-frequency policy. Existing flat themes, note identities and manual content SHALL remain compatible, with no automatic reclassification, movement or merging.

#### Scenario: Save hierarchical knowledge beside a legacy theme
- GIVEN legacy unstructured themes and a newly classified point
- WHEN saving, restarting and planning a later related question
- THEN the new category/subcategory remains available and reusable, and supplements retain the target classification
- AND legacy themes are preserved without guessed splitting, category-name delimiter characters remain unambiguous, and frequency buckets do not become classification categories.

## REMOVED Requirements

None.

## Authorized Development Version

### Requirement: DEV-01 Local version control and first test build
The development application SHALL identify itself as test0.01. Source and reproducible dependency locks SHALL be tracked in a local Git repository; generated dependencies, user data, secrets and build outputs SHALL remain excluded. The test delivery SHALL explicitly distinguish its verified behavior from outstanding full-v1 requirements.

#### Scenario: Review and start the first test version
- GIVEN the prepared development environment
- WHEN the application is built and started using the documented entry point
- THEN its UI identifies test0.01, local workflows operate, and Git retains a test0.01 source tag
- AND the README describes outstanding installation, OCR, semantic retrieval and real-provider validation

## Revision 7 contracts
- R7-01: Point generation and project material controls SHALL render in the right detail column, including before content exists.
- R7-02: Leaves and categories SHALL be selectable for one explicit batch. Saved points SHALL be skipped; failures SHALL remain visible without automatic retries; cancellation/page change SHALL prevent subsequent requests while preserving committed results.
- R7-03: One explicit material submission per visible project group SHALL process all pending points with the same selected documents, independently enforcing material relevance per point. Documents for another group SHALL NOT be implicitly selected.
- R7-04: Supplements SHALL remain uncommitted previews until explicit per-point review. Reading another point MAY preserve valid material evidence but SHALL revoke public consent. File/query/scope/page changes SHALL revoke project material permission.
- R7-05: Each frequency page SHALL offer only a question input and confirm button as its composer, using exploration planning/settings and independent draft/directory/reading state. Navigation and late results SHALL NOT leak page state.
