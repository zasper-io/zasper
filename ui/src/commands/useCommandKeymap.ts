import { useEffect, useRef } from 'react';

import { chordMatches, isModifierKey } from './keys';
import { useCommands } from './registry';

/**
 * The application's one keyboard dispatcher. Mounted once, in `IDE.tsx`; it replaced four separate
 * `window` listeners that each knew only their own chords.
 *
 * `cell-editor` commands belong to CodeMirror *while the caret is in one* — it binds `Shift-Enter`
 * and `Ctrl-Enter` itself and would consume them before they reached the window, so `Cell.tsx`
 * contributes them to the editor's own keymap. In Jupyter's command mode the focus is on the cell's
 * box rather than in an editor, and then there is no keymap but this one: a `cell-editor` chord
 * arriving from outside a text surface is dispatched here. The test is the target rather than the
 * scope, so exactly one of the two paths ever runs. `app` and `notebook` need no distinction at this
 * level: a notebook only registers its commands while it is the active tab, so an unavailable
 * command simply is not in the registry.
 */
export function useCommandKeymap(): void {
  const commands = useCommands();
  // A ref so the listener is installed once rather than re-bound whenever the registry changes.
  const latest = useRef(commands);
  latest.current = commands;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isModifierKey(event.key)) {
        return;
      }
      // Nothing without a real modifier may be stolen from a text field, and CodeMirror's editable
      // surface is a contenteditable, so this is what keeps typing in a cell from firing commands.
      // A function key types nothing, so F1 still reaches Help from inside a cell.
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isFunctionKey(event.key) &&
        isTypingTarget(event.target)
      ) {
        return;
      }

      for (const command of latest.current) {
        if (
          !command.keys ||
          (command.scope === 'cell-editor' && isTypingTarget(event.target)) ||
          (command.scope === 'command-mode' && !isCommandModeTarget(event.target))
        ) {
          continue;
        }
        if (!command.keys.some((binding) => chordMatches(binding, event))) {
          continue;
        }
        // A disabled command does not consume its chord: better that the browser's own binding
        // still works than that the key does nothing at all.
        if (command.isEnabled && !command.isEnabled()) {
          return;
        }
        // Needed as much as the dispatch is: Mod-S otherwise opens the browser's save dialog.
        event.preventDefault();
        command.execute();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}

function isFunctionKey(key: string): boolean {
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(key);
}

/** A notebook cell's box with the keyboard itself, rather than anything inside it. */
function isCommandModeTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.hasAttribute('data-command-mode');
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    // The attribute rather than `isContentEditable`, which jsdom does not implement — and which
    // would miss a target nested inside the editable element anyway.
    target.closest('[contenteditable="true"]') !== null
  );
}
