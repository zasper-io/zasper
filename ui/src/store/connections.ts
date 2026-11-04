import { useCallback } from 'react';
import { atom, useSetAtom } from 'jotai';

import { ConnectionList, DataConnection, listConnections, SqlColumns, SqlSchema } from '@/api';

/** The data connections, null until read. */
export const connectionsAtom = atom<ConnectionList | null>(null);

/**
 * Add a connection, or edit one, over whatever tab is in front: every way in (a SQL cell's picker, the
 * Data panel, Settings, the palette) asks here, and the IDE draws the one dialog. See docs/SQL.md.
 */
export interface ConnectionDialogRequest {
  /** The connection to edit; absent to add one. */
  editing?: DataConnection;
  /** Told the new connection's name once it is saved, so the SQL cell that asked runs on it. */
  onAdded?: (name: string) => void;
}

export const connectionDialogAtom = atom<ConnectionDialogRequest | null>(null);

export function useOpenConnectionDialog(): (request?: ConnectionDialogRequest) => void {
  const set = useSetAtom(connectionDialogAtom);
  return useCallback((request: ConnectionDialogRequest = {}) => set(request), [set]);
}

/** The connection added last, which the Data panel shows open on its tables. */
export const addedConnectionAtom = atom<string | null>(null);

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
