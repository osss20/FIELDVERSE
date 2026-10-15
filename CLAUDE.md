# FIELDVERSE

GitHub repository: https://github.com/osss20/FIELDVERSE (public, default branch `main`).
Live site: https://osss20.github.io/FIELDVERSE/ — deployed by `.github/workflows/deploy-pages.yml` after checks pass on every push to `main`.
This is the only remote for this project. Do not push FIELDVERSE work to any other repository.

## Git workflow

- Every commit must reach GitHub. `.githooks/post-commit` runs `git push --set-upstream origin <branch>`
  after each commit. It is active when `git config core.hooksPath` is `.githooks`; after a fresh clone run:
  `git config core.hooksPath .githooks`
- After committing, confirm the push: `git status -sb` must show no `ahead`, and
  `git rev-parse HEAD` must equal `git rev-parse origin/<branch>`. Never report a commit as pushed without this check.
- Never force-push or rewrite published history. If a push is rejected, `git pull --rebase`, re-run checks, then `git push`.
- Before committing, review `git diff --staged` for secrets, `.env` files, build output, and unrelated files.
- Commit coherent, tested units of work, not every small edit. Run `npm run check` (typecheck, lint, tests, build) first; it must pass.
- At the end of a task, report: changes, tests run, commit hash, and push status.
