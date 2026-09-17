import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { toast } from 'react-toastify';

import {
  EditorSettings,
  getLanguageServers,
  LanguageServerSettings,
  logApiError,
  modifyConfig,
} from '@/api';
import { restartLanguageServer } from '@/lsp/servers';
import { languageServerListAtom } from '@/store/languageServers';
import { setTelemetrySettings } from '@/api/telemetry';
import { useEditorSettings } from '@/store/editorSettingsActions';
import { telemetryAtom, themeAtom, widgetCdnAtom } from '@/store/settings';
import { FileTab } from '@/store/tabState';
import { setEnabled, track } from '@/telemetry';
import { themes } from '@/themes';
import './SettingsTab.scss';

const TAB_SIZES = [2, 4, 8];

interface Setting {
  /** The control's id, which the setting's name labels. */
  id: string;
  group: string;
  name: string;
  help: ReactNode;
  /** What the search matches besides the group and the name: the help as text, and a select's choices. */
  words: string;
  control: ReactNode;
}

interface SettingsTabProps {
  data: FileTab;
}

/** Every setting, grouped and searchable, each with a sentence saying what it does. */
export default function SettingsTab({ data }: SettingsTabProps) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const settings = useSettings();

  useEffect(() => {
    if (data.active) {
      search.current?.focus({ preventScroll: true });
    }
  }, [data.active]);

  const needle = query.trim().toLowerCase();
  const groups = new Map<string, Setting[]>();
  for (const setting of settings) {
    const haystack = `${setting.group} ${setting.name} ${setting.words}`.toLowerCase();
    if (needle === '' || haystack.includes(needle)) {
      groups.set(setting.group, [...(groups.get(setting.group) ?? []), setting]);
    }
  }

  return (
    <div className="settings-tab">
      <input
        ref={search}
        className="z-field settings-tab-search"
        type="text"
        placeholder="Search settings"
        aria-label="Search settings"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {groups.size === 0 && <p className="z-note">No setting matches “{query.trim()}”.</p>}
      {[...groups].map(([group, rows]) => (
        <section key={group} aria-label={group}>
          <h3 className="z-label settings-tab-group">{group}</h3>
          {rows.map((setting) => (
            <div key={setting.id} className="settings-tab-row">
              <div>
                <label className="settings-tab-name" htmlFor={setting.id}>
                  {setting.name}
                </label>
                <p className="z-form-help">{setting.help}</p>
              </div>
              {setting.control}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function useSettings(): Setting[] {
  const [theme, setTheme] = useAtom(themeAtom);
  const [telemetry, setTelemetry] = useAtom(telemetryAtom);
  const [widgetCdn, setWidgetCdn] = useAtom(widgetCdnAtom);
  const [editor, changeEditor] = useEditorSettings();
  const [servers, setServers] = useAtom(languageServerListAtom);

  // Written whole, from what the server list says is configured, and every server changed is started again
  // so the new command or the switch takes effect without reopening a file.
  const changeServers = (change: { enabled?: boolean; commands?: Record<string, string> }) => {
    if (servers === null) {
      return;
    }
    const configured = Object.fromEntries(
      servers.servers
        .filter((server) => server.configured)
        .map((server) => [server.language, server.command])
    );
    const settings: LanguageServerSettings = {
      disabled: !(change.enabled ?? servers.enabled),
      commands: { ...configured, ...change.commands },
    };
    modifyConfig('language_servers', JSON.stringify(settings))
      .then(() => getLanguageServers())
      .then((list) => {
        setServers(list);
        const restarted =
          change.enabled === undefined
            ? Object.keys(change.commands ?? {})
            : list.servers.map((server) => server.language);
        restarted.forEach(restartLanguageServer);
      })
      .catch(logApiError('Error saving the language server settings:'));
  };

  const changeTheme = (id: string) => {
    setTheme(id);
    modifyConfig('theme', id).catch(logApiError('Error saving theme:'));
    track('theme_changed', { theme_id: id });
  };

  const changeTelemetry = (enabled: boolean) => {
    // Applied locally first so the collector stops the moment the box is cleared, rather than at the
    // end of a round trip that may fail.
    setEnabled(enabled);
    setTelemetry({ ...telemetry, enabled });
    setTelemetrySettings({ enabled })
      .then((settings) => {
        setEnabled(settings.enabled);
        setTelemetry(settings);
      })
      .catch(logApiError('Error saving the usage data setting:'));
  };

  const resetTrackingId = () => {
    setTelemetrySettings({ reset_id: true })
      .then(() => toast.success('A new anonymous ID was generated.'))
      .catch(logApiError('Error resetting the anonymous ID:'));
  };

  const changeWidgetCdn = (allowed: boolean) => {
    setWidgetCdn(allowed);
    modifyConfig('widget_cdn', allowed ? 'on' : 'off').catch(
      logApiError('Error saving the widget setting:')
    );
  };

  // A size set in .editorconfig terms, or by an older version, is still offered as itself.
  const tabSizes = TAB_SIZES.includes(editor.tab_size)
    ? TAB_SIZES
    : [...TAB_SIZES, editor.tab_size].sort((a, b) => a - b);

  return [
    {
      id: 'settings-theme',
      group: 'Appearance',
      name: 'Theme',
      help: 'The colours of the whole app.',
      words: themes.map((option) => option.label).join(' '),
      control: (
        <div className="z-select">
          <select id="settings-theme" value={theme} onChange={(e) => changeTheme(e.target.value)}>
            {themes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ),
    },
    {
      id: 'settings-font-size',
      group: 'Editor',
      name: 'Font size',
      help: 'Of the file editor’s text, in pixels, from 8 to 32.',
      words: 'pixels',
      control: (
        <CommittedField
          id="settings-font-size"
          shown={String(editor.font_size)}
          parse={parseFontSize}
          onCommit={(font_size) => changeEditor({ font_size })}
        />
      ),
    },
    {
      id: 'settings-tab-size',
      group: 'Editor',
      name: 'Tab size',
      help: 'How many columns a tab or an indent is.',
      words: 'columns indent',
      control: (
        <div className="z-select">
          <select
            id="settings-tab-size"
            value={editor.tab_size}
            onChange={(e) => changeEditor({ tab_size: Number(e.target.value) })}
          >
            {tabSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      ),
    },
    {
      id: 'settings-indent-with',
      group: 'Editor',
      name: 'Indent with',
      help: 'A project’s .editorconfig wins for the files it covers.',
      words: 'spaces tabs editorconfig',
      control: (
        <div className="z-select">
          <select
            id="settings-indent-with"
            value={editor.indent_with_tabs ? 'tabs' : 'spaces'}
            onChange={(e) => changeEditor({ indent_with_tabs: e.target.value === 'tabs' })}
          >
            <option value="spaces">Spaces</option>
            <option value="tabs">Tabs</option>
          </select>
        </div>
      ),
    },
    {
      id: 'settings-word-wrap',
      group: 'Editor',
      name: 'Wrap long lines',
      help: 'A line wider than the editor continues on the next row instead of scrolling sideways.',
      words: 'word wrap',
      control: (
        <Checkbox
          id="settings-word-wrap"
          checked={editor.word_wrap}
          onChange={(word_wrap) => changeEditor({ word_wrap })}
        />
      ),
    },
    {
      id: 'settings-line-numbers',
      group: 'Editor',
      name: 'Line numbers',
      help: 'Numbered down the left of the file editor.',
      words: 'gutter',
      control: (
        <Checkbox
          id="settings-line-numbers"
          checked={editor.line_numbers}
          onChange={(line_numbers) => changeEditor({ line_numbers })}
        />
      ),
    },
    {
      id: 'settings-show-whitespace',
      group: 'Editor',
      name: 'Show whitespace',
      help: 'A mark for every space, so trailing and mixed indentation can be seen.',
      words: 'render invisible',
      control: (
        <Checkbox
          id="settings-show-whitespace"
          checked={editor.show_whitespace}
          onChange={(show_whitespace) => changeEditor({ show_whitespace })}
        />
      ),
    },
    {
      id: 'settings-rulers',
      group: 'Editor',
      name: 'Rulers',
      help: 'Columns to draw a guide at, or empty for none.',
      words: 'guides columns',
      control: (
        <CommittedField
          id="settings-rulers"
          shown={editor.rulers.join(', ')}
          parse={parseRulers}
          onCommit={(rulers) => changeEditor({ rulers })}
        />
      ),
    },
    {
      id: 'settings-trim-whitespace',
      group: 'Editor',
      name: 'Trim trailing whitespace',
      help: 'On save, blanks at the end of a line are removed. A project’s .editorconfig wins.',
      words: 'spaces tabs editorconfig save',
      control: (
        <Checkbox
          id="settings-trim-whitespace"
          checked={editor.trim_trailing_whitespace}
          onChange={(trim_trailing_whitespace) => changeEditor({ trim_trailing_whitespace })}
        />
      ),
    },
    {
      id: 'settings-final-newline',
      group: 'Editor',
      name: 'Insert a final newline',
      help: 'On save, a file that does not end in a newline is given one. A project’s .editorconfig wins.',
      words: 'editorconfig save end of file',
      control: (
        <Checkbox
          id="settings-final-newline"
          checked={editor.insert_final_newline}
          onChange={(insert_final_newline) => changeEditor({ insert_final_newline })}
        />
      ),
    },
    {
      id: 'settings-auto-save',
      group: 'Editor',
      name: 'Save automatically',
      help: 'A second after the typing stops. A file that changed on disk under unsaved edits is never saved this way — that answer is yours to give.',
      words: 'autosave',
      control: (
        <Checkbox
          id="settings-auto-save"
          checked={editor.auto_save}
          onChange={(auto_save) => changeEditor({ auto_save })}
        />
      ),
    },
    {
      id: 'settings-format-on-save',
      group: 'Editor',
      name: 'Format on save',
      help: 'The file’s language server formats it before it is written. Nothing happens for a file with no server.',
      words: 'lsp formatting gofmt prettier black',
      control: (
        <Checkbox
          id="settings-format-on-save"
          checked={editor.format_on_save}
          onChange={(format_on_save) => changeEditor({ format_on_save })}
        />
      ),
    },
    {
      id: 'settings-inlay-hints',
      group: 'Editor',
      name: 'Inlay hints',
      help: 'Parameter names and inferred types from the language server, drawn in the line and absent from the file. Off by default: they move the text of every line they appear on.',
      words: 'lsp types parameter names ghost text',
      control: (
        <Checkbox
          id="settings-inlay-hints"
          checked={editor.inlay_hints}
          onChange={(inlay_hints) => changeEditor({ inlay_hints })}
        />
      ),
    },
    {
      id: 'settings-keymap',
      group: 'Editor',
      name: 'Keymap',
      help: 'Vim and Emacs bindings, in the file editor. A notebook’s cells keep their own keys, where Escape and Enter already mean something.',
      words: 'vim emacs bindings default',
      control: (
        <div className="z-select">
          <select
            id="settings-keymap"
            value={editor.keymap}
            onChange={(e) => changeEditor({ keymap: e.target.value as EditorSettings['keymap'] })}
          >
            <option value="default">Default</option>
            <option value="vim">Vim</option>
            <option value="emacs">Emacs</option>
          </select>
        </div>
      ),
    },
    {
      id: 'settings-notebook-contents',
      group: 'Notebook',
      name: 'Show the table of contents',
      help: "A notebook's headings, in a column beside its cells. The toolbar's button turns it on for one notebook.",
      words: 'outline headings toc navigation',
      control: (
        <Checkbox
          id="settings-notebook-contents"
          checked={editor.notebook_contents}
          onChange={(notebook_contents) => changeEditor({ notebook_contents })}
        />
      ),
    },
    {
      id: 'settings-cell-tab-indents',
      group: 'Notebook',
      name: 'Insert a tab in a cell',
      help: 'Off: Tab completes from the kernel.',
      words: 'completion indent kernel',
      control: (
        <Checkbox
          id="settings-cell-tab-indents"
          checked={editor.cell_tab_indents}
          onChange={(cell_tab_indents) => changeEditor({ cell_tab_indents })}
        />
      ),
    },
    ...(servers === null
      ? []
      : [
          {
            id: 'settings-language-servers',
            group: 'Language servers',
            name: 'Use language servers',
            help: 'Errors, completion, hover and go to definition in the file editor. Off: no server is ever started.',
            words: 'lsp errors completion definition diagnostics',
            control: (
              <Checkbox
                id="settings-language-servers"
                checked={servers.enabled}
                onChange={(enabled) => changeServers({ enabled })}
              />
            ),
          },
          ...servers.servers.map((server) => ({
            id: `settings-language-server-${server.language}`,
            group: 'Language servers',
            name: server.name,
            help: !server.found ? (
              <span className="settings-tab-missing">
                Not found. <code>{server.install}</code>
              </span>
            ) : server.configured ? (
              <>Starts {server.command}.</>
            ) : server.needs !== undefined ? (
              <>
                Found {server.program} in {folderOf(server.path)}. Needs {server.needs}:{' '}
                <code>{server.install}</code>
              </>
            ) : (
              <>
                Found {server.server} in {folderOf(server.path)}.
              </>
            ),
            words: `${server.server} ${server.command} lsp language server command`,
            control: (
              <CommittedField
                id={`settings-language-server-${server.language}`}
                shown={server.configured ? server.command : ''}
                placeholder={server.command}
                className="settings-tab-command"
                parse={(text) => text.trim()}
                onCommit={(command) => changeServers({ commands: { [server.language]: command } })}
              />
            ),
          })),
        ]),
    {
      id: 'settings-telemetry',
      group: 'Privacy',
      name: 'Send anonymous usage data',
      help: (
        <>
          Counts of what gets used — never file names, paths, or code.{' '}
          <a
            href="https://github.com/zasper-io/zasper/blob/main/PRIVACY.md"
            target="_blank"
            rel="noreferrer"
          >
            PRIVACY.md
          </a>{' '}
          lists every event.
        </>
      ),
      words: 'telemetry counts file names paths code privacy.md event',
      control: (
        <Checkbox id="settings-telemetry" checked={telemetry.enabled} onChange={changeTelemetry} />
      ),
    },
    {
      id: 'settings-reset-id',
      group: 'Privacy',
      name: 'Anonymous ID',
      help: 'Resetting breaks the link between what has already been sent and what is sent next.',
      words: 'reset telemetry',
      control: (
        <button
          id="settings-reset-id"
          type="button"
          className="z-button z-button-secondary"
          onClick={resetTrackingId}
        >
          Reset
        </button>
      ),
    },
    {
      id: 'settings-widget-cdn',
      group: 'Privacy',
      name: 'Load widget libraries from the internet',
      help: 'Widgets from outside ipywidgets, such as bqplot or ipyleaflet, get their code from cdn.jsdelivr.net. Turned off, those widgets are not shown.',
      words: 'cdn jsdelivr ipywidgets bqplot ipyleaflet',
      control: <Checkbox id="settings-widget-cdn" checked={widgetCdn} onChange={changeWidgetCdn} />,
    },
  ];
}

function Checkbox(props: { id: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="z-checkbox">
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
    </label>
  );
}

interface CommittedFieldProps<T> {
  id: string;
  shown: string;
  placeholder?: string;
  className?: string;
  /** The value typed, or null when it is not one; the field then goes back to what is set. */
  parse: (text: string) => T | null;
  onCommit: (value: T) => void;
}

/** Saved on Enter or on leaving the field, not per keystroke: `1` on the way to `14` is not a size. */
function CommittedField<T>({
  id,
  shown,
  placeholder,
  className,
  parse,
  onCommit,
}: CommittedFieldProps<T>) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) {
      return;
    }
    const value = parse(draft);
    setDraft(null);
    if (value !== null) {
      onCommit(value);
    }
  };

  return (
    <input
      id={id}
      className={className === undefined ? 'z-field' : `z-field ${className}`}
      type="text"
      placeholder={placeholder}
      value={draft ?? shown}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
        } else if (event.key === 'Escape') {
          setDraft(null);
        }
      }}
    />
  );
}

export function parseFontSize(text: string): number | null {
  const size = Number(text.trim());
  return Number.isInteger(size) && size >= 8 && size <= 32 ? size : null;
}

/** `80, 100` or `80 100`; at most four, as the server keeps. */
export function parseRulers(text: string): number[] | null {
  const columns = text
    .split(/[\s,]+/)
    .filter((part) => part !== '')
    .map(Number);
  if (columns.some((column) => !Number.isInteger(column) || column < 1 || column > 500)) {
    return null;
  }
  return [...new Set(columns)].sort((a, b) => a - b).slice(0, 4);
}

/** The folder a program is in, which is what says where a server was found. */
function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash <= 0 ? path : path.slice(0, slash);
}
