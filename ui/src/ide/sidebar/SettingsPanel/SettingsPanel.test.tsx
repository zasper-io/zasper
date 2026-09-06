import { fireEvent, render, screen } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsPanel from './SettingsPanel';
import { themeAtom } from '@/store/Settings';
import { themes } from '@/themes';

const modifyConfig = vi.fn();

vi.mock('@/api', () => ({
  modifyConfig: (key: string, value: string) => modifyConfig(key, value),
  logApiError: () => () => {},
}));

/** The atom is what the rest of the IDE reads, so the test reads it the same way. */
function ThemeProbe() {
  return <span data-testid="theme">{useAtomValue(themeAtom)}</span>;
}

function renderPanel() {
  return render(
    <Provider>
      <SettingsPanel hidden={false} />
      <ThemeProbe />
    </Provider>
  );
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modifyConfig.mockResolvedValue(undefined);
  });

  // The select had no label until the form family was ported, which is what makes this query possible.
  it('labels the theme picker', () => {
    renderPanel();
    expect(screen.getByLabelText('Theme')).toBe(screen.getByRole('combobox'));
  });

  it('offers every registered theme', () => {
    renderPanel();
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(
      themes.map((theme) => theme.label)
    );
  });

  it('applies the chosen theme and saves it', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'teal-dark' } });

    expect(screen.getByTestId('theme')).toHaveTextContent('teal-dark');
    expect(modifyConfig).toHaveBeenCalledWith('theme', 'teal-dark');
  });

  // A failed write must not undo the theme the user can already see.
  it('keeps the theme when saving it fails', async () => {
    modifyConfig.mockRejectedValue(new Error('disk full'));
    renderPanel();
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'orange-light' } });

    await Promise.resolve();
    expect(screen.getByTestId('theme')).toHaveTextContent('orange-light');
  });

  it('hides itself without unmounting, so the panel keeps its state', () => {
    const { container, rerender } = renderPanel();
    expect(container.querySelector('.nav-content')).not.toHaveClass('is-hidden');

    rerender(
      <Provider>
        <SettingsPanel hidden={true} />
      </Provider>
    );
    expect(container.querySelector('.nav-content')).toHaveClass('is-hidden');
  });
});
