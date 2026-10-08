import { requestJson } from './client';

/** Where a connection is kept: the project's `.zasper/connections.json`, or the user's. */
export type ConnectionScope = 'project' | 'user';

/** A data connection, as the server keeps it: never with its password. See docs/SQL.md. */
export interface DataConnection {
  name: string;
  type: string;
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  /** A file, for SQLite and DuckDB, read from the project when relative. */
  path?: string;
  /** A SQLAlchemy URL without its password, for type `url`. */
  url?: string;
  scope: ConnectionScope;
  has_password?: boolean;
}

export interface ConnectionList {
  connections: DataConnection[];
  types: string[];
}

/** The connection every Python kernel has: DuckDB over its own dataframes. */
export const DATAFRAMES = 'dataframes';

export function listConnections(): Promise<ConnectionList> {
  return requestJson<ConnectionList>('/api/connections');
}

/**
 * Adds or changes a connection. `previous` is the name being replaced, for a rename. An undefined
 * password keeps the stored one; an empty one removes it.
 */
export function saveConnection(
  connection: DataConnection,
  previous?: string,
  password?: string
): Promise<ConnectionList> {
  return requestJson<ConnectionList>('/api/connections', {
    method: 'PUT',
    body: { ...connection, previous, password },
  });
}

export function deleteConnection(scope: ConnectionScope, name: string): Promise<ConnectionList> {
  return requestJson<ConnectionList>('/api/connections', {
    method: 'DELETE',
    body: { scope, name },
  });
}

/** Hands a notebook's kernel the connection a SQL cell is about to run on. */
export function prepareConnection(kernel: string, name: string): Promise<{ ok: boolean }> {
  return requestJson('/api/connections/prepare', { method: 'POST', body: { kernel, name } });
}

export interface SqlProblem {
  error?: string;
  /** The package to install, when a driver is what is missing. */
  missing?: string;
}

export interface SqlTable {
  name: string;
  kind: 'table' | 'view' | 'dataframe';
  rows?: number;
}

export interface SqlSchema extends SqlProblem {
  schemas: { name: string; default?: boolean; tables: SqlTable[] }[] | null;
}

export interface SqlColumns extends SqlProblem {
  columns: { name: string; type: string }[] | null;
}

export interface SqlTest extends SqlProblem {
  ok: boolean;
  version?: string;
  ms?: number;
}

/** A connection's schemas and tables, read through `kernel`, or the Data panel's own when it is absent. */
export function readSchema(name: string, kernel?: string): Promise<SqlSchema> {
  return requestJson<SqlSchema>('/api/connections/schema', {
    method: 'POST',
    body: { name, kernel },
  });
}

export function readColumns(
  name: string,
  schema: string,
  table: string,
  kernel?: string
): Promise<SqlColumns> {
  return requestJson<SqlColumns>('/api/connections/columns', {
    method: 'POST',
    body: { name, schema, table, kernel },
  });
}

/** Connects with what a form holds, saved or not. */
export function testConnection(
  connection: DataConnection,
  password?: string,
  kernel?: string
): Promise<SqlTest> {
  return requestJson<SqlTest>('/api/connections/test', {
    method: 'POST',
    body: { connection, password, kernel },
  });
}

export interface Installed {
  ok: boolean;
  log: string;
}

/** Installs a package, such as a database driver, into a kernel's own environment. */
export function installIntoKernel(kernel: string, name: string): Promise<Installed> {
  return requestJson<Installed>(`/api/kernels/${encodeURIComponent(kernel)}/install`, {
    method: 'POST',
    body: { package: name },
  });
}
