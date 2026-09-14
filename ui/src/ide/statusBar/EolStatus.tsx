import React, { useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { selectAtom } from 'jotai/utils';

import { fileFormatsAtom, LineEnding } from '@/store/editorStatus';
import { MenuChoice, MenuGroup, StatusPicker } from './StatusMenu';

const LINE_ENDINGS: LineEnding[] = ['LF', 'CRLF'];

/** How the file in front's lines end, and the menu that changes it: the file is unsaved until it is written so. */
export default function EolStatus({ path }: { path: string }) {
  const formatAtom = useMemo(() => selectAtom(fileFormatsAtom, (formats) => formats[path]), [path]);
  const format = useAtomValue(formatAtom);
  const setFormats = useSetAtom(fileFormatsAtom);

  if (format === undefined) {
    return null;
  }

  const choose = (eol: LineEnding) =>
    setFormats((formats) =>
      formats[path] === undefined ? formats : { ...formats, [path]: { ...formats[path], eol } }
    );

  return (
    <StatusPicker label={format.eol} spokenLabel={`Line endings: ${format.eol}`}>
      {(close) => (
        <>
          <MenuGroup label="Line endings" />
          {LINE_ENDINGS.map((eol) => (
            <MenuChoice
              key={eol}
              label={eol}
              checked={eol === format.eol}
              onSelect={() => {
                choose(eol);
                close();
              }}
            />
          ))}
        </>
      )}
    </StatusPicker>
  );
}
