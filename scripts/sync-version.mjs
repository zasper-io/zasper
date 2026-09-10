/*
Copies version.txt into every other file that states the version.

The version used to live in five places and drift between them: a v0.3.0-beta tag shipped while
version.txt, ui/package.json and snap/snapcraft.yaml all still said 0.2.0-beta, and the Snap Store
listed a package whose grade was "stable" and whose version was a beta. Only the first two were ever
updated automatically.

Every target below is required. A pattern that no longer matches is an error rather than a skipped
file, because a silent skip is exactly how the drift happened.
*/
import { readFileSync, writeFileSync } from 'node:fs';

const repoRoot = new URL('../', import.meta.url);
const at = (path) => new URL(path, repoRoot);

const version = readFileSync(at('version.txt'), 'utf8').trim();
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`version.txt does not hold a semantic version: ${JSON.stringify(version)}`);
}

/** Rewrites one match of `pattern`, or throws naming the file that has stopped matching. */
function substitute(path, pattern, replacement) {
  const file = at(path);
  const before = readFileSync(file, 'utf8');
  const after = before.replace(pattern, replacement);

  if (after === before && !pattern.test(before)) {
    throw new Error(`${path}: nothing matched ${pattern}. The version line moved or changed shape.`);
  }

  writeFileSync(file, after);
  console.log(`  ${path}`);
}

console.log(`Syncing version ${version} into:`);

// package.json is rewritten through JSON rather than by pattern, so formatting stays canonical.
const packageJsonPath = at('ui/package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
packageJson.version = version;
writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
console.log('  ui/package.json');

// Quoted, because an unquoted 1.0.0 is a YAML float and 1.0.0-beta is not — the pair would parse
// as two different types.
substitute('snap/snapcraft.yaml', /^version: '.*'$/m, `version: '${version}'`);

// The README states the version with the tag's v prefix, matching what the release is called.
substitute('README.md', /^Current release version: `v.*`$/m, `Current release version: \`v${version}\``);
