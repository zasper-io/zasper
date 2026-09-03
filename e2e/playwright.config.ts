import { defineConfig, devices } from '@playwright/test';

import {
  baseURL,
  e2eRoot,
  fixtureProject,
  homeDir,
  port,
  projectDir,
  repoRoot,
  serverBinary,
} from './paths';

export default defineConfig({
  testDir: './tests',

  // One server, one project directory and one kernel between them: the specs create, rename and
  // delete files in that directory, so they take it in turns.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,

  /*
   * No retries, anywhere. A spec that passes on the second attempt is a missing await or a race, and
   * a retry would turn that into a green run and a mystery later. Fixed sleeps and retries are what
   * make e2e suites untrustworthy; this suite has neither.
   */
  retries: 0,

  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // Chromium alone: the app ships as a desktop shell around one engine, so a second browser would
  // test a configuration nobody runs.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    /*
     * prepare.cjs builds the binary and lays out the throwaway home and project; see its header for
     * why that is a script rather than a globalSetup.
     *
     * `cd` because a notebook save resolves its path against the server's working directory, so -cwd
     * alone would not keep writes inside the throwaway project. `exec` so the shell is replaced by
     * the server and Playwright's shutdown signal reaches it rather than a wrapper it would outlive.
     *
     * POSIX shells only, which is what the suite runs on: macOS and Linux CI.
     */
    command: [
      'node prepare.cjs',
      'cd "$ZASPER_E2E_PROJECT"',
      `exec "$ZASPER_E2E_BINARY" -port :${port} -tracking=false`,
    ].join(' && '),
    cwd: e2eRoot,
    // Polled until it answers, which is what makes the wait for boot a wait rather than a guess.
    url: `${baseURL}/api/health`,
    // Never talk to a server somebody else started: it would be reading their settings and their
    // files, and a green run would mean nothing.
    reuseExistingServer: false,
    // A cold `go build` of the whole tree is the slow part.
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // The whole reason for the throwaway directories. Everything the server writes — settings, its
      // record of recent projects — lands under here.
      HOME: homeDir,
      // Read before the override above, for the things that would be wrong to run against it: the Go
      // build cache, and the search for an installed kernelspec.
      ZASPER_E2E_REAL_HOME: process.env.HOME ?? '',
      ZASPER_E2E_REPO: repoRoot,
      ZASPER_E2E_BINARY: serverBinary,
      ZASPER_E2E_HOME: homeDir,
      ZASPER_E2E_PROJECT: projectDir,
      ZASPER_E2E_FIXTURE: fixtureProject,
    },
  },
});
