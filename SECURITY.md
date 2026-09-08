# Security Policy

## Supported versions

Tickle-stick is pre-1.0. Only the latest release on `main` is supported with
security patches. Fixes land on `develop` first and are promoted to `main`
via the `Promote Main` workflow.

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

Please report security vulnerabilities privately via email to
**team@kromatic.com** with the subject prefix `[tickle-stick security]`.
Do **not** open a public GitHub issue for security problems.

Include:

- A description of the vulnerability and its impact.
- Steps to reproduce (ideally a minimal failing test or PoC).
- Affected version or commit SHA.

We aim to:

- Acknowledge your report within 3 business days.
- Confirm the vulnerability (or explain why it isn't one) within 10
  business days.
- Ship a fix and public advisory within 30 business days of confirmation.

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
