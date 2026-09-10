# Privacy

Zasper sends a small amount of anonymous usage data. It is what tells me whether anyone is using
Zasper and which parts of it they use, which is most of what decides where the next release goes.

This document is the complete list. If something is not on it, Zasper does not send it.

## What is never sent

- Your name, your username, your email, or your machine's hostname
- File names, folder names, file paths, or your project's name
- The contents of any notebook, cell, file, or terminal
- Git branch names, remote URLs, commit messages, or diffs
- Kernel or environment names, which are often named after a person or a client
- Your IP address — every event carries `$ip: ""` and `$geoip_disable: true`, which tells PostHog to
  discard the source address rather than store it or look up a location from it

There is no session recording, no autocapture, no cookie, and no third-party script in the app.
Nothing is read from your browser's storage for this.

## What is sent

Every event carries the same six properties: your anonymous ID, the Zasper version, your OS
(`darwin`, `linux`, `windows`), your CPU architecture, `source: web`, and a timestamp. The PostHog
Go library adds its own name and version, the Go version Zasper was built with, and the OS version.

| Event | When | Properties |
|---|---|---|
| `server_started` | The server starts | — |
| `server_shutdown` | The server stops | `uptime_bucket` |
| `notebook_opened` | A notebook is opened in a new tab | — |
| `file_opened` | A file is opened in a new tab | `extension` |
| `code_cell_executed` | A cell is sent to a kernel | `kernel_language` |
| `kernel_started` | A notebook gets a kernel | `kernel_language`, `reused` |
| `kernel_start_failed` | A kernel could not be started | `kernel_language` |
| `kernel_interrupted` | A kernel is interrupted | `kernel_language` |
| `terminal_opened` | A terminal's shell starts | — |
| `terminal_closed` | A terminal's shell exits | `duration_bucket` |
| `git_operation` | A git action succeeds | `operation` |
| `command_executed` | A command runs, from the palette, a key, or a button | `command_id` |
| `theme_changed` | You pick a theme in Settings | `theme_id` |

And the values those properties may take:

- **`extension`** — one of about sixty known extensions (`py`, `ipynb`, `csv`, …), or `none` for a
  file without one, or `other`. A name is mapped onto that list, never checked against it, so
  `q3-forecast-acme.xlsx` is reported as `other` and nothing else.
- **`kernel_language`** — `python`, `r`, `julia`, `go`, `javascript`, `typescript`, `scala`, `ruby`,
  `rust`, `bash`, `sql`, `haskell`, or `other`. Mapped from the kernelspec name the same way, so a
  conda environment named after you reports `other`.
- **`operation`** — `stage`, `unstage`, `discard`, `commit`, `checkout`, `branch_delete`, `fetch`,
  `pull`, `push`, `init`. Read-only git calls are not counted at all.
- **`command_id`** — the command's own id, such as `notebook:run-cell-and-advance`. These are
  identifiers written in Zasper's source, never anything you typed.
- **`theme_id`** — one of the eight themes that ship with Zasper.
- **`uptime_bucket`, `duration_bucket`** — a range rather than a number: `0`, `1`, `2-5`, `6-10`,
  `11-25`, `26-50`, `51-100`, `100+`, in minutes.

## Your anonymous ID

A random 21-character string, generated on first run and stored in `~/.zasper/config.json` as
`tracking_id`. It is not derived from anything about you or your machine — it is random, and it
identifies an installation so that ten events from one person are not counted as ten people.

You can throw it away at any time: **Settings → Privacy → Reset anonymous ID**. That generates a new
one and breaks the link between what has already been sent and what is sent next.

## Turning it off

Any one of these is enough, highest precedence first:

1. `zasper --tracking=false`
2. `ZASPER_TELEMETRY=0` in the environment
3. **Settings → Privacy → Send anonymous usage data**, which stores the choice in
   `~/.zasper/config.json` as `telemetry_enabled`

With tracking off, no client is created and no request is made — the data is not collected and
discarded, it is never collected. The first two are per-run and outrank the setting, so a session
started with either of them cannot be switched back on from the UI.

The first time Zasper runs, it says in a notice and in the startup banner that this is happening.

## Where the data goes

To PostHog Cloud (US region, `us.i.posthog.com`), under
[PostHog's data processing agreement](https://posthog.com/dpa). PostHog acts as the processor; I am
the controller. Because your IP is discarded on receipt and the ID is random, the data is not
associated with an identifiable person.

## How this is enforced

Not by convention. `internal/analytics/events.go` holds a catalogue of every event and every
property it may carry, and every value is either one of a fixed set of strings, a bucket label, a
boolean, or a command id matching `^[a-z][a-z0-9]*:[a-z0-9-]{1,32}$`. There is no free-text property
type anywhere in it. An event that does not fit is rejected whole and logged, never trimmed and
sent.

The frontend does not get to bypass this. It posts events to `/api/telemetry`, which puts them
through the same catalogue before anything is queued.

Three tests keep it that way, in `internal/analytics`:

- `TestNoPropertyAcceptsFreeText` feeds a file path into every property in the catalogue and fails
  if any of them takes it.
- `TestNothingIdentifyingReachesTheWire` runs the real client against a local recorder and searches
  the actual bytes for anything identifying.
- `TestDisabledSessionMakesNoRequests` asserts that a session with tracking off makes no requests.

To see the payload for yourself:

```
DUMP=1 go test -run TestNothingIdentifying ./internal/analytics/ -v
```

## Questions

Open an issue, or email prasun@zasper.io.
