import { requestJson, requestText } from './client';

/** What would be started for one language, and whether it can be. */
export interface LanguageServerInfo {
  language: string;
  /** The language as a reader names it: `C and C++`. */
  name: string;
  /** The server as a reader names it: `gopls`. */
  server: string;
  command: string;
  found: boolean;
  path: string;
  /** The command that installs the preferred server. */
  install: string;
  /** The command came from Settings rather than from discovery. */
  configured: boolean;
  /** The program found, when the server is a package inside it: `julia`. */
  program?: string;
  /** What has to be installed in that program as well. */
  needs?: string;
}

export interface LanguageServerList {
  enabled: boolean;
  servers: LanguageServerInfo[];
}

export function getLanguageServers(): Promise<LanguageServerList> {
  return requestJson<LanguageServerList>('/api/lsp/servers');
}

/** What a language's servers have written to standard error. */
export function getLanguageServerLog(language: string): Promise<string> {
  return requestText('/api/lsp/log', { query: { language } });
}

/** Settings → Language servers, written as one object. */
export interface LanguageServerSettings {
  disabled: boolean;
  commands: Record<string, string>;
}
