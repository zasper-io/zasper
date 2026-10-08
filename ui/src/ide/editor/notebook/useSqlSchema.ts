import { useEffect, useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';

import { DATAFRAMES, readColumns, readSchema } from '@/api';
import { finishedRunsAtom } from '@/store/kernels';
import { schemaKey, schemaReadsAtom } from '@/store/connections';
import { SqlNamespace } from './sqlEditor';

// Completion reads the columns of this many tables at most: a warehouse's thousands would be a thousand
// requests for a popup.
const MAX_TABLES = 30;

/**
 * The tables and columns a SQL cell's completion offers. A connection is read through the Data panel's own
 * kernel, once, and shares what the panel reads; the kernel's dataframes are read through this
 * notebook's kernel, again after each run, since a run is what changes them.
 */
export function useSqlSchema(
  connection: string,
  kernelId: string | undefined
): { namespace: SqlNamespace; defaultSchema?: string } {
  const frames = connection === DATAFRAMES;
  const kernel = frames ? kernelId : undefined;
  const key = schemaKey(connection, kernel);
  const [reads, setReads] = useAtom(schemaReadsAtom);
  const runs = useAtomValue(finishedRunsAtom)[kernelId ?? ''] ?? 0;
  const read = reads[key];

  useEffect(() => {
    if (connection === '' || (frames && kernel === undefined)) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setReads((all) => ({
        ...all,
        [key]: { ...all[key], columns: all[key]?.columns ?? {}, loading: true },
      }));
      try {
        const schema = await readSchema(connection, kernel);
        const columns: Record<string, Awaited<ReturnType<typeof readColumns>>> = {};
        const first = schema.schemas?.find((s) => s.default) ?? schema.schemas?.[0];
        for (const table of (first?.tables ?? []).slice(0, MAX_TABLES)) {
          columns[`${first?.name ?? ''}.${table.name}`] = await readColumns(
            connection,
            first?.name ?? '',
            table.name,
            kernel
          );
        }
        if (!cancelled) {
          setReads((all) => ({ ...all, [key]: { schema, columns, loading: false } }));
        }
      } catch {
        if (!cancelled) {
          setReads((all) => ({ ...all, [key]: { columns: {}, loading: false } }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Read when the cell's connection changes, and for the kernel's frames after every run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, frames ? runs : 0]);

  return useMemo(() => {
    const namespace: SqlNamespace = {};
    const schemas = read?.schema?.schemas ?? [];
    const first = schemas.find((s) => s.default) ?? schemas[0];
    for (const schema of schemas) {
      const tables: Record<string, string[]> = {};
      for (const table of schema.tables) {
        tables[table.name] = (read?.columns[`${schema.name}.${table.name}`]?.columns ?? []).map(
          (c) => c.name
        );
      }
      if (schema === first || schema.name === '') {
        Object.assign(namespace, tables);
      }
      if (schema.name !== '') {
        namespace[schema.name] = tables;
      }
    }
    return { namespace, defaultSchema: first?.name || undefined };
  }, [read]);
}
