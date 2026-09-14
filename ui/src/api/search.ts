import { requestJson } from './client';
import { ContentEntry } from './contents';

/** Returns the files whose name contains `query`. */
export function searchFiles(query: string): Promise<ContentEntry[]> {
  return requestJson<ContentEntry[]>('/api/files', { query: { query } });
}
