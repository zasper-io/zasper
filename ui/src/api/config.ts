import { requestEmpty, requestJson } from './client';

/** Response of /api/info, the IDE's boot payload. */
export interface IInfo {
  project: string;
  /**
   * The absolute path of the project directory. `project` is only its last segment and so is not an
   * identity — two projects named `demo` in different places share it — which is what anything
   * remembered per project, such as the open tabs, has to be told apart by.
   */
  directory: string;
  username: string;
  os: string;
  version: string;
  theme: string;
  protected: boolean;
}

/** Response of /api/config, the only endpoint reachable without a token. */
export interface IConfig {
  version: string;
  protected: boolean;
}

export function getInfo(): Promise<IInfo> {
  return requestJson<IInfo>('/api/info');
}

export function getConfig(): Promise<IConfig> {
  return requestJson<IConfig>('/api/config');
}

export function modifyConfig(key: string, value: string): Promise<void> {
  return requestEmpty('/api/config/modify', {
    method: 'POST',
    body: { key, value },
  });
}
