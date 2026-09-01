# Zasper frontend

React + TypeScript, built with Vite. The Go binary embeds the production build
(`ui/build`, see `spa.go`), so `vite.config.ts` keeps `outDir: 'build'`.

```bash
npm install
npm run dev        # dev server on :3000, backend expected on :8048
npm run build      # -> ui/build, embedded by the Go binary
npx vitest run     # tests
npx tsc --noEmit   # type-check
npx eslint src
npx prettier --check "src/**/*.{ts,tsx,scss,css}"
```

## Layout

```
src/
  api/       one module per backend endpoint group, plus the wire types it returns
  auth/      the login screen
  ide/       the IDE itself — every component lives under here
  Routes/    route table
  store/     jotai atoms shared across features
  styles/    the global stylesheet layers (see styles/index.scss)
  themes/    theme definitions, as data
  config.ts  where the backend lives (build-environment config)
```

## Conventions

These exist because the codebase drifted away from each of them at least once, and
the drift was only visible in hindsight.

### Layering

`api/`, `store/`, `styles/` and `themes/` must not import from `ide/` or `auth/`.
The dependency runs one way: components depend on the API client, never the reverse.

A type's home follows the same rule. Anything the server sends or accepts is a wire
shape and lives beside the endpoint that returns it, in `api/`. Types that only
describe how a feature renders stay with the feature. `api/notebook.ts` (the nbformat
document) and `ide/editor/notebook/types.ts` (key events, the kernel handle) are the
worked example.

### Path aliases

`@/` resolves to `src/`. Use it whenever an import reaches outside its own feature
folder; keep `./` and `../` for siblings, where they read better than an absolute
path. The alias is declared twice — `paths` in `tsconfig.json` and `resolve.alias` in
`vite.config.ts` — and the two must agree. `tsc` only type-checks; Vite does the
resolving, so a mismatch surfaces at runtime rather than as a compile error.

### Component packaging

A component gets a folder as soon as it has more than one file; until then it is a
single `.tsx` beside its siblings. The entry file inside a folder is named after the
component (`FileBrowser/FileBrowser.tsx`), not `index.tsx`, so that stack traces and
editor tabs stay distinguishable. Import it explicitly: `./sidebar/GitPanel/GitPanel`.

Tests sit next to what they test, as `Subject.test.ts(x)`.

State that only one feature reads belongs to that feature (see
`ide/sidebar/FileBrowser/atoms.ts`); `store/` is for atoms genuinely shared across
features.

### Styles

There are no CSS modules — one global class namespace — so **ownership is by
convention and has to be stated.** A component's stylesheet is imported by that
component and may only define classes that component renders.

The moment a second component needs a rule, the rule moves into a layer under
`styles/` and is documented there. It does _not_ stay in the first component's file:
that file's name then gives no hint that anything else depends on it, which is how
`FileEditor.scss` ended up owning the app-wide CodeMirror overrides — a notebook-only
session never loaded them. `styles/index.scss` lists the layers and fixes their
order.

Two exceptions are fine, because both are self-announcing:

- Components in the same feature folder sharing that feature's stylesheet, the way
  the notebook's cell components share `NotebookEditor.scss`.
- Rules nested under a container class the shell renders, which is how
  `styles/_panel.scss` scopes the sidebar chrome to `.navigation`.

Colours never appear in a component stylesheet. They come from the `--z-*` custom
properties in `styles/_tokens.scss`, which is what makes a new component theme
itself correctly; themes are selected by `data-theme` on `<html>`.
