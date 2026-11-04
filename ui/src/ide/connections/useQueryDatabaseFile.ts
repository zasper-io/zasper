import { useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { toast } from 'react-toastify';

import {
  apiErrorMessage,
  DataConnection,
  listConnections,
  readSchema,
  saveConnection,
} from '@/api';
import { sqlHeader, sqlName } from '@/ide/editor/notebook/sqlCell';
import { addedConnectionAtom, connectionsAtom } from '@/store/connections';
import { insertCellRequestAtom } from '@/store/editorRequests';
import { fileTabsAtom } from '@/store/tabState';
import { useRestricted } from '@/store/trust';
import { baseName } from '@/paths';
import { databaseFileType, suggestName } from './connectionString';

/**
 * The file tree's "Query in a SQL Cell" on a SQLite or DuckDB file: the file as a project connection,
 * if it is not one already, and a cell on it in the notebook in front, reading its first table. There
 * is nothing to ask about a file, so no dialog.
 */
export function useQueryDatabaseFile(): (path: string) => Promise<void> {
  const [list, setList] = useAtom(connectionsAtom);
  const setAdded = useSetAtom(addedConnectionAtom);
  const tabs = useAtomValue(fileTabsAtom);
  const request = useSetAtom(insertCellRequestAtom);
  const restricted = useRestricted();

  return useCallback(
    async (path: string) => {
      const type = databaseFileType(path);
      if (type === undefined) {
        return;
      }
      try {
        const known = list ?? (await listConnections());
        let connection = known.connections.find((c) => c.type === type && c.path === path);
        if (connection === undefined) {
          const added: DataConnection = {
            name: suggestName(
              { type, path },
              known.connections.map((c) => c.name)
            ),
            type,
            path,
            scope: 'project',
          };
          setList(await saveConnection(added));
          setAdded(added.name);
          connection = added;
        }

        const notebook = Object.values(tabs).find((tab) => tab.active && tab.type === 'notebook');
        if (notebook === undefined) {
          toast.info(`${connection.name} is a connection. Open a notebook to query it.`);
          return;
        }
        // Reading the tables runs code in a kernel, which a folder that is not trusted does not.
        let table = '';
        if (!restricted) {
          const schema = await readSchema(connection.name).catch(() => null);
          table = schema?.schemas?.flatMap((each) => each.tables)[0]?.name ?? '';
        }
        const out = table
          ? `df_${table.replace(/\W/g, '_')}`
          : `df_${baseName(path).split('.')[0].replace(/\W/g, '_')}`;
        request({
          path: notebook.path,
          source: `${sqlHeader({ connection: connection.name, out })}\n${table ? `SELECT *\nFROM ${sqlName(table)}\nLIMIT 100` : 'SELECT 1'}`,
        });
      } catch (error) {
        toast.error(apiErrorMessage(error));
      }
    },
    [list, setList, setAdded, tabs, request, restricted]
  );
}
