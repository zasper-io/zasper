import { fireEvent, render, screen, within } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { describe, expect, it } from 'vitest';

import { chosenLanguagesAtom } from '@/store/editorStatus';
import { Provider } from '@/testing/Provider';
import LanguageStatus from './LanguageStatus';

/** What the editor reads: the language chosen for this file, if any. */
function ChosenProbe() {
  return <span data-testid="chosen">{String(useAtomValue(chosenLanguagesAtom)['notes'])}</span>;
}

function renderStatus(fileName = 'notes') {
  render(
    <Provider>
      <LanguageStatus path="notes" fileName={fileName} />
      <ChosenProbe />
    </Provider>
  );
}

function control(): HTMLElement {
  return screen.getByRole('button', { name: /^Language:/ });
}

function picker(): HTMLElement {
  return document.querySelector('.languagePicker') as HTMLElement;
}

describe('LanguageStatus', () => {
  it('reads the language off the file’s name', () => {
    renderStatus('prepare.py');

    expect(control()).toHaveTextContent('Python');
  });

  // The file the whole control is for: nothing claims `notes`, and it might be anything.
  it('says plain text for a file nothing claims', () => {
    renderStatus();

    expect(control()).toHaveTextContent('Plain Text');
  });

  it('chooses a language for this file, and says so', () => {
    renderStatus();
    fireEvent.click(control());

    fireEvent.change(screen.getByLabelText('Filter languages'), { target: { value: 'sql' } });
    fireEvent.click(within(picker()).getByText('SQL'));

    expect(screen.getByTestId('chosen')).toHaveTextContent('SQL');
    expect(control()).toHaveTextContent('SQL');
    expect(document.querySelector('.languagePicker')).toBeNull();
  });

  it('takes the row the arrow keys reached on Enter', () => {
    renderStatus();
    fireEvent.click(control());
    const field = screen.getByLabelText('Filter languages');

    fireEvent.change(field, { target: { value: 'sql' } });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });

    // Whatever the second match is, it is what the bar now says — and it is not the first.
    expect(control()).not.toHaveTextContent('Language: SQL$');
    expect(screen.getByTestId('chosen')).not.toHaveTextContent('undefined');
  });

  it('offers plain text, for a file some extension claims wrongly', () => {
    renderStatus('report.md');
    fireEvent.click(control());

    fireEvent.click(within(picker()).getByText('Plain Text'));

    expect(screen.getByTestId('chosen')).toHaveTextContent('Plain Text');
  });

  it('says when nothing matches', () => {
    renderStatus();
    fireEvent.click(control());

    fireEvent.change(screen.getByLabelText('Filter languages'), { target: { value: 'kerning' } });

    expect(within(picker()).getByText('No language matches “kerning”.')).toBeInTheDocument();
  });
});
