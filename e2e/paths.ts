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

export const fixtureProject = join(e2eRoot, 'fixtures', 'project');

/** Not 8048: that is the port a developer's own `make dev` is already on. */
export const port = 8099;
export const baseURL = `http://localhost:${port}`;
