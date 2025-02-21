# Publishing Zasper

While Zasper is open-source and available for everyone to use, I kindly ask that you get in touch before considering publishing it on new package managers. 

As the creator of Zasper, I hold the trademark for this project and prefer to manage its distribution. If you’d like to see Zasper available on a new package manager, please feel free to raise an issue on GitHub, and I’ll be happy to discuss it!

This document outlines the process for publishing releases of Zasper. Whether you’re releasing a new version, updating dependencies, or making a patch, following this guide ensures that your changes are correctly published and versioned.

## Table of Contents
- [Pre-release Checklist](#pre-release-checklist)
- [Versioning](#versioning)
- [Release Process](#release-process)
- [Creating a Release](#creating-a-release)
- [Publishing a Release](#publishing-a-release)

## Pre-release Checklist

Before you publish a new version of Zasper, ensure that the following steps are completed:

1. **Run Tests**: Make sure all tests pass and the code is in a stable state.
   ```bash
   npm test
   # Or the equivalent for your project
2. Update Documentation: Ensure that the README.md, CONTRIBUTING.md, and any other relevant documentation are up to date with the latest changes.
3. Check Dependencies: Update and check all dependencies to make sure they are up to date and compatible.
```bash
npm outdated  # Or the equivalent for your project
```
4. Changelog Update: Update the CHANGELOG.md with the new changes, following the conventions outlined in the repository.

5. Commit Changes: Ensure all changes are committed, including version updates and changelog modifications.

```
git commit -m "chore: prepare for release vX.Y.Z"
```
Tag the Commit: Tag the commit with the new version number.

```
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

## Versioning
Zasper follows Semantic Versioning, which means that version numbers are structured as MAJOR.MINOR.PATCH.

* MAJOR version changes when you make incompatible API changes,
* MINOR version changes when you add functionality in a backward-compatible manner,
* PATCH version changes when you make backward-compatible bug fixes.
For example:

* A bug fix update might result in a version v1.2.3.
* A new feature added without breaking changes might result in v1.3.0.
* A breaking change might result in v2.0.0.

## Release Process
1. Bump Version: Update the version number according to the changes in the repository (major, minor, or patch).
   * In the package.json (or equivalent file), change the version number to the new release version.
2. Create a New Branch (Optional): Some teams prefer creating a release branch to isolate release changes:

   ```bash
   git checkout -b release-vX.Y.Z
   ```

3. Build the Application (Optional): If your project requires a build step, such as transpiling or bundling, make sure to build the final release artifacts:
   ```bash
   npm run build
   ```
4. Run Tests Again: Ensure everything works after building.
   ```bash
   npm test
   ```

### Create a New Tag: 

**For a major version bump (e.g., 1.0.0 to 2.0.0):**

```bash
make release TYPE=major
```

**For a minor version bump (e.g., 1.0.0 to 1.1.0):**

```bash
make release TYPE=minor
```

**For a patch version bump (e.g., 1.0.0 to 1.0.1):**

```bash
make release TYPE=patch
```

**For Alpha or Beta Pre-releases:**

You can also specify PRE_RELEASE=alpha or PRE_RELEASE=beta to tag pre-release versions:

**For an alpha version (e.g., 1.0.0-alpha):**

```bash
make release TYPE=minor PRE_RELEASE=alpha
```

**For a beta version (e.g., 1.0.0-beta):**

```bash
make release TYPE=minor PRE_RELEASE=beta
```

### Show Current Version and Tag:

To see the current version and tag based on version.txt, use:

```bash
make show-version
```

Example Outputs:
**For a patch release:**

```bash
make release TYPE=patch
```

```
Current version: 1.0.0
New version: 1.0.1
```

Output:
```pgsql
New version: 1.0.1
```

```
Version bumped and tagged as v1.0.1
```
For an alpha release:

```bash
make release TYPE=minor PRE_RELEASE=alpha
```

Current version: 1.0.0
New version: 1.1.0-alpha
Output:
```pgsql
New version: 1.1.0-alpha
```

Version bumped and tagged as v1.1.0-alpha
For a major release:

```bash
make release TYPE=major
```

```
Current version: 1.0.0
New version: 2.0.0
```

Output:
```pgsql
New version: 2.0.0
```
```
Version bumped and tagged as v2.0.0
```
