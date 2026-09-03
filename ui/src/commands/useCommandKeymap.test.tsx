import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { Provider } from 'jotai';

import { useRegisterCommands } from './registry';
import { ICommand } from './types';
import { useCommandKeymap } from './useCommandKeymap';

/** Mounts the dispatcher and the given commands together, as `IDE.tsx` and a tab do. */
function mount(commands: ICommand[]) {
  const Host = () => {
    useCommandKeymap();
    useRegisterCommands(commands);
    return (
      <>
        <input data-testid="field" />
        <div data-testid="cm" contentEditable suppressContentEditableWarning />
      </>
    );
  };
  return render(
    <Provider>
      <Host />
    </Provider>
  );
}

function press(
  key: string,
  init: Partial<KeyboardEventInit> = {},
  target: EventTarget = window
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function command(overrides: Partial<ICommand>): ICommand {
  return { id: 'x', label: 'X', category: 'Test', scope: 'app', execute: () => {}, ...overrides };
}

describe('useCommandKeymap', () => {
  // preventDefault matters as much as the dispatch: Mod-S otherwise opens the browser's own
  // save dialog. Bound with an explicit Ctrl- so the assertion holds on either platform.
  it('runs the command bound to the chord and swallows the key', () => {
    const execute = vi.fn();
    mount([command({ keys: ['Ctrl-s'], execute })]);

    const event = press('s', { ctrlKey: true });

    expect(execute).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves chords nobody claimed alone', () => {
    mount([command({ keys: ['Mod-s'], execute: () => {} })]);

    expect(press('q', { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('ignores cell-editor commands, which CodeMirror dispatches instead', () => {
    const execute = vi.fn();
    mount([command({ keys: ['Shift-Enter'], scope: 'cell-editor', execute })]);

    press('Enter', { shiftKey: true });

    expect(execute).not.toHaveBeenCalled();
  });

  it('lets a disabled command fall through rather than eating the key', () => {
    const execute = vi.fn();
    mount([command({ keys: ['Ctrl-b'], execute, isEnabled: () => false })]);

    expect(press('b', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  // A cell's editor is a contenteditable, so without this a future bare-letter binding would fire
  // on every keystroke of typed code.
  it('does not steal unmodified keys from a text field or an editor', () => {
    const execute = vi.fn();
    const { getByTestId } = mount([command({ keys: ['b'], execute })]);

    press('b', {}, getByTestId('field'));
    press('b', {}, getByTestId('cm'));
    expect(execute).not.toHaveBeenCalled();

    press('b');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('still delivers modifier chords typed inside an editor', () => {
    const execute = vi.fn();
    const { getByTestId } = mount([command({ keys: ['Ctrl-b'], execute })]);

    press('b', { ctrlKey: true }, getByTestId('cm'));

    expect(execute).toHaveBeenCalledOnce();
  });

  it('ignores the modifier keys themselves', () => {
    const execute = vi.fn();
    mount([command({ keys: ['Shift-Shift'], execute })]);

    press('Shift', { shiftKey: true });

    expect(execute).not.toHaveBeenCalled();
  });
});
