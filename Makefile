# Version Variables
VERSION_FILE = version.txt
TAG_PREFIX = v
DEFAULT_VERSION = v0.0.1
MAJOR_BUMP = major
MINOR_BUMP = minor
PATCH_BUMP = patch
ALPHA_SUFFIX = -alpha
BETA_SUFFIX = -beta
TAG_REGEX = '^v[0-9]\+\.[0-9]\+\.[0-9]\+(-alpha|-beta)?$$'  # Regex to match version format (vX.Y.Z[-alpha/-beta])

# Get the current version from version.txt or set to default if file does not exist
CURRENT_VERSION = $(shell if [ -f $(VERSION_FILE) ]; then cat $(VERSION_FILE); else echo $(DEFAULT_VERSION); fi)

# Strip the 'v' prefix to get the numeric version
STRIPPED_VERSION = $(subst v,,$(CURRENT_VERSION))

# Split version into major, minor, patch (after stripping 'v')
CURRENT_MAJOR = $(word 1, $(subst ., ,$(STRIPPED_VERSION)))
CURRENT_MINOR = $(word 2, $(subst ., ,$(STRIPPED_VERSION)))
CURRENT_PATCH = $(word 3, $(subst ., ,$(STRIPPED_VERSION)))

# Targets to bump the version and create a tag

# Bump the version based on the specified type (major, minor, patch)
bump-version:
	@if [ "$(TYPE)" == "$(MAJOR_BUMP)" ]; then \
		NEW_MAJOR=$$(($(CURRENT_MAJOR) + 1)); \
		NEW_MINOR=0; \
		NEW_PATCH=0; \
	elif [ "$(TYPE)" == "$(MINOR_BUMP)" ]; then \
		NEW_MAJOR=$(CURRENT_MAJOR); \
		NEW_MINOR=$$(($(CURRENT_MINOR) + 1)); \
		NEW_PATCH=0; \
	elif [ "$(TYPE)" == "$(PATCH_BUMP)" ]; then \
		NEW_MAJOR=$(CURRENT_MAJOR); \
		NEW_MINOR=$(CURRENT_MINOR); \
		NEW_PATCH=$$(($(CURRENT_PATCH) + 1)); \
	else \
		echo "Invalid version bump type. Use major, minor, or patch."; \
		exit 1; \
	fi; \
	# Determine the pre-release suffix (alpha, beta, or empty)
	if [ "$(PRE_RELEASE)" == "alpha" ]; then \
		NEW_VERSION=$${NEW_MAJOR}.$${NEW_MINOR}.$${NEW_PATCH}$(ALPHA_SUFFIX); \
	elif [ "$(PRE_RELEASE)" == "beta" ]; then \
		NEW_VERSION=$${NEW_MAJOR}.$${NEW_MINOR}.$${NEW_PATCH}$(BETA_SUFFIX); \
	else \
		NEW_VERSION=$${NEW_MAJOR}.$${NEW_MINOR}.$${NEW_PATCH}; \
	fi; \
	# Add TAG_PREFIX (e.g., v) to the version
	VERSION_WITH_PREFIX=$(TAG_PREFIX)$${NEW_VERSION}; \
	# Display and write the version with prefix to version.txt
	echo "New version with tag prefix: $${VERSION_WITH_PREFIX}"; \
	echo $${VERSION_WITH_PREFIX} > $(VERSION_FILE); \
	# Commit and tag the new version with the prefix
	git commit -am "Bump version to $${VERSION_WITH_PREFIX}"; \
	git tag $(VERSION_WITH_PREFIX); \
	echo "Version bumped and tagged as $${VERSION_WITH_PREFIX}"; \
	cd ui && node updateVersion.js
	echo "Version updated in the frontend"

# Release target to bump version and create a release (alpha, beta, or final)
release:
	@echo "Creating release..."
	$(MAKE) bump-version TYPE=$(TYPE) PRE_RELEASE=$(PRE_RELEASE)

# Print current version and tag it
show-version:
	@echo "Current version: $(CURRENT_VERSION)"
	@echo "Current tag: $(CURRENT_VERSION)"
	@echo "Current major: $(CURRENT_MAJOR)"
	@echo "Current minor: $(CURRENT_MINOR)"
	@echo "Current patch: $(CURRENT_PATCH)"

VERSION_BUILD_FLAG = "-X main.version=$(CURRENT_VERSION)"


.PHONY: init build start dev electron-package webapp-install

# Initialize the project by installing frontend dependencies
init:
	@echo "Initializing the project..."
	cd ui && npm install

# Build the frontend and backend
 
build: 
	@echo "Building the frontend and backend..."
	cd ui && npm run build
	go build -ldflags $(VERSION_BUILD_FLAG) .

# Default target: run both frontend and backend in development
dev:
	@echo "Starting the frontend and backend in development..."
	(cd ui && npm start) & go run .

# Run the Electron app in development
electron-dev:
	@echo "Starting the Electron app in development..."
	(go run .) & cd ui && npm run electron-dev		

# Package the Electron app
electron-package:
	@echo "Packaging the Electron app..."
	go build -ldflags $(VERSION_BUILD_FLAG) -o ./ui/build/zasper
	cd ui && npm run electron-package

# Install the web app
webapp-install: build
	@echo "Installing the web app..."
	go install -ldflags $(VERSION_BUILD_FLAG) .

# Clean up build artifacts
clean:
	@echo "Cleaning up..."
	rm -f zasper
	rm -rf ui/build
	rm -rf ui/dist
