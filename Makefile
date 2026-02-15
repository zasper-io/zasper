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

# Split version into major, minor, patch
CURRENT_MAJOR = $(word 1, $(subst ., ,$(CURRENT_VERSION)))
CURRENT_MINOR = $(word 2, $(subst ., ,$(CURRENT_VERSION)))
CURRENT_PATCH = $(word 3, $(subst ., ,$(CURRENT_VERSION)))

# Targets to bump the version and create a tag

# Bump the version based on the specified type (major, minor, patch)
bump-version:
	@if [ "$(TYPE)" = "$(MAJOR_BUMP)" ]; then \
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
	echo "New version: $${NEW_VERSION}"; \
	echo "$${NEW_VERSION}" > $(VERSION_FILE); \
	echo "Version bumped and tagged as $(TAG_PREFIX)$${NEW_VERSION}"; \
	(cd ui && node updateVersion.js); \
	echo "Version updated in the frontend"; \
	git commit -am "Bump version to $${NEW_VERSION}"; \
	git tag $(TAG_PREFIX)$${NEW_VERSION}; \
	git push origin main; \
	git push origin $(TAG_PREFIX)$${NEW_VERSION}

# To create a release (alpha, beta, or final) based on the version bump type
release:
	$(MAKE) bump-version TYPE=$(TYPE) PRE_RELEASE=$(PRE_RELEASE)

# Print current version and tag it
show-version:
	@echo "Current version: $(CURRENT_VERSION)"
	@echo "Current tag: $(TAG_PREFIX)$(CURRENT_VERSION)"


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

electron-package:
	@echo "Detecting platform..."
	@uname_s=$$(uname -s); \
	if [ "$$uname_s" = "Darwin" ]; then \
		echo "Running electron-package-mac..."; \
		$(MAKE) electron-package-mac; \
	elif [ "$$uname_s" = "Linux" ]; then \
		echo "Running electron-package-linux..."; \
		$(MAKE) electron-package-linux; \
	elif echo "$$uname_s" | grep -qE "MINGW|MSYS|CYGWIN|Windows_NT"; then \
		echo "Running electron-package-windows..."; \
		$(MAKE) electron-package-windows; \
	else \
		echo "Unsupported platform: $$uname_s"; \
		exit 1; \
	fi

# Package the Electron app
electron-package-mac:
	@echo "Packaging the Electron app for macOS (amd64 and arm64)..."
	rm -rf ui/backend/*
	GOOS=darwin GOARCH=amd64 go build -ldflags $(VERSION_BUILD_FLAG) -o ./ui/backend/darwin-amd64/zasper
	GOOS=darwin GOARCH=arm64  go build -ldflags $(VERSION_BUILD_FLAG) -o ./ui/backend/darwin-arm64/zasper
	cd ui && npm run electron-package-mac

electron-package-linux:
	@echo "Packaging the Electron app for Linux (amd64, arm64, 386)..."
	rm -rf ui/backend/*
	GOOS=linux GOARCH=amd64 go build -ldflags $(VERSION_BUILD_FLAG) -o ./ui/backend/linux-amd64/zasper
	GOOS=linux GOARCH=arm64  go build -ldflags $(VERSION_BUILD_FLAG) -o ./ui/backend/linux-arm64/zasper
	GOOS=linux GOARCH=386    go build -ldflags $(VERSION_BUILD_FLAG) -o ./ui/backend/linux-386/zasper
	cd ui && npm run electron-package-linux

electron-package-windows:
	@echo "Packaging the Electron app for Windows (amd64, arm64, 386)..."
	rm -rf ui/backend/*
	GOOS=windows GOARCH=amd64 go build -ldflags $(VERSION_BUILD_FLAG) -o ./ui/backend/windows-amd64/zasper.exe
	GOOS=windows GOARCH=arm64  go build -ldflags $(VERSION_BUILD_FLAG) -o ./ui/backend/windows-arm64/zasper.exe
	GOOS=windows GOARCH=386    go build -ldflags $(VERSION_BUILD_FLAG) -o ./ui/backend/windows-386/zasper.exe
	cd ui && npm run electron-package-windows

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


# Run the tests
test:
	@echo "Running tests on frontend"
	cd ./ui/src && npm test
