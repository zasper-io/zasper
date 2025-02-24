// updateVersion.js
const fs = require('fs');
const path = require('path');

// Read the version from version.txt
// const version = fs.readFileSync(path.join(__dirname, 'version.txt'), 'utf8').trim();
const version = fs.readFileSync(path.join('..', 'version.txt'), 'utf8').trim();

// Read package.json
const packageJson = require('./package.json');

// Update the version in package.json
packageJson.version = version;

// Write the updated package.json back to disk
fs.writeFileSync(path.join(__dirname, 'package.json'), JSON.stringify(packageJson, null, 2));

console.log(`Updated package.json with version: ${version}`);
