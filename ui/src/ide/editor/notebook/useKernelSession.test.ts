import { describe, expect, it } from 'vitest';

import { INotebookMetadata } from '@/api';
import { IKernelspecsState } from '@/store/AppState';

import { kernelToStart } from './useKernelSession';

/** The installed kernels, as /api/kernelspecs reports them: keyed by name. */
function installed(...names: string[]): IKernelspecsState {
  return Object.fromEntries(
    names.map((name) => [name, { name, spec: { display_name: name }, resources: {} }])
  );
}

/**
 * Which kernel a notebook opens on. Every way of opening an existing notebook passes 'none' — the
 * file browser has not read the file and cannot know — so `metadata.kernelspec` is the only record
 * of the kernel it was last saved with.
 */
describe('kernelToStart', () => {
  const python3: INotebookMetadata = {
    kernelspec: { name: 'python3', display_name: 'Python 3' },
  };

  it('starts the kernel the notebook was saved with', () => {
    expect(kernelToStart('none', python3, installed('python3', 'deno'))).toBe('python3');
  });

  // What Zasper wrote into this field before, so it is on disk in real notebooks.
  it('accepts a kernelspec saved as a bare string', () => {
    expect(kernelToStart('none', { kernelspec: 'deno' }, installed('python3', 'deno'))).toBe(
      'deno'
    );
  });

  it('asks when the notebook names no kernel', () => {
    expect(kernelToStart('none', {}, installed('python3'))).toBe('none');
    expect(kernelToStart('none', { kernelspec: '' }, installed('python3'))).toBe('none');
    expect(kernelToStart('none', { kernelspec: 'none' }, installed('python3'))).toBe('none');
  });

  it('asks when the kernel the notebook names is not installed', () => {
    expect(kernelToStart('none', python3, installed('deno'))).toBe('none');
  });

  // The kernelspecs are fetched separately, so an empty list is not evidence of anything.
  it('tries the notebook’s kernel when the installed list is not known yet', () => {
    expect(kernelToStart('none', python3, {})).toBe('python3');
  });

  // The Launcher creates a notebook with a chosen kernel; its file names none at all yet.
  it('prefers a kernel the tab was opened with', () => {
    expect(kernelToStart('deno', python3, installed('python3', 'deno'))).toBe('deno');
    expect(kernelToStart('', python3, installed('python3'))).toBe('python3');
  });

  /*
   * Closing a tab leaves the kernel running, so a reopened notebook is usually being asked about a
   * kernel that is already answering. Joining it is the whole behaviour: any other name starts a second
   * kernel and abandons everything the first one holds.
   */
  describe('when a kernel is already running the notebook', () => {
    it('joins it', () => {
      expect(kernelToStart('none', python3, installed('python3', 'deno'), 'deno')).toBe('deno');
    });

    // Even against a kernel chosen for the tab: that was a choice, this is what is running.
    it('joins it over the tab’s kernel and the file’s', () => {
      expect(kernelToStart('python3', python3, installed('python3', 'deno'), 'deno')).toBe('deno');
    });

    // No picker for a notebook that is already running, whatever its file does or does not say.
    it('joins it when the file names no kernel', () => {
      expect(kernelToStart('none', {}, installed('deno'), 'deno')).toBe('deno');
    });

    // A kernel that is not installed here is still running, and its session is still the one to join.
    it('joins it when it is not in the installed list', () => {
      expect(kernelToStart('none', python3, installed('python3'), 'deno')).toBe('deno');
    });

    // No session on the path: nothing to join, so the file and the tab decide as before.
    it('is ignored when there is nothing running', () => {
      expect(kernelToStart('none', python3, installed('python3'), undefined)).toBe('python3');
      expect(kernelToStart('none', python3, installed('python3'), '')).toBe('python3');
      expect(kernelToStart('none', python3, installed('python3'), 'none')).toBe('python3');
    });
  });
});
