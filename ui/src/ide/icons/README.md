# Icons

One icon set, one size, and one place a glyph is chosen.

| File           | What it is                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `icons.ts`     | The table. Every glyph the app can draw, keyed by its Lucide name, with a comment saying what each one took over from. |
| `Icon.tsx`     | The only way an icon reaches the screen. Takes a name from the table and a size.                                       |
| `FileMark.tsx` | What stands in front of a file name: a coloured two- or three-letter mark, or an icon where letters would say nothing. |
| `index.ts`     | The public surface. Import from `@/ide/icons`, never from a file in here.                                              |

## Why there is a table

Before this, an icon was one of four unrelated things depending on where it stood:

- a **Font Awesome** glyph — 30 classes at 51 sites, out of a 232KB webfont. Being a font, it took
  `color` and `font-size` and nothing else, so a 12px `<i>` and a 16px `<img>` sat side by side in
  the same toolbar.
- an **`<img>`** from `public/images/editor/`, drawn from four different icon sets, with intrinsic
  widths from 2.927px to 2500px and one file declaring no width at all. 21 of the 30 had a `fill`
  baked into the file, which is why a selected row faked white with `filter: brightness(500%)` and a
  light-chrome theme needed `--z-filter-chrome-icon: invert(1)`.
- an **inline SVG component** in this directory — seven of them, 122 lines of path data at seven
  different `viewBox`es.
- a **brand logo**, which still is one: the topbar wordmark has its colour baked in, so a theme picks
  the file with `--z-logo`.

Lucide replaces the first three. It is stroked with no fill, so `.z-icon` sets
`stroke: currentColor` once in `_base.scss` and an icon is the colour of the row, button or banner it
sits in. That is the whole gain: a white panel, the purple project banner and a selected row need no
rule between them.

Two conventions worth keeping:

- **Keys are Lucide's own names, not roles** — `square`, not `interrupt`. A role reads better at the
  call site, but two roles wanting the same glyph quietly become two entries that drift apart, and the
  button already carries the words.
- **Stroke width is 1.5, not Lucide's 2.** At 16px in a 22px row a 2px stroke reads as bold, which is
  what the Font Awesome solids looked like and the reason the toolbars drew the eye first.

## Accessibility

`Icon` is always `aria-hidden`. An icon here is never the label — the control around it carries the
words, as a `title`, an `aria-label`, or visible text, which is also what a tooltip needs.

Where an icon _is_ the information rather than a decoration, the call site says so. The read-only lock
in the file tree is the one case:

```tsx
<span className="rowFlag" role="img" aria-label="Read-only" title="Read-only">
  <Icon name="lock" size={12} />
</span>
```

## Marks, not a second icon set

A file's type is a **mark**: `py`, `ipy`, `{}`, `tsx` — 9px monospace lettering in the same 18px box a
folder icon uses (`.file-mark` in `_controls.scss`). One set at one size, which was the part that was
actually wrong before rather than the colour.

Colour is the language's own, from GitHub's linguist palette, darkened until it clears 4.5:1 on
`--z-bg-panel` — see `--z-mark-*` in `_tokens.scss`, where each token records the original and its
failing ratio. A hue only earns a token if it is the language's and people know it; prose, config and
shell scripts take `--z-fg-subtle`, so colour that means nothing does not compete with colour that
does. Nothing here derives from `--z-accent`: these say what a file _is_, and must not move when the
brand colour does.

The honest cost of colouring them: two surfaces fill with the accent and a language hue on top reads
at about 2:1, so a hovered or open tree row and a tab override the mark to `currentColor`. That is
three rules in total, and every other surface needs none — the marks are text, and text inherits.

## Adding one

1. Add the Lucide import and one line to `ICONS` in `icons.ts`, in the group it belongs to.
2. Use it: `<Icon name="your-name" />`. `IconName` is a union of the table's keys, so a typo is a type
   error rather than an empty box.

For a new file type, add a row to `MARKS` in `FileMark.tsx` — an object for a mark, or the name of an
icon from the table where lettering would only repeat the file name (`img` in front of `plot.png`
says nothing twice). A new `kind` also needs its `--z-mark-*` token in both theme blocks and a
`.file-mark-<kind>` rule; reuse an existing kind if the language already has a colour.
