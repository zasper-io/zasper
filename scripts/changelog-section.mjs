/*
Prints the body of one version's section of CHANGELOG.md.

The release uses it twice. The verify job runs it for the version in version.txt, so a release pull
request cannot merge without its changelog entry. The release job runs it for the pushed tag and
hands the result to GoReleaser as the GitHub Release notes, so the release page shows the same edited
text as CHANGELOG.md rather than GoReleaser's raw list of commit subjects.

    node scripts/changelog-section.mjs 1.0.0

A pre-release with no section of its own uses the section of the release it precedes, so rehearsing
1.0.0 as 1.0.0-rc.1 does not need a changelog entry written just for the rehearsal.
*/
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Answers the lines under `version`'s heading, without the heading, or throws saying what is missing. */
export function changelogSection(markdown, version) {
  const exact = sectionBody(markdown, version);
  if (exact !== undefined) {
    return nonEmpty(exact, version);
  }

  const release = version.split('-')[0];
  if (release !== version) {
    const fallback = sectionBody(markdown, release);
    if (fallback !== undefined) {
      return nonEmpty(fallback, release);
    }
  }

  throw new Error(
    `CHANGELOG.md has no "## [${version}]" section. Add one to the release pull request.`
  );
}

function sectionBody(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  // Closed by the bracket, so looking for 1.0.0 does not land on 1.0.0-rc.1.
  const heading = `## [${version}]`;
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) {
    return undefined;
  }

  const body = [];
  for (const line of lines.slice(start + 1)) {
    // The next version's heading, or the link definitions at the foot of the file.
    if (line.startsWith('## ') || /^\[[^\]]+\]:\s/.test(line)) {
      break;
    }
    body.push(line);
  }
  return body.join('\n').trim();
}

function nonEmpty(body, version) {
  if (body === '') {
    throw new Error(`CHANGELOG.md has a "## [${version}]" section, but nothing in it.`);
  }
  return body;
}

// realpath, because a symlink anywhere in the checkout's path would otherwise make this compare
// unequal and the script exit 0 having printed nothing.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: node scripts/changelog-section.mjs <version>');
    process.exit(2);
  }
  try {
    const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
    process.stdout.write(changelogSection(changelog, version) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
