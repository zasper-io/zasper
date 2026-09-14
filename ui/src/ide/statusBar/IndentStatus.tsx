import React, { useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { selectAtom } from 'jotai/utils';

import { indentationOf } from '@/ide/editor/fileFormat';
import { useEditorSettings } from '@/store/editorSettingsActions';
import { FileFormat, fileFormatsAtom, Indentation } from '@/store/editorStatus';
import { MenuAction, MenuChoice, MenuGroup, MenuSeparator, StatusPicker } from './StatusMenu';

const TAB_SIZES = [2, 4, 8];

/** How the file in front is indented, and the menu that changes it for that file or for every file. */
export default function IndentStatus({ path }: { path: string }) {
  const formatAtom = useMemo(() => selectAtom(fileFormatsAtom, (formats) => formats[path]), [path]);
  const format = useAtomValue(formatAtom);
  const setFormats = useSetAtom(fileFormatsAtom);
  const [settings, changeSettings] = useEditorSettings();

  if (format === undefined) {
    return null;
  }

  const current = indentationOf(format, settings);
  const kind = current.indentWithTabs ? 'Tabs' : 'Spaces';
  const sizes = TAB_SIZES.includes(current.tabSize)
    ? TAB_SIZES
    : [...TAB_SIZES, current.tabSize].sort((a, b) => a - b);

  // A choice made here is the file's own, and no longer follows the settings when they change.
  const apply = (indentation: Indentation, source: FileFormat['source'] = 'chosen') =>
    setFormats((formats) =>
      formats[path] === undefined
        ? formats
        : { ...formats, [path]: { ...formats[path], ...indentation, source } }
    );

  return (
    <StatusPicker
      label={`${kind}: ${current.tabSize}`}
      spokenLabel={`Indentation: ${kind}: ${current.tabSize}`}
    >
      {(close) => {
        const then = (action: () => void) => () => {
          action();
          close();
        };
        return (
          <>
            <MenuGroup label="Indent with" />
            <MenuChoice
              label="Spaces"
              checked={!current.indentWithTabs}
              onSelect={then(() => apply({ ...current, indentWithTabs: false }))}
            />
            <MenuChoice
              label="Tabs"
              checked={current.indentWithTabs}
              onSelect={then(() => apply({ ...current, indentWithTabs: true }))}
            />
            <MenuSeparator />
            <MenuGroup label="Tab size" />
            {sizes.map((size) => (
              <MenuChoice
                key={size}
                label={String(size)}
                checked={size === current.tabSize}
                onSelect={then(() => apply({ ...current, tabSize: size }))}
              />
            ))}
            <MenuSeparator />
            <MenuAction
              label="Detect from the file"
              disabled={format.detected === null}
              onSelect={then(() => format.detected !== null && apply(format.detected))}
            />
            <MenuAction
              label="Use for every file"
              onSelect={then(() => {
                changeSettings({
                  tab_size: current.tabSize,
                  indent_with_tabs: current.indentWithTabs,
                });
                apply(current, 'settings');
              })}
            />
          </>
        );
      }}
    </StatusPicker>
  );
}
