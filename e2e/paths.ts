import { join, resolve } from 'node:path';

/**
 * Where everything the suite touches lives. Kept apart from playwright.config.ts because the specs
 * read some of it too — a delete is only proved by the file being gone from disk.
 */
export const e2eRoot = __dirname;
export const repoRoot = resolve(e2eRoot, '..');

/** Disposable: prepare.cjs lays all of this out again on every run. */
export const workspace = join(e2eRoot, '.tmp');
export const homeDir = join(workspace, 'home');
export const projectDir = join(workspace, 'project');
export const serverBinary = join(workspace, 'zasper');
/** agenttest's scripted agent, which prepare.cjs builds beside the server. */
export const fakeAgentBinary = join(workspace, 'fake-agent');

export const fixtureProject = join(e2eRoot, 'fixtures', 'project');

/** Not 8048: that is the port a developer's own `make dev` is already on. */
export const port = 8099;
export const baseURL = `http://localhost:${port}`;

/**
 * A second server on the same project, under a path as a hub serves one: `--base-url /user/prasun/`. Only
 * basepath.spec.ts talks to it.
 */
export const basePathPort = 8098;
export const basePath = '/user/prasun/';
export const basePathURL = `http://localhost:${basePathPort}${basePath}`;

/** Pinned through ZASPER_ACCESS_TOKEN, so the specs can sign in the way the startup link does. */
export const accessToken = 'e2e-access-token';
