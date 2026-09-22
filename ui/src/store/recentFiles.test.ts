import { beforeEach, describe, expect, it } from 'vitest';

import {
  folderOf,
  mergedRecent,
  readRecentFiles,
  RecentFile,
  rememberRecentFiles,
  withRecent,
} from './recentFiles';

const file = (path: string): RecentFile => ({
  path,
  name: path.split('/').pop() ?? path,
  type: 'file',
});

describe('withRecent', () => {
  it('puts what was opened in front, once', () => {
    const files = withRecent([file('a.py'), file('b.py')], file('b.py'));

    expect(files.map((entry) => entry.path)).toEqual(['b.py', 'a.py']);
  });

  it('keeps twenty', () => {
    let files: RecentFile[] = [];
    for (let count = 0; count < 25; count++) {
      files = withRecent(files, file(`file-${count}.py`));
    }

    expect(files).toHaveLength(20);
    expect(files[0].path).toBe('file-24.py');
  });
});

describe('remembering them', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads back what this project had open', () => {
    rememberRecentFiles('/work/rig', [file('a.py'), file('lib/b.py')]);

    expect(readRecentFiles('/work/rig').map((entry) => entry.path)).toEqual(['a.py', 'lib/b.py']);
  });

  // Two projects on one port are one origin, so the record says which project it is about.
  it('offers another project nothing', () => {
    rememberRecentFiles('/work/rig', [file('a.py')]);

    expect(readRecentFiles('/work/other')).toEqual([]);
  });

  // Opening a second project must not cost the first its list.
  it('keeps each project its own list', () => {
    rememberRecentFiles('/work/rig', [file('a.py')]);
    rememberRecentFiles('/work/other', [file('b.py')]);

    expect(readRecentFiles('/work/rig').map((entry) => entry.path)).toEqual(['a.py']);
    expect(readRecentFiles('/work/other').map((entry) => entry.path)).toEqual(['b.py']);
  });

  it('reads a record from before projects were kept apart', () => {
    localStorage.setItem(
      'zasper.recent',
      JSON.stringify({ version: 1, directory: '/work/rig', files: [file('a.py')] })
    );
    rememberRecentFiles('/work/other', [file('b.py')]);

    expect(readRecentFiles('/work/rig').map((entry) => entry.path)).toEqual(['a.py']);
  });

  it('ignores a record it cannot trust', () => {
    localStorage.setItem('zasper.recent', '{"version":1,"directory":"/work/rig","files":"a.py"}');

    expect(readRecentFiles('/work/rig')).toEqual([]);
  });

  it('drops an entry that is not a file it could open', () => {
    rememberRecentFiles('/work/rig', [
      file('a.py'),
      { path: 'shell', name: 'shell', type: 'terminal' },
    ]);

    expect(readRecentFiles('/work/rig').map((entry) => entry.path)).toEqual(['a.py']);
  });
});

describe('mergedRecent', () => {
  it('keeps what this session opened in front of what was remembered', () => {
    const merged = mergedRecent([file('new.py')], [file('old.py'), file('new.py')]);

    expect(merged.map((entry) => entry.path)).toEqual(['new.py', 'old.py']);
  });
});

describe('folderOf', () => {
  it('is the folder, and nothing at the project root', () => {
    expect(folderOf(file('lib/b.py'))).toBe('lib');
    expect(folderOf(file('a.py'))).toBe('');
  });
});
