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
