# Security & Dependency Maintenance Posture

Last reviewed: 2026-05-13. Next scheduled review: **2026-08-13**.

This document records the **maintenance posture** for `tickle-stick` — how dependency upgrades flow, what the auto-merge gate covers, and what the quarterly review checklist looks like. The **vulnerability-reporting policy** lives in [`SECURITY.md`](../SECURITY.md) at the repo root; that file is the public-facing entry point for security reporters. This document is the internal maintenance counterpart.

## 1. Distribution shape (the load-bearing fact)

`tickle-stick` is an **OSS npm library** published to npm under the MIT license. It is not a service. The "deployment shape" is the npm tarball:

- Consumers install `tickle-stick` and import from the published `dist/` (compiled from `src/`).
- The library orchestrates scheduled agent pipelines that execute host-supplied shell commands, host-supplied callbacks, and host-supplied HTTP calls to model providers — see `SECURITY.md` §"Scope" for the canonical threat-surface enumeration.
- The runtime dependency surface is tiny: `yaml` (config parser) and `zod` (input validation).
- DevDependencies (TypeScript, ESLint, Vitest) are build- and test-time only.

### What this means for CVE exposure

The threat surface tracked by `SECURITY.md` (command injection, prompt injection, path traversal, storage adapter injection) is mostly **in this repo's own code**, not in dependencies. CVE-driven exposure is concentrated in two packages:

| CVE class                                          | Reachable here?                              | Why                                                                                                                                |
| -------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `yaml` parser CVEs                                 | **Yes**                                      | Every consumer that loads a `StageConfig` from YAML reaches this parser. Patch promptly.                                           |
| `zod` validation-bypass CVEs                       | **Yes — critical**                           | Every input that crosses the public API is validated by `zod`. A bypass is an injection vector for downstream consumers.           |
| TypeScript / ESLint / Vitest CVEs                  | Build-time only                              | These don't ship in the published tarball; treat as standard dev-tool patches.                                                     |
| GitHub Actions used in `ci.yaml` and `release.yml` | CI/release-time only                         | A compromised action could publish a malicious tarball — keep these patched and pinned (Dependabot covers `github-actions` here).  |

## 2. What this library does and doesn't do

| Surface                                              | Present?                                  | Notes                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User-generated content rendered as HTML              | No                                        | Library, not a UI.                                                                                                                                                                                                                     |
| HTTP server                                          | No                                        | The library makes outbound HTTP calls to model providers; it does not accept inbound HTTP itself.                                                                                                                                       |
| Database                                             | No (storage adapters are host-supplied)   | The budget persistence layer accepts host-supplied storage adapters — adapter-implementation bugs are in scope of `SECURITY.md` §"Scope". The library itself ships no DB driver.                                                       |
| File system access                                   | **Yes**                                   | `StageConfig` paths can reach the file system. `SECURITY.md` §"Scope" tracks the path-traversal class. `$file:` config references are contained to the config-directory subtree (escapes via `..` or absolute paths throw).             |
| Process execution                                    | **Yes**                                   | `child_process.spawn` with explicit argv arrays (no shell interpolation). `SECURITY.md` §"Scope" tracks command injection.                                                                                                              |
| Outbound LLM calls                                   | Indirect (via host-supplied providers)    | Prompt injection is in scope of `SECURITY.md`.                                                                                                                                                                                          |
| Secrets in published tarball                         | Must remain No                            | Confirm `files` in `package.json` does not pull anything that could leak a secret. Currently: `dist`, `src`, `README.md`, `LICENSE` only.                                                                                                |

## 3. Dependency-upgrade policy

This repo follows the workspace **maintenance-posture playbook** originally documented in `plinkromatic/docs/security-posture.md`, tightened for the OSS library surface.

### 3.1 Patch and minor bumps (Dependabot)

Auto-merge is wired in `.github/workflows/dependabot-auto-merge.yml`. The policy:

- **All patch updates** auto-merge when CI is green (`ci.yaml` runs lint + typecheck + vitest).
- **Minor updates** auto-merge **except** when the PR touches a hold-list package. Current hold list:
    - `yaml` — the config parser; a behavior shift here silently changes how every consumer parses `StageConfig`.
    - `zod` — the validation library; a behavior shift silently changes what inputs the public API accepts.
- **Major updates** never auto-merge — see §3.2.

The hold list is intentionally tight because the dependency surface is tiny. When a new production-runtime dep is added, append it here and to the workflow's `HOLD_LIST` in the same PR.

### 3.2 Major version bumps

Closed by default. Disposition is one of:

- **Take the patch via a sibling minor/patch** if the same vulnerability is fixed there.
- **Schedule a focused upgrade PR** — major bumps to `yaml` or `zod` are user-facing API changes for consumers and deserve a CHANGELOG entry.
- **Close** with a comment citing this document and a re-open trigger.

Current majors of note (as of 2026-05-13): `yaml` 2.x, `zod` 4.x, TypeScript 5.7, ESLint 9 (flat config), Vitest 3.

### 3.3 Quarterly review checkpoint

The watch-only review cadence is **quarterly** (next: 2026-08-13). At each checkpoint:

1. Re-run `npm audit` and review high+/critical findings.
2. Skim the `yaml` and `zod` changelogs for parser / validation behavior changes that may affect consumers.
3. Confirm `files` in `package.json` still ships only the intended subset (no test fixtures, no .env, no internal docs).
4. Confirm `release.yml` uses pinned action SHAs (or at least pinned tags) for the npm publish step.
5. Re-read `SECURITY.md` §"Scope" against the current code — are there any new threat-surface classes the library has grown into that should be documented?

## 4. What CI already enforces

Verify under `.github/workflows/`:

- **`ci.yaml`** — primary CI gate Dependabot PRs must satisfy before auto-merge fires.
- **`release.yml`** — publishes the tarball to npm. Keep the actions used here patched.

Consider in a follow-up:

- **`npm audit` scheduled scan** for advisory surfacing beyond Dependabot.
- **CodeQL** for static analysis of the published surface.

## 5. Coverage snapshot (for hold-list calibration)

Tests run via `vitest`. Auto-merge eligibility on a minor update presumes those tests catch a regression. Given the tiny dep surface, even a minor bump to `yaml` or `zod` may shift parser/validator behavior in ways the test tier can't fully assert — hence both stay on the hold list.

## 6. Pointers

- **Vulnerability-reporting policy**: [`SECURITY.md`](../SECURITY.md) (top-level, public-facing).
- Workspace maintenance posture origin: [plinkromatic#371](https://github.com/Kromatic-Innovation/plinkromatic/issues/371) and `plinkromatic/docs/security-posture.md`.
- Contributing: [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- Code of conduct: [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md).
- Changelog: [`CHANGELOG.md`](../CHANGELOG.md).
- This repo's auto-merge workflow: `.github/workflows/dependabot-auto-merge.yml`.
- Dependabot grouping config: `.github/dependabot.yml`.
- CI workflow: `.github/workflows/ci.yaml`.
- Release workflow: `.github/workflows/release.yml`.
