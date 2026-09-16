import { requestEmpty, requestJson } from './client';

/** Response of /api/info, the IDE's boot payload. */
export interface ServerInfo {
  project: string;
  /**
   * The absolute path of the project directory. `project` is only its last segment and so is not an
   * identity — two projects named `demo` in different places share it — which is what anything
   * remembered per project, such as the open tabs, has to be told apart by.
   */
  directory: string;
  username: string;
  os: string;
  arch: string;
  version: string;
  theme: string;
  /** Whether widget libraries that are not bundled may be loaded from the CDN: Settings → Privacy. */
  widget_cdn: boolean;
  /** Absent from a server older than the setting. */
  editor?: EditorSettings;
}

export function getInfo(): Promise<ServerInfo> {
  return requestJson<ServerInfo>('/api/info');
}

export function modifyConfig(key: string, value: string): Promise<void> {
  return requestEmpty('/api/config/modify', {
    method: 'POST',
    body: { key, value },
  });
}

/** The file editor's defaults: Settings → Editor. A project's .editorconfig wins for the files it covers. */
export interface EditorSettings {
  font_size: number;
  tab_size: number;
  indent_with_tabs: boolean;
  word_wrap: boolean;
  line_numbers: boolean;
  show_whitespace: boolean;
  /** Columns a guide is drawn at. */
  rulers: number[];
  /** A notebook cell's Tab inserts an indent rather than asking the kernel to complete. */
  cell_tab_indents: boolean;
  /** What a save does to whitespace, unless the file's .editorconfig says otherwise. */
  trim_trailing_whitespace: boolean;
  insert_final_newline: boolean;
  /** Save a file a second after the typing stops. */
  auto_save: boolean;
  /** Ask the file's language server to format it before it is written. */
  format_on_save: boolean;
  /** Draw the parameter names and inferred types the server offers, in the line. */
  inlay_hints: boolean;
  /** Which bindings the file editor takes. */
  keymap: 'default' | 'vim' | 'emacs';
}

/** Written as one object: a default for one of these alone means nothing. */
export function saveEditorSettings(settings: EditorSettings): Promise<void> {
  return modifyConfig('editor', JSON.stringify(settings));
}
