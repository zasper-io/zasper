# A bare `make` lists the targets rather than running whichever happens to come first.
.DEFAULT_GOAL := help

# Verion Variables
VERSION_FILE = version.txt
TAG_PREFIX = v
DEFAULT_VERSION = 0.0.1
MAJOR_BUMP = major
MINOR_BUMP = minor
PATCH_BUMP = patch
ALPHA_SUFFIX = -alpha
BETA_SUFFIX = -beta
TAG_REGEX = '^[0-9]\+\.[0-9]\+\.[0-9]\+$$'  # Regex to match semantic version format (X.Y.Z)

# Get the current version from version.txt or set to default if file does not exist
CURRENT_VERSION = $(shell if [ -f $(VERSION_FILE) ]; then cat $(VERSION_FILE); else echo $(DEFAULT_VERSION); fi)

# Split version into major, minor, patch. The -alpha/-beta suffix is stripped first: splitting
# "0.2.0-beta" on "." gives a patch of "0-beta", which made a TYPE=patch bump a shell
# arithmetic error instead of a release.
CURRENT_CORE = $(word 1, $(subst -, ,$(CURRENT_VERSION)))
CURRENT_MAJOR = $(word 1, $(subst ., ,$(CURRENT_CORE)))
CURRENT_MINOR = $(word 2, $(subst ., ,$(CURRENT_CORE)))
CURRENT_PATCH = $(word 3, $(subst ., ,$(CURRENT_CORE)))

# Bump the version for a release pull request: writes version.txt and syncs every file that states
# it. It deliberately does nothing with git. This used to commit, tag and push to main in one go (as
# `make release`), which published a release before anyone had reviewed it or CI had run on it.
# Releases now go through a pull request, and the tag is pushed from main after the merge — see
# PUBLISHING.md. Refusing to run on main is what keeps a bump from skipping the pull request.
bump-version:
	@if [ "$$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" = "main" ]; then \
		echo "Bump the version on a release branch, not main: git checkout -b release-<version>"; \
		exit 1; \
	fi; \
	if [ "$(TYPE)" = "$(MAJOR_BUMP)" ]; then \
		NEW_MAJOR=$$(($(CURRENT_MAJOR) + 1)); \
		NEW_MINOR=0; \
		NEW_PATCH=0; \
	elif [ "$(TYPE)" = "$(MINOR_BUMP)" ]; then \
		NEW_MAJOR=$(CURRENT_MAJOR); \
		NEW_MINOR=$$(($(CURRENT_MINOR) + 1)); \
		NEW_PATCH=0; \
	elif [ "$(TYPE)" = "$(PATCH_BUMP)" ]; then \
		NEW_MAJOR=$(CURRENT_MAJOR); \
		NEW_MINOR=$(CURRENT_MINOR); \
		NEW_PATCH=$$(($(CURRENT_PATCH) + 1)); \
	else \
		echo "Invalid version bump type. Use major, minor, or patch."; \
		exit 1; \
	fi; \
	if [ "$(PRE_RELEASE)" = "alpha" ]; then \
		NEW_VERSION=$${NEW_MAJOR}.$${NEW_MINOR}.$${NEW_PATCH}$(ALPHA_SUFFIX); \
	elif [ "$(PRE_RELEASE)" = "beta" ]; then \
		NEW_VERSION=$${NEW_MAJOR}.$${NEW_MINOR}.$${NEW_PATCH}$(BETA_SUFFIX); \
	else \
		NEW_VERSION=$${NEW_MAJOR}.$${NEW_MINOR}.$${NEW_PATCH}; \
	fi; \
	echo "$${NEW_VERSION}" > $(VERSION_FILE); \
	node scripts/sync-version.mjs; \
	echo ""; \
	echo "Bumped to $${NEW_VERSION}. Next:"; \
	echo "  1. Add a $${NEW_VERSION} section to CHANGELOG.md"; \
	echo "  2. Commit, push this branch and open a pull request against main"; \
	echo "  3. Once it has merged, from an up-to-date main:"; \
	echo "       git tag $(TAG_PREFIX)$${NEW_VERSION} && git push origin $(TAG_PREFIX)$${NEW_VERSION}"

# Print the current version and the tag it will be released under
show-version:
	@echo "Current version: $(CURRENT_VERSION)"
	@echo "Current tag: $(TAG_PREFIX)$(CURRENT_VERSION)"

# A first draft of the next CHANGELOG.md section: the commits since the last tag, grouped by
# cliff.toml. Only a draft — PUBLISHING.md says what to do with it. It is labelled with the version in
# version.txt, so it refuses to run until that has been bumped past the last release.
GIT_CLIFF_VERSION = 2.13.1

