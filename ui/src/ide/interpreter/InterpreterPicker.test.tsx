import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InterpreterStatus from '@/ide/statusBar/InterpreterStatus';
import { interpreterChoiceAtom } from '@/store/interpreters';
import InterpreterPicker from './InterpreterPicker';

const modifyConfig = vi.fn();
const getInterpreters = vi.fn();

vi.mock('@/api', () => ({
  modifyConfig: (key: string, value: string) => modifyConfig(key, value),
  getInterpreters: () => getInterpreters(),
  apiErrorMessage: (error: unknown) => String(error),
}));

const choice = {
  chosen: '',
  automatic: '/p/.venv/bin/python3',
  interpreters: [
    { executable: '/p/.venv/bin/python3', version: '3.12', where: '.venv' },
    { executable: '/opt/homebrew/bin/python3', version: '3.13', where: 'Homebrew' },
  ],
};

function renderIn(ui: React.ReactElement, value = choice) {
  const store = createStore();
  store.set(interpreterChoiceAtom, value);
  render(<Provider store={store}>{ui}</Provider>);
  return store;
}

describe('the interpreter picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modifyConfig.mockResolvedValue(undefined);
    getInterpreters.mockResolvedValue(choice);
  });

  const picker = (onClose = vi.fn()) => (
    <InterpreterPicker className="palette" title="Pythons" placeholder="Python" onClose={onClose} />
  );

  it('lists automatic, saying what it means here, then every Python found', () => {
    renderIn(picker());
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent);
    expect(rows).toEqual([
      'Automaticthis project’s .venv · 3.12',
      'Python 3.12.venv · /p/.venv/bin/python3',
      'Python 3.13Homebrew · /opt/homebrew/bin/python3',
    ]);
  });

  it('narrows as it is typed into, and Enter chooses the first row left', () => {
    const onClose = vi.fn();
    renderIn(picker(onClose));
    const field = screen.getByLabelText('Python');
    fireEvent.change(field, { target: { value: 'homebrew' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(modifyConfig).toHaveBeenCalledWith('python_interpreter', '/opt/homebrew/bin/python3');
    expect(onClose).toHaveBeenCalled();
  });

  it('writes nothing when the row chosen is the one already in use', () => {
    const onClose = vi.fn();
    renderIn(picker(onClose));
    fireEvent.click(screen.getByText('Automatic'));
    expect(modifyConfig).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('opening the picker', () => {
  it('starts on the Python in use', () => {
    renderIn(
      <InterpreterPicker
        className="palette"
        title="Pythons"
        placeholder="Python"
        onClose={vi.fn()}
      />,
      { ...choice, chosen: '/opt/homebrew/bin/python3' }
    );
    expect(screen.getByText('Python 3.13').closest('li')).toHaveClass('is-selected');
  });
});

describe('the status bar item', () => {
  it('names the Python in use by version and where it came from, and opens the picker', () => {
    renderIn(<InterpreterStatus />, { ...choice, chosen: '/opt/homebrew/bin/python3' });
    const item = screen.getByRole('button', { name: /Python interpreter/ });
    expect(item).toHaveTextContent('3.13 · Homebrew');

    fireEvent.click(item);
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('says python3 when there is nothing chosen and no project environment', () => {
    renderIn(<InterpreterStatus />, { chosen: '', automatic: '', interpreters: [] });
    expect(screen.getByRole('button', { name: /Python interpreter/ })).toHaveTextContent('python3');
  });
});
