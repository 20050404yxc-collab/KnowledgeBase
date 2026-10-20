# Spec Deltas

## Purpose

Define the planned observable behavior of the personal knowledge desktop agent. These are reviewable requirements for revision 2, preserving individually confirmed user decisions without claiming implementation or full-plan approval. Library candidates and implementation details belong in design.md.

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

None. The workspace contained no existing implementation baseline.

## REMOVED Requirements

None.
