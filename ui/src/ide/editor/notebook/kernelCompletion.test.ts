import { describe, expect, it, vi } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';

import { kernelCompletionSource } from './kernelCompletion';
import { ICompleteReply } from './kernelMessages';

function contextFor(source: string, cursorPos: number): CompletionContext {
  const state = EditorState.create({ doc: source });
  return new CompletionContext(state, cursorPos, true);
}

function reply(overrides: Partial<ICompleteReply> = {}): ICompleteReply {
  return {
    status: 'ok',
    matches: ['np.arange', 'np.array'],
    cursor_start: 0,
    cursor_end: 5,
    ...overrides,
  };
}

describe('kernelCompletionSource', () => {
  it('asks the kernel about the whole cell and the cursor offset', async () => {
    const request = vi.fn().mockResolvedValue(reply());

    await kernelCompletionSource(request)(contextFor('np.ar', 5));

    expect(request).toHaveBeenCalledWith('np.ar', 5);
  });

  it('replaces the range the kernel names, not the word the editor sees', async () => {
    const result = await kernelCompletionSource(vi.fn().mockResolvedValue(reply()))(
      contextFor('np.ar', 5)
    );

    expect(result).toMatchObject({ from: 0, to: 5 });
    expect(result?.options.map((option) => option.label)).toEqual(['np.arange', 'np.array']);
  });

  it('carries IPython kinds over as icon types, and leaves unknown kinds untyped', async () => {
    const result = await kernelCompletionSource(
      vi.fn().mockResolvedValue(
        reply({
          matches: ['arange', 'x', 'weird'],
          metadata: {
            _jupyter_types_experimental: [
              { start: 0, end: 1, text: 'arange', type: 'function' },
              { start: 0, end: 1, text: 'x', type: 'instance' },
              { start: 0, end: 1, text: 'weird', type: 'no-such-kind' },
            ],
          },
        })
      )
    )(contextFor('a', 1));

    expect(result?.options).toEqual([
      { label: 'arange', type: 'function' },
      { label: 'x', type: 'variable' },
      { label: 'weird' },
    ]);
  });

  it('matches kinds by text, since a kernel need not order them like matches', async () => {
    const result = await kernelCompletionSource(
      vi.fn().mockResolvedValue(
        reply({
          matches: ['alpha', 'beta'],
          metadata: {
            _jupyter_types_experimental: [
              { start: 0, end: 1, text: 'beta', type: 'class' },
              { start: 0, end: 1, text: 'alpha', type: 'function' },
            ],
          },
        })
      )
    )(contextFor('a', 1));

    expect(result?.options).toEqual([
      { label: 'alpha', type: 'function' },
      { label: 'beta', type: 'class' },
    ]);
  });

  // No kernel, a kernel busy running a cell, or a kernel with nothing to suggest all have to end
  // the same way: no popup, rather than an empty one or a thrown error inside the editor.
  it.each([
    ['no reply at all', null],
    ['an error reply', reply({ status: 'error' })],
    ['an empty match list', reply({ matches: [] })],
  ])('offers nothing for %s', async (_label, value) => {
    const result = await kernelCompletionSource(vi.fn().mockResolvedValue(value))(
      contextFor('np.ar', 5)
    );

    expect(result).toBeNull();
  });
});
