import { useCallback } from 'react';
import { atom, useSetAtom } from 'jotai';

import { ConnectionList, listConnections, SqlColumns, SqlSchema } from '@/api';

/** The data connections, null until read. */
export const connectionsAtom = atom<ConnectionList | null>(null);

export function useLoadConnections(): () => Promise<void> {
  const set = useSetAtom(connectionsAtom);
  return useCallback(async () => {
    try {
      set(await listConnections());
    } catch (error) {
      console.error('Could not list the data connections:', error);
    }
  }, [set]);
}

/**
 * What has been read of each connection, by `name|kernel`: the Data panel's tree and a SQL cell's
 * completion read the same answers. Cleared by Refresh.
 */
export interface SchemaRead {
  schema?: SqlSchema;
  /** By `schema.table`. */
  columns: Record<string, SqlColumns>;
  loading?: boolean;
}

export const schemaReadsAtom = atom<Record<string, SchemaRead>>({});

export function schemaKey(name: string, kernel?: string): string {
  return `${name}|${kernel ?? ''}`;
}
