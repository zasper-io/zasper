import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { interpreterChoiceAtom } from '@/store/interpreters';
import Topbar from './Topbar';

vi.mock('@/api', () => ({
  modifyConfig: vi.fn(),
  getInterpreters: vi.fn(),
  apiErrorMessage: String,
  logApiError: () => () => {},
  logout: vi.fn(),
  searchFiles: vi.fn().mockResolvedValue([]),
}));

describe('Select Python Interpreter', () => {
  // The palette closes itself once a command returns, and that close used to take the list with it.
  it('puts the list of Pythons where the palette was', () => {
    const store = createStore();
    store.set(interpreterChoiceAtom, {
      chosen: '',
      automatic: '',
      interpreters: [
        { executable: '/opt/homebrew/bin/python3', version: '3.13', where: 'Homebrew' },
      ],
    });
    render(
      <Provider store={store}>
        <MemoryRouter>
          <Topbar sidebarOpen onToggleSidebar={() => {}} />
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByText('Search files, or run a command'));
    const field = screen.getByPlaceholderText(/Search files/);
    fireEvent.change(field, { target: { value: '>Select Python' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(screen.getByPlaceholderText('Select a Python interpreter')).toBeInTheDocument();
    expect(screen.getByText('Python 3.13')).toBeInTheDocument();
  });
});
