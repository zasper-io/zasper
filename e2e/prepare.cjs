/*
Builds the server and lays out the throwaway home and project directory it runs against.

A script run from the webServer command rather than a Playwright globalSetup, for two reasons: it has
to finish before the server starts, and it needs the real HOME. The server is given a throwaway one,
which is the point of this file — Zasper keeps its settings in $HOME/.zasper/config.json, and a test
run must not touch the one the developer's own server is reading and writing.

The cost of a throwaway HOME is that $HOME is also where Jupyter keeps its kernelspecs, so one is
copied in. That has a happy side effect: the Launcher then offers exactly one kernel on every
machine, whatever the developer happens to have installed.

Paths arrive as environment variables from playwright.config.ts, so paths.ts stays the only place
they are written down.
*/
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repo = required('ZASPER_E2E_REPO');
const binary = required('ZASPER_E2E_BINARY');
const home = required('ZASPER_E2E_HOME');
const project = required('ZASPER_E2E_PROJECT');
const fixture = required('ZASPER_E2E_FIXTURE');
const realHome = required('ZASPER_E2E_REAL_HOME');

/** The real HOME, for anything that would be wrong to run against the throwaway one. */
const realEnv = { ...process.env, HOME: realHome };

function required(name) {
  const value = process.env[name];
  if (!value) {
    fail(`${name} is not set; prepare.cjs is meant to be run by playwright.config.ts`);
  }
  return value;
}

function fail(message) {
  console.error(`\ne2e setup: ${message}\n`);
  process.exit(1);
}

function buildServer() {
  // Checked here rather than left to the embed error, which says only "no matching files found".
  if (!fs.existsSync(path.join(repo, 'ui', 'build', 'index.html'))) {
    fail(
      'ui/build is missing, so the server would have no frontend to serve.\n' +
        'Run: cd ui && npm run build'
    );
  }

  fs.mkdirSync(path.dirname(binary), { recursive: true });
  // No -tags apiserver: that tag drops the embed, and this binary has to serve the app.
  // The version is stamped in because the server otherwise reads version.txt out of its working
  // directory, which here is the throwaway project.
  // The real HOME, so the build uses the module and build caches that are already warm.
  execFileSync('go', ['build', '-ldflags', '-X main.version=e2e', '-o', binary, '.'], {
    cwd: repo,
    stdio: 'inherit',
    env: realEnv,
  });
}

function resetWorkspace() {
  for (const directory of [home, project]) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  fs.mkdirSync(home, { recursive: true });
  fs.cpSync(fixture, project, { recursive: true });
}

/**
 * Where the kernelspecs are on this machine: asked of Jupyter itself when there is a jupyter to ask,
 * which is what the server does (see utils.GetJupyterPath), and the usual places when there is not.
 */
function kernelDirs() {
  let dataDirs = [];
  try {
    const answer = execFileSync('jupyter', ['--paths', '--json'], {
      env: realEnv,
      encoding: 'utf8',
    });
    dataDirs = JSON.parse(answer).data ?? [];
  } catch {
    dataDirs = [
      path.join(realHome, '.local', 'share', 'jupyter'),
      path.join(realHome, 'Library', 'Jupyter'),
      path.join(realHome, 'miniconda3', 'share', 'jupyter'),
      path.join(realHome, 'anaconda3', 'share', 'jupyter'),
      '/usr/local/share/jupyter',
      '/usr/share/jupyter',
    ];
  }
  return dataDirs.map((dataDir) => path.join(dataDir, 'kernels'));
}

/** Whether argv[0] is something that can actually be started, PATH included. */
function isRunnable(command) {
  const candidates = command.includes(path.sep)
    ? [command]
    : (process.env.PATH ?? '').split(path.delimiter).map((dir) => path.join(dir, command));

  return candidates.some((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * The first Python kernelspec that can be run, by name, or null.
 *
 * Installed is not enough: a kernelspec whose virtualenv has been deleted is still listed and still
 * fails to start. Same rule as requireKernel in internal/server/kernel_e2e_test.go.
 */
function runnableKernelspec() {
  for (const kernelDir of kernelDirs()) {
    let names = [];
    try {
      names = fs.readdirSync(kernelDir).sort();
    } catch {
      continue;
    }

    for (const name of names) {
      const source = path.join(kernelDir, name);
      let spec;
      try {
        spec = JSON.parse(fs.readFileSync(path.join(source, 'kernel.json'), 'utf8'));
      } catch {
        continue;
      }
      if (spec.language !== 'python' || !Array.isArray(spec.argv) || spec.argv.length === 0) {
        continue;
      }
      if (isRunnable(spec.argv[0])) {
        return { name, source };
      }
    }
  }
  return null;
}

function seedKernelspec() {
  const spec = runnableKernelspec();
  if (spec === null) {
    return null;
  }

  // Both places, because which one the server looks in depends on the platform and on whether it
  // found a jupyter to ask. The copy keeps its kernel.json, whose argv names an interpreter by
  // absolute path, so it runs from here just as it did where it came from.
  for (const kernels of [
    path.join(home, '.local', 'share', 'jupyter', 'kernels'),
    path.join(home, 'Library', 'Jupyter', 'kernels'),
  ]) {
    fs.mkdirSync(kernels, { recursive: true });
    fs.cpSync(spec.source, path.join(kernels, spec.name), { recursive: true });
  }

  return spec.name;
}

buildServer();
resetWorkspace();

const seeded = seedKernelspec();
console.log(`e2e setup: project ${project}`);
console.log(
  seeded === null
    ? 'e2e setup: no runnable Python kernelspec found — the specs that need a kernel will skip'
    : `e2e setup: kernelspec ${seeded}`
);
