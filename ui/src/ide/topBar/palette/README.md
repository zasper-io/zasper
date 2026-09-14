# Palette

One search box for the whole app: commands and files, in two sections of one list.

```
┌ Search files, or > for commands ─────────────────┐
│ COMMANDS                                6 of 31  │  capped while it shares the list
│   Increase Font Size   View        ⌘=  ⌘+        │  label · description · chord
│   Stage All Changes    Stage every change…       │
│ FILES                                            │
│   increase.md                                    │  a root file is its own path
│   table.csv            data/table.csv            │  name · where it is
└──────────────────────────────────────────────────┘
```

## Why one widget

There were two: a command palette on `Mod-Shift-P` and a file search on `Mod-Shift-O`, each with its
own box, its own placeholder and its own list, both drawn in the same 600px slot in the topbar. That
made the first thing you had to decide the thing you were least sure about — whether what you wanted
was a command or a file — and the visible search box in the topbar only ever opened the file half, so
the commands were reachable by chord alone.

Now both chords and the button open the same palette; they differ only in what is already in the field.
`Mod-Shift-P` (and `Ctrl-Shift-P`) types `>`, which is the muscle memory from every other editor and
narrows the list to commands. `Mod-Shift-O` and the topbar button open it empty, which searches both.

## The rules

**Commands first, files under them.** Commands are filtered in the browser and appear on the keystroke;
files come from a walk of the project on the server. Putting the commands above means an answer landing
late cannot move the row Enter is about to run.

**A section is capped at six while it shares the list**, and its heading then says `6 of 31` rather
than quietly dropping the rest. Without the cap, a two-letter query matching thirty commands pushes
the files below the fold — which is the merge not working. `>` is uncapped, because listing the whole
registry is what that mode is for. `.palette-list`'s height in [Palette.scss](Palette.scss) is set to
fit both sections at full stretch, so nothing that got past the cap needs scrolling to.

**An empty query lists nothing**, unless it is `>` alone. From the search box an empty field is a
question not yet asked, and answering it with the first six commands in registration order is noise.

**A file opens through `openTab`**, the call the file browser makes, so a file that is already open
comes forward instead of being loaded twice. The palette used to write `fileTabsAtom` itself, with its
own copy of what a new tab needs.

**A command that cannot run is dimmed, not hidden** — "Restart Kernel, greyed out" answers the question
that a missing row only raises — and its chord is rendered from the same binding strings the keyboard
dispatches, so the two cannot disagree.

## The files

| File                                   | What is in it                                                    |
| -------------------------------------- | ---------------------------------------------------------------- |
| [Palette.tsx](Palette.tsx)             | The field, the two sections, the caps, and what Enter does.      |
| [useFileMatches.ts](useFileMatches.ts) | The file half: debounced, cached, and deaf to abandoned answers. |
| [Palette.scss](Palette.scss)           | The floating panel, the rows, and the section headings.          |

Outside this directory: [Topbar.tsx](../Topbar.tsx) owns whether it is open and with what — one
`string | null`, because the two chords are one palette — and registers _Show All Commands_ and _Go to
File_ as commands like any other. [Topbar.scss](../Topbar.scss) styles `.palette-input`, deliberately:
it stands exactly on top of `.openCommandPaletteButton`, and two sets of declarations for one box drift
apart. `searchFiles` in [api/search.ts](../../../api/search.ts) is the typed client for `GET /api/files`,
which matches case-insensitively so that both halves of one query agree about what was asked.

## Tests

```sh
npx vitest run src/ide/topbar          # from ui/
npx playwright test palette.spec.ts    # from e2e/, after `npm run build` in ui/
```

[Palette.test.tsx](Palette.test.tsx) mocks `@/api` and renders in a jotai `Provider` of its own, so the
tabs one test opens are not the tabs the next one reads: filtering on label and on category, the
keyboard, Enter and click on both kinds of row, the disabled row, the chord display, the caps and their
counts, `>` leaving the files alone, the empty query listing nothing, and a failed search leaving the
commands in place.

[e2e/tests/palette.spec.ts](../../../../../e2e/tests/palette.spec.ts) is the part no mock reaches: the
chord arriving at the window, and one query answered by a command and a real file on disk at once.
