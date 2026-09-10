/*
The text that ends up on the GitHub Release page, and the check that stops a release pull request
merging without it. Run with: node --test scripts/*.test.mjs
*/
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { changelogSection } from './changelog-section.mjs';

const changelog = `# Changelog

Intro text.

## [1.1.0] — 2026-10-01

### Added

- A thing.

## [1.0.0] — 2026-09-10

### Fixed

- Another thing.

## [1.0.0-rc.1] — 2026-09-01

- Rehearsal notes.

[1.1.0]: https://example.com/1.1.0
[1.0.0]: https://example.com/1.0.0
`;

test('answers a section without its heading, stopping at the next one', () => {
  assert.equal(changelogSection(changelog, '1.1.0'), '### Added\n\n- A thing.');
});

test('1.0.0 finds its own heading, not the one for 1.0.0-rc.1', () => {
  assert.equal(changelogSection(changelog, '1.0.0'), '### Fixed\n\n- Another thing.');
});

test('the last section stops before the link definitions at the foot of the file', () => {
  assert.equal(changelogSection(changelog, '1.0.0-rc.1'), '- Rehearsal notes.');
});

test('a pre-release with no section of its own uses the release it precedes', () => {
  assert.equal(changelogSection(changelog, '1.1.0-rc.2'), '### Added\n\n- A thing.');
});

test('a version with no section is refused, naming the heading to add', () => {
  assert.throws(() => changelogSection(changelog, '2.0.0'), /no "## \[2\.0\.0\]" section/);
});

test('a heading with nothing under it is refused rather than published empty', () => {
  assert.throws(() => changelogSection('## [3.0.0]\n\n## [2.0.0]\n\n- x\n', '3.0.0'), /nothing in it/);
});

test('Windows line endings', () => {
  assert.equal(changelogSection('## [1.0.0]\r\n\r\n- x\r\n', '1.0.0'), '- x');
});

// The real file, so an edit to CHANGELOG.md's shape that the parser does not understand fails here
// rather than on the day of a release.
test('the real CHANGELOG.md parses: 1.0.0 has its sections and nothing of its neighbours', () => {
  const real = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const section = changelogSection(real, '1.0.0');
  assert.match(section, /^### Added$/m);
  assert.doesNotMatch(section, /^## /m);
  assert.doesNotMatch(section, /^\[0\.3\.0-beta\]:/m);
});
