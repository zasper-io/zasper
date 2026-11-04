import { DataConnection } from '@/api';

/** The port each server engine listens on unless told otherwise. */
export const DEFAULT_PORTS: Record<string, string> = {
  postgresql: '5432',
  redshift: '5439',
  mysql: '3306',
  clickhouse: '8123',
};

/** What a connection is, before it has a name or a place to be kept. */
export type ConnectionFields = Omit<DataConnection, 'name' | 'scope' | 'has_password'>;

export interface ParsedConnection {
  fields: ConnectionFields;
  /** Taken out of the URL, for the keychain. */
  password?: string;
  /** The engine to name and draw it by: its type, or a URL's dialect. */
  engine: string;
}

// SQLAlchemy's own grammar for a URL (sqlalchemy.engine.url._parse_url), so what the kernel will read
// is what is read here: a password runs to the last @ before the host, and may hold a / or a :.
const URL_PATTERN =
  /^([\w+]+):\/\/(?:([^:/]*)(?::([^@]*))?@)?(?:(?:\[([^/?]+)\]|([^/:?]+))?(?::([^/?]*))?)?(?:\/([^?]*))?(?:\?(.*))?$/;

// The dialects with a form of their own, and the driver that form connects with.
const FORM_ENGINES: Record<string, string[]> = {
  postgresql: ['postgresql', 'postgresql+psycopg'],
  mysql: ['mysql', 'mysql+pymysql'],
  redshift: ['redshift'],
  clickhouse: ['clickhouse'],
};

const KNOWN_DIALECTS = new Set(['snowflake', 'bigquery', 'databricks', 'redshift', 'clickhouse']);

function unquote(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Reads a pasted connection string. A URL whose every part a form has a field for becomes that form;
 * any other, a driver of its own or options such as `?sslmode=require`, stays a URL connection, named
 * by its engine. Either way the password is taken out. Null for what is not a URL at all.
 */
export function parseConnectionString(text: string): ParsedConnection | null {
  const match = URL_PATTERN.exec(text.trim());
  if (match === null) {
    return null;
  }
  const [, rawScheme, rawUser, rawPassword, ipv6, ipv4, port, database, query] = match;
  // SQLAlchemy dropped the postgres:// spelling that hosts still hand out.
  const scheme = rawScheme.replace(/^postgres(?=$|\+)/i, 'postgresql');
  const dialect = scheme.toLowerCase().split('+')[0];
  const password =
    rawPassword !== undefined && rawPassword !== '' ? unquote(rawPassword) : undefined;

  if (
    (dialect === 'sqlite' || dialect === 'duckdb') &&
    query === undefined &&
    rawUser === undefined
  ) {
    const path = database ?? '';
    return { fields: { type: dialect, path: path === ':memory:' ? '' : path }, engine: dialect };
  }

  const form = Object.keys(FORM_ENGINES).find((type) =>
    FORM_ENGINES[type].includes(scheme.toLowerCase())
  );
  if (form !== undefined && query === undefined && !(database ?? '').includes('/')) {
    return {
      fields: {
        type: form,
        host: ipv6 ?? ipv4 ?? '',
        port: port || DEFAULT_PORTS[form],
        database: unquote(database ?? ''),
        user: unquote(rawUser ?? ''),
      },
      password,
      engine: form,
    };
  }

  // The URL as it was typed, less its password: what follows the @ is kept byte for byte.
  const afterUser = text.trim().slice(text.trim().indexOf('://') + 3);
  const rest = rawUser !== undefined ? afterUser.slice(afterUser.indexOf('@') + 1) : afterUser;
  const user = rawUser ? `${rawUser}@` : '';
  return {
    fields: { type: 'url', url: `${scheme}://${user}${rest}` },
    password,
    engine: KNOWN_DIALECTS.has(dialect) ? dialect : 'url',
  };
}

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/** The last part of a path, as a file's name. */
function lastPart(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? '';
}

/**
 * A name for a connection nobody has named yet: its database's, its file's, or its host's, made into
 * one the server accepts, with `-2` and so on when it is taken.
 */
export function suggestName(fields: ConnectionFields, taken: string[]): string {
  const fromUrl = fields.url ? lastPart(fields.url.split('?')[0].split('://')[1] ?? '') : '';
  const candidate =
    (fields.type === 'sqlite' || fields.type === 'duckdb'
      ? lastPart(fields.path ?? '')
      : fields.database || fromUrl || (fields.host ?? '').split('.')[0]) || fields.type;
  let base = candidate.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 60);
  if (!/^[A-Za-z]/.test(base)) {
    base = `db_${base}`.slice(0, 60);
  }
  if (!NAME_PATTERN.test(base) || base === 'dataframes') {
    base = fields.type;
  }
  let name = base;
  for (let n = 2; taken.includes(name); n++) {
    name = `${base}-${n}`;
  }
  return name;
}

const DATABASE_EXTENSIONS: Record<string, 'sqlite' | 'duckdb'> = {
  db: 'sqlite',
  sqlite: 'sqlite',
  sqlite3: 'sqlite',
  duckdb: 'duckdb',
};

/** The connection type a file is by its extension, as the server's database file list reads it. */
export function databaseFileType(path: string): 'sqlite' | 'duckdb' | undefined {
  return DATABASE_EXTENSIONS[path.split('.').pop()?.toLowerCase() ?? ''];
}
