# Security & Dependency Maintenance Posture

Last reviewed: 2026-11-15. Next scheduled review: **2027-02-15**.

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

Current majors of note (as of 2026-11-15, from `package-lock.json`): `yaml` 2.x (2.9.1), `zod` 4.x (4.6.7), TypeScript 6.x (6.0.3), ESLint 10.x (10.14.0, flat config), Vitest 5.x (5.1.0), Node >=22 (`engines.node`; CI tests Node 22 and 24).

### 3.3 Quarterly review checkpoint

The watch-only review cadence is **quarterly** (next: 2027-02-15). At each checkpoint:

1. Review moderate/low `npm audit` findings. High and critical findings already fail CI (§4.1).
2. Skim the `yaml` and `zod` changelogs for parser / validation behavior changes that may affect consumers.
3. Confirm `files` in `package.json` still ships only the intended subset (no test fixtures, no .env, no internal docs).
4. Confirm `release.yml` uses pinned action SHAs (or at least pinned tags) for the npm publish step.
5. Re-read `SECURITY.md` §"Scope" against the current code — are there any new threat-surface classes the library has grown into that should be documented?

#### 2026-11-15 review notes

1. **`npm audit`:** full audit reports 8 moderate, 0 low/high/critical, all one chain: minimatch 10.2.6 (GHSA-g3hv-75wg-m249, DoS via globparts amplification) reached through `eslint`, `@eslint/config-array` and `@typescript-eslint/*`. `npm audit --omit=dev` reports 0 vulnerabilities. Disposition: accepted. Dev tooling only, not in the published tarball, below the CI `--audit-level=high` gate; npm's only offered fix is a breaking downgrade to `@typescript-eslint/parser` 6.15.0, so wait for a patched upstream release.
2. **`yaml` / `zod` changelogs:** nothing to skim. The locked versions are identical at v0.6.7 and now (`yaml` 2.9.1, `zod` 4.6.7); only the declared `zod` floor moved (`^4.6.6`, GHSA-mrhx-c7xc-m3w5), with no resolved-version change.
3. **Published `files`:** `npm pack --dry-run` lists 93 files, all under `dist/` (including `.map` files), `src/`, plus `README.md`, `LICENSE` and `package.json`. No tests, fixtures or `.env`.
4. **`release.yml` pins:** both actions are pinned to full SHAs (`actions/checkout` v7.0.1, `actions/setup-node` v7.0.0). The setup-node version is template-owned (code-workspace-config `templates/release-npm.yml` pins the same v7.0.0 SHA); any skew against v7.1.0 is fixed in the template, not here. Not edited.
5. **`SECURITY.md` Scope:** re-read against current code; the five listed classes still match (spawn with argv arrays, item-text prompt handling, `$file:` containment in `src/config/loader.ts`, host-supplied storage adapters, `apiKey` option). No new threat-surface class found.

## 4. What CI already enforces

Verify under `.github/workflows/`:

- **`ci.yaml`** — primary CI gate Dependabot PRs must satisfy before auto-merge fires. It includes the `npm audit` gate (§4.1).
- **`release.yml`** — publishes the tarball to npm. Keep the actions used here patched.

Consider in a follow-up:

- **CodeQL** for static analysis of the published surface.

### 4.1 Authoritative vulnerability signal: the CI `npm audit` gate

**The `npm audit --audit-level=high` step in `ci.yaml` is the authoritative dependency-vulnerability signal for this repo** (operator ruling 2026-11-15, tickle-stick#280). It audits the real `package-lock.json` across the full dependency tree, dev dependencies included, because they run in CI. It runs once per CI run, on the primary Node version, and fails the job on any high or critical advisory. A red audit step on a PR or on `develop` is a real finding: fix it there.

**Dependabot alerts are secondary while GitHub's dependency graph is stale.** The graph for this repo is stuck at an April 2026 snapshot (the SBOM endpoint returns 404), so alerts can cite package versions that are no longer installed. Triage rule:

- **An alert whose cited version is not in `package-lock.json` is dismissed as inaccurate, with no fix attempt.** Check the lockfile, not the alert. Dismiss with reason "inaccurate" and a comment naming the version that is actually locked.
- An alert whose cited version **is** in the lockfile is real. The `npm audit` gate should already be red for it at high/critical, so fix it the normal way.

Dependabot security updates and secret scanning / push protection stay enabled as secondary signals. Getting GitHub to re-ingest the graph is not pursued.

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
