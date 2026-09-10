# Publishing Zasper

## For packagers

Zasper is open source, but I hold the trademark and prefer to manage its
distribution. If you would like to see Zasper on a package manager it is not on
yet, please open an issue first rather than publishing it — I am happy to discuss
it, and I would rather help than find out afterwards.

Everything below is the maintainer's runbook for cutting a release.

---

## Release runbook

### 1. Pre-release checks

Run the full suite. These are the same gates the release workflow runs, and
running them first turns a failed release into a failed command:

```sh
go build ./... && go vet ./... && go test -race ./...
npm --prefix ./ui ci
npm --prefix ./ui run typecheck
npm --prefix ./ui run test
make e2e                      # needs a Jupyter kernel installed; specs skip without one
goreleaser check              # validates .goreleaser.yml
goreleaser release --snapshot --clean --skip=publish   # proves the build end to end
```

Then:

- **Update `CHANGELOG.md`.** Add the new version, and an *Upgrading* section if
  anything changed that a user has to act on.
- **Check the docs.** `README.md`, `docs/API.md`, `PRIVACY.md` and
  `CONTRIBUTING.md` should describe what you are about to ship.
- **Check dependencies.** `go list -u -m all` and `npm --prefix ./ui outdated`.
- **Confirm the working tree is clean.** `make release` commits with `-a`.

### 2. Cut the release

One command does the whole thing — bump, sync, commit, tag, push:

```sh
make release TYPE=major     # 0.2.0-beta -> 1.0.0
make release TYPE=minor     # 1.0.0      -> 1.1.0
make release TYPE=patch     # 1.0.0      -> 1.0.1

make release TYPE=minor PRE_RELEASE=beta   # 1.0.0 -> 1.1.0-beta
```

`make show-version` prints where you are now.

Under the hood it writes `version.txt`, runs `scripts/sync-version.mjs` to copy
that version into `ui/package.json`, `snap/snapcraft.yaml` and the README, then
commits, tags `vX.Y.Z` and pushes both the branch and the tag.

The version lives in exactly one place — `version.txt` — and everything else is
generated from it. If you add another file that states the version, add it to
`scripts/sync-version.mjs` too; the script fails loudly when a pattern stops
matching, which is what keeps the copies honest.

### 3. What the tag triggers

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`, which:

1. **Verifies** — Go build and race tests, frontend typecheck, lint and tests,
   and `goreleaser check`. The release job does not start unless this passes.
2. **Releases** — GoReleaser builds macOS, Linux and Windows binaries, signs and
   notarizes the macOS ones, writes `checksums.txt`, publishes a GitHub Release,
   and updates the Homebrew tap.

A tag carrying a pre-release suffix is marked as a pre-release automatically.

### Required secrets

| Secret | Used for |
|---|---|
| `MACOS_SIGN_P12`, `MACOS_SIGN_PASSWORD` | Signing the macOS binaries |
| `MACOS_NOTARY_KEY`, `MACOS_NOTARY_KEY_ID`, `MACOS_NOTARY_ISSUER_ID` | Notarization |
| `HOMEBREW_TAP_TOKEN` | Pushing the formula to `zasper-io/homebrew-tap` |
| `POSTHOG_API_KEY` | Optional. Overrides the built-in analytics key; the built-in one is used when unset |

If the macOS secrets are absent, signing and notarization are skipped and the
rest of the release still succeeds.

---

## Distribution channels

### GitHub Releases

Automatic, on tag. Nothing to do.

### Homebrew

Automatic, on tag: GoReleaser writes the cask to
[zasper-io/homebrew-tap](https://github.com/zasper-io/homebrew-tap) using
`HOMEBREW_TAP_TOKEN`. This used to be a manual `url` and `sha256` edit.

### Snap

`.github/workflows/snap.yml` builds and publishes amd64 and arm64 snaps on tag.
It needs `SNAPCRAFT_STORE_CREDENTIALS` in the repository secrets, which you
generate with:

```sh
snapcraft export-login --snaps=zasper --acls package_access,package_push,package_update,package_release -
```

The snap's version comes from `snap/snapcraft.yaml`, which `make release` keeps
in step with `version.txt`.

### conda-forge

The [feedstock](https://github.com/conda-forge/zasper-feedstock) is published and
live. conda-forge's autotick bot usually opens a version-bump PR within a day of
a GitHub Release; if it does not, open one by hand updating `version` and
`sha256` in `recipe/meta.yaml` against the new release tarball.

### Docker

`docker/Dockerfile` builds an image from a release tag. Note that a container
must bind beyond loopback to be reachable, so the image passes `--host 0.0.0.0`;
run it with `--protected=true` if the port is exposed anywhere but your own
machine.

---

## Versioning

Zasper follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). From
1.0.0, the HTTP and WebSocket API documented in [docs/API.md](docs/API.md), the
`~/.zasper/config.json` format, and the command-line flags are the public
surface: they do not break within a major version.

- **Major** — an incompatible change to any of the above.
- **Minor** — new functionality, compatibly.
- **Patch** — fixes, compatibly.

Pre-releases are `X.Y.Z-alpha` and `X.Y.Z-beta`, cut with `PRE_RELEASE=`.
