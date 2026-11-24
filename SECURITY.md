# Security Policy

## Supported versions

Tickle-stick is in maintenance mode and 0.7.1 is the final release. No further
releases are planned, so there is no supported-version window and no
security-patch commitment. Reports are handled on a best-effort basis; if a
fix is made, it lands on `develop` first and is promoted to `main` via the
`Promote Main` workflow, but it is not guaranteed to be published to npm.

### Dependabot alerts closed without a fix

Some Dependabot alerts on this repo are closed as `moscow:wont` rather than
patched. These are **dev-toolchain-only** findings — they affect packages used
to build and test tickle-stick, not anything shipped in the published artifact.
The npm package contains only `dist`, `src`, `README.md`, and `LICENSE`
(see `files` in `package.json`), and `npm audit --omit=dev` reports zero
vulnerabilities against it.

If you find an alert that you believe *does* reach the published package,
treat that as a vulnerability report and use the process below — a
misclassified alert is exactly the kind of thing we want to hear about.

## Reporting a vulnerability

Please report security vulnerabilities privately, and do **not** open a public
GitHub issue for security problems:

- Preferred: use GitHub's
  [private vulnerability reporting](https://github.com/Kromatic-Innovation/tickle-stick/security/advisories/new)
  for this repository.
- Alternative: use the contact form at <https://tristankromer.com>, and start
  your message with `[tickle-stick security]`.

Include:

- A description of the vulnerability and its impact.
- Steps to reproduce (ideally a minimal failing test or PoC).
- Affected version or commit SHA.

Reports are handled best-effort, with no response-time commitment. If you need
a fix you can rely on, or want to take over the package, use the contact form
above.

## Scope

Tickle-stick orchestrates scheduled agent pipelines that execute host-supplied
shell commands, host-supplied callbacks, and host-supplied HTTP calls to
model providers. Security-relevant areas include:

- **Command injection** via `StageConfig.command` / `args` / `postHook`.
  Tickle-stick uses `child_process.spawn` with explicit argv arrays (no
  shell interpolation). Reports against that boundary are in scope.
- **Prompt injection** against the `TriageProvider` classify contract and
  the `{{items}}` interpolation in expensive-model stages.
- **Path traversal** via YAML config paths or script stage arguments.
- **Storage adapter injection** — the budget persistence layer accepts
  host-supplied queries; we expect callers to parameterise.
- **API key handling** — `HttpTriageProvider` accepts an `apiKey` option.
  We expect callers to source keys from their own secret stores; never
  embed keys in checked-in config or logs.

## Out of scope

- Vulnerabilities in OpenAI / Anthropic APIs (report upstream to the vendor).
- Vulnerabilities in direct dependencies (`yaml`, `zod`) — report upstream.
- Social-engineering attacks against maintainers or downstream adopters.
