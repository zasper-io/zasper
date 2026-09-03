# Browser end-to-end tests

Playwright specs that drive the built app against the built server. Everything else in this repo tests
one side on its own: the vitest suites under `ui/` mock `@/api` and CodeMirror, and the Go tests call
handlers directly. These are the tests that would have caught a button rendering 0px wide, or a save
that reached a file nobody was reading.

The Go half of the same idea — journeys over the real route table, with real kernels and no browser —
lives in `internal/server/e2e_test.go` and `internal/server/kernel_e2e_test.go` and needs none of this.

## Running them

```sh
npm install                 # once, in this directory
npx playwright install chromium

cd ../ui && npm run build   # the server embeds ui/build; a stale build tests a stale app
cd ../e2e && npx playwright test
```

`npx playwright test --ui` for the interactive runner, `npx playwright test tests/notebook.spec.ts` for
one file, and `npx playwright show-report` after a failure. `make e2e-browser` from the repo root does
the frontend build and the install too; `make e2e` adds the Go half.

Both halves run on every pull request — see [.github/workflows/e2e.yml](../.github/workflows/e2e.yml),
where CI installs `ipykernel` so that nothing skips.

The server is built and started for you (see `playwright.config.ts` and `prepare.cjs`) on port 8099, so
a `make dev` on 8048 can keep running alongside.

## What a run touches

Nothing outside `e2e/.tmp/`, which is rebuilt from scratch every time:

- `.tmp/home` is the server's `$HOME`, so `~/.zasper/config.json` — the settings your own server is
  using — is never read or written.
- `.tmp/project` is a copy of `fixtures/project`, and is the directory the server is started in. Both
  its `-cwd` and its working directory, because a notebook save resolves its path against the latter.
- `.tmp/zasper` is the binary, built without `-tags apiserver` so that it serves the frontend.

A throwaway `$HOME` is also a `$HOME` with no Jupyter kernelspecs in it, so `prepare.cjs` copies one
runnable Python kernelspec in. That is what makes the Launcher offer exactly one kernel on every
machine; with none installed anywhere, the specs that need a kernel skip rather than fail.

## What is covered

| Spec | Journey |
| --- | --- |
| `boot` | the app loads, the tree is the project the server was started in, the console is clean |
| `filebrowser` | create, rename, delete — on screen and on disk |
| `notebook` | a cell runs against a real kernel, and its output survives a save and a reload |
| `tabs` | closing an unsaved tab asks, and all three answers do what they say |
| `palette` | a real `Ctrl-Shift-P`, a filter, and the command runs |
| `terminal` | a real shell in the project directory |
| `layout` | every control is big enough to click and no row overflows its panel |

## House rules

- **No `waitForTimeout`, and no retries.** Playwright locators wait for what they assert on. A spec
  that only passes the second time is a missing await, and `retries: 0` keeps it that way. The one
  place a click is retried is the first run of a notebook cell, where the kernel may not have finished
  connecting; the comment there says why that is a wait and not a sleep.
- **Accessible handles first**: `getByRole`, `getByTitle`, `getByLabel`. There is no `data-testid` in
  the app at present, and anything added should be listed in the PR that adds it.
- **Assert on disk as well as on screen** for anything that claims to have changed a file. A row that
  says the right thing over a file that was never touched is exactly the failure worth catching.

## Not this

The CDP script that found the 0px button is not here and should not be. It has no assertions, sleeps
2500ms after every navigation, and needs a Chrome somebody started by hand on `:9222` — a useful probe,
and the wrong thing to hand a contributor. What it did by eye, `tests/layout.spec.ts` does by
measurement.
