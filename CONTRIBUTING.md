# Contributing to Tickle-Stick

Thank you for your interest in contributing!

## Development setup

1. Fork and clone the repository.
2. Install dependencies: `npm ci`.
3. Build: `npm run build`.
4. Run the test suite: `npm test`.
5. Run the linter: `npm run lint`.
6. Typecheck: `npm run typecheck`.

All four of `build`, `test`, `lint`, and `typecheck` must pass locally before
you open a pull request — CI runs the same matrix on Node 20 and 22.

## Reporting issues

Please use [GitHub Issues](https://github.com/Kromatic-Innovation/tickle-stick/issues)
to report bugs or request features. Include:

- Node version and OS.
- A minimal reproduction (ideally a failing Vitest test or a 10-line script).
- Expected vs. actual behaviour.

## Branch naming

- Feature work: `feat/<short-topic>` (e.g. `feat/parallel-stage-execution`).
- Bug fixes: `fix/<short-topic>`.
- Chores / docs / CI: `chore/<short-topic>` or `docs/<short-topic>`.

## Pull requests

- Open PRs against the `develop` branch. Never open a PR directly against
  `main` — `main` is the release branch and is only updated via the
  promotion workflow.
- Include tests for new functionality. Tests live in `test/` and mirror
  the `src/` layout.
- Ensure all existing tests pass and lint/typecheck are clean.
- Follow the existing code style (TypeScript strict mode, Zod-derived types,
  structured JSON logging — no `console.log` in production code).
- PR titles use the [Conventional Commits](https://www.conventionalcommits.org/)
  format (e.g. `feat: add stage retry policy`, `fix: handle empty script output`).

## Commit conventions

Use Conventional Commits for individual commits where practical. The squash
title on merge is what lands in history, so the PR title matters more than
each intermediate commit.

## License

By contributing, you agree that your contributions will be licensed under
the MIT License.
