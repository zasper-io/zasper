import { fireEvent, render, screen } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { describe, expect, it, vi } from 'vitest';

import { projectDirAtom } from '@/store/serverInfo';
import { fileTabsAtom } from '@/store/tabState';
import { Provider } from '@/testing/Provider';
import { useFollowLink } from './links';

function Text({ openDoc }: { openDoc?: (path: string) => boolean }) {
  const follow = useFollowLink(openDoc);
  const tabs = useAtomValue(fileTabsAtom);
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- as the panel's text
    <div onClick={follow}>
      <a href="file:///work/hello.py">in the project</a>
      <a href="file:///home/u/.gemini/plan.md">the plan</a>
      <a href="file:///etc/passwd">elsewhere</a>
      {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- what the sanitiser leaves of a link it drops */}
      <a href="">emptied</a>
      <a href="#note">a footnote</a>
      <a href="https://example.com/">a page</a>
      <pre data-testid="tabs">{Object.keys(tabs).join(',')}</pre>
    </div>
  );
}

// By text: an emptied anchor is not a link to the accessibility tree.
const press = (name: string) =>
  !fireEvent.click(screen.getByText(name)) ? 'kept here' : 'followed';

describe('useFollowLink', () => {
  it('opens a project file, a document the caller knows, and nothing anywhere else', () => {
    const openDoc = vi.fn((path: string) => path.endsWith('plan.md'));
    render(
      <Provider initialValues={[[projectDirAtom, '/work']]}>
        <Text openDoc={openDoc} />
      </Provider>
    );

    expect(press('in the project')).toBe('kept here');
    expect(screen.getByTestId('tabs')).toHaveTextContent('hello.py');
    expect(press('the plan')).toBe('kept here');
    expect(openDoc).toHaveBeenCalledWith('/home/u/.gemini/plan.md');
    expect(press('elsewhere')).toBe('kept here');
    expect(screen.getByTestId('tabs')).not.toHaveTextContent('passwd');
  });

  it('keeps an emptied link from reloading the IDE, and sends a web page to a new tab', () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    render(
      <Provider initialValues={[[projectDirAtom, '/work']]}>
        <Text />
      </Provider>
    );

    expect(press('emptied')).toBe('kept here');
    expect(press('a footnote')).toBe('followed');
    expect(press('a page')).toBe('kept here');
    expect(opened).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
    opened.mockRestore();
  });
});