changelog-draft:
	@if git rev-parse -q --verify "refs/tags/$(TAG_PREFIX)$(CURRENT_VERSION)" >/dev/null; then \
		echo "$(TAG_PREFIX)$(CURRENT_VERSION) is already released. Run make bump-version first."; \
		exit 1; \
	fi
	@npx --yes git-cliff@$(GIT_CLIFF_VERSION) --config cliff.toml --unreleased --tag $(TAG_PREFIX)$(CURRENT_VERSION)


VERSION_BUILD_FLAG = "-X main.version=$(CURRENT_VERSION)"


NODE_VERSION = $(shell cat .nvmrc)

# `npm ci` rewrites the first and `vite build` the second, so each is a stamp for its step.
UI_DEPS = ui/node_modules/.package-lock.json
UI_BUILD = ui/build/index.html
UI_SOURCES = $(shell find ui/src ui/public) ui/index.html ui/package.json ui/tsconfig.json ui/vite.config.ts

.PHONY: help check-tools init build dev install clean test test-frontend test-go e2e e2e-api e2e-browser bump-version show-version changelog-draft

help:
	@echo "Building from source (needs Go 1.25+ and Node.js $(NODE_VERSION)+):"
	@echo "  make build           build the zasper binary in this directory"
	@echo "  make install         build and install zasper into your Go bin directory"
	@echo "  make dev             run the frontend on :3000 and the backend on :8048"
	@echo "  make test            run the frontend and Go test suites"
	@echo "  make e2e             run the end-to-end suites (see e2e/README.md)"
	@echo "  make init            reinstall the frontend's dependencies from scratch"
	@echo "  make clean           remove build output"
	@echo ""
	@echo "Releasing (see PUBLISHING.md):"
	@echo "  make show-version, make bump-version TYPE=patch, make changelog-draft"

# npm only warns about an unsupported Node version, and the build then fails somewhere unrelated.
check-tools:
	@command -v go >/dev/null || { echo "Go is not installed; Zasper needs Go 1.25+: https://go.dev/dl/"; exit 1; }
	@command -v node >/dev/null || { echo "Node.js is not installed; Zasper needs Node.js $(NODE_VERSION)+ (nvm install)"; exit 1; }
	@node -e 'const [a, b] = process.versions.node.split(".").map(Number), [x, y] = process.argv[1].split(".").map(Number); process.exit(a > x || (a === x && b >= y) ? 0 : 1)' $(NODE_VERSION) \
		|| { echo "Node.js $$(node --version) is too old; Zasper needs $(NODE_VERSION)+ (nvm install && nvm use)"; exit 1; }

init: check-tools
	@echo "Installing the frontend's dependencies..."
	cd ui && npm ci
	@touch $(UI_DEPS)

$(UI_DEPS): ui/package-lock.json
	@$(MAKE) --no-print-directory init

$(UI_BUILD): $(UI_DEPS) $(UI_SOURCES) | check-tools
	@echo "Building the frontend..."
	cd ui && npm run build
	@touch $@

build: $(UI_BUILD)
	@echo "Building the backend..."
	go build -ldflags $(VERSION_BUILD_FLAG) .

# -tags apiserver serves ui/build from disk rather than embedding it, which a fresh clone does not have
# yet; in development Vite serves the frontend anyway.
dev: $(UI_DEPS) | check-tools
	@echo "Starting the frontend and backend in development..."
	(cd ui && npm start) & go run -tags apiserver . --no-browser

install: $(UI_BUILD)
	@echo "Installing zasper..."
	go install -ldflags $(VERSION_BUILD_FLAG) .

# Clean up build artifacts
clean:
	@echo "Cleaning up..."
	rm -f zasper
	rm -rf ui/build
	rm -rf ui/dist

# Both suites; either one also runs on its own.
test: test-frontend test-go

test-frontend: $(UI_DEPS)
	@echo "Running frontend tests"
	cd ui && npm test

# -race because several of these tests are about concurrent requests for the same kernel or session.
test-go:
	@echo "Running tests on backend"
	go test -race -tags apiserver ./internal/...

# End-to-end: the two halves against each other. See e2e/README.md.
e2e: e2e-api e2e-browser

# No browser and no frontend build; skips the kernel journeys if no kernelspec is runnable.
e2e-api:
	@echo "Running the API journeys"
	go test -race -tags apiserver ./internal/server/...

# Rebuilds the frontend first if any of its sources changed: the server embeds ui/build, and a stale
# build tests a stale app.
e2e-browser: $(UI_BUILD)
	@echo "Running the browser journeys"
	cd e2e && npm install && npx playwright test
