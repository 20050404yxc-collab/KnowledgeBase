# Diagnostic requirements

- AC-01: Existing desktop and worker operations SHALL persist start/end/failure/cancellation and durations at meaningful boundaries. Scenario: a failed request produces correlated host and worker entries with source locations.
- AC-02: Session and request IDs SHALL correlate renderer, host and worker; spans SHALL identify nested steps. Scenario: concurrent async requests and parsing threads keep their own context; context is restored afterward.
- AC-03: Logs SHALL NOT store credentials, auth headers, full private paths, document/query/model bodies, arbitrary exception messages or SQL parameters. Scenario: synthetic private strings in chained exceptions, renderer reports and provider errors are absent from retained logs.
- AC-04: Each process SHALL own its rolling file under the existing data directory, with 5 MiB current file and five backups. Scenario: forced small-budget rotations retain parseable latest records and bounded files.
- AC-05: Diagnostic failures SHALL preserve original result/error/cancellation semantics. Worker stdout SHALL remain protocol-only; renderer diagnostic IPC SHALL validate origin and whitelist metadata.
- AC-06: Existing supported behavior SHALL pass `npm run check` and built desktop isolated `npm run test:ui`, including persistent-log correlation checks. Real-provider, native crash and abrupt-power-loss guarantees are excluded.
- AC-07: Chinese documentation SHALL explain locations, fields, retention and practical troubleshooting with explicit verification limits.
