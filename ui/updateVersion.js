// updateVersion.js
import { readFileSync, writeFileSync } from 'node:fs';

// Paths are resolved against this file so the script works from any cwd.
const versionFile = new URL('../version.txt', import.meta.url);
const packageJsonFile = new URL('./package.json', import.meta.url);

const version = readFileSync(versionFile, 'utf8').trim();

const packageJson = JSON.parse(readFileSync(packageJsonFile, 'utf8'));
packageJson.version = version;

writeFileSync(packageJsonFile, JSON.stringify(packageJson, null, 2) + '\n');

console.log(`Updated package.json with version: ${version}`);
