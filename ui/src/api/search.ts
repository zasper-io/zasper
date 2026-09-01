import { requestJson } from './client';
import { IContentEntry } from './contents';

/** Returns the files whose name contains `query`. */
export function searchFiles(query: string): Promise<IContentEntry[]> {
  return requestJson<IContentEntry[]>('/api/files', { query: { query } });
}
