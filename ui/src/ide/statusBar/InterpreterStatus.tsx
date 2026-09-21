import React, { useRef, useState } from 'react';
import { useAtomValue } from 'jotai';

import InterpreterPicker from '@/ide/interpreter/InterpreterPicker';
import { useDismissOnEscape, useDismissOnPressOutside } from '@/ide/overlays';
import { interpreterChoiceAtom, pythonInUse } from '@/store/interpreters';

/** Which Python a file in front is run and read with, and the picker that changes it. */
export default function InterpreterStatus() {
  const choice = useAtomValue(interpreterChoiceAtom);
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDismissOnEscape(close, open);
  useDismissOnPressOutside(picker, close, open);

  if (choice === null) {
    return null;
  }
  const python = pythonInUse(choice);
  // The version and where it is from, not the path: seven items share this bar.
  const label = python ? `${python.version} · ${python.where}` : 'python3';

  return (
    <div className="statusItem statusPicker" ref={picker}>
      <button
        type="button"
        className="statusButton"
        aria-label={`Python interpreter: ${python?.executable ?? 'python3 from the shell'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {open && (
        <InterpreterPicker
          className="palette languagePicker"
          title="Run and read imports with"
          placeholder="Python interpreter"
          onClose={close}
        />
      )}
    </div>
  );
}
