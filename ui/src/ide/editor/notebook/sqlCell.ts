/**
 * A SQL cell is a code cell whose first line is `%%zasper_sql <connection> --out <name> [--limit n]`
 * and whose rest is the query: a notebook JupyterLab can open, and runs with `pip install zasper-sql`.
 * This is the one place that line is read and written. See docs/SQL.md.
 */

export const SQL_MAGIC = '%%zasper_sql';

export interface SqlCell {
  connection: string;
  /** The dataframe the result is assigned to. */
  out: string;
  /** Rows fetched at most; null for all of them, undefined for the default. */
  limit?: number | null;
  /** The query, without the magic line. */
  query: string;
  /** The magic line's length with its newline: where the query starts in the source. */
  headerLength: number;
}

function quote(word: string): string {
  return /^[A-Za-z0-9_.:/@-]+$/.test(word) ? word : `'${word.replace(/'/g, `'"'"'`)}'`;
}

/** The cell as a SQL cell, or null when its first line is not the magic. */
export function parseSqlCell(source: string): SqlCell | null {
  const newline = source.indexOf('\n');
  const line = newline === -1 ? source : source.slice(0, newline);
  if (!line.startsWith(SQL_MAGIC + ' ') && line !== SQL_MAGIC) {
    return null;
  }
  const words = line.slice(SQL_MAGIC.length).trim().split(/\s+/).filter(Boolean);
  let connection = '';
  let out = '_';
  let limit: number | null | undefined;
  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(/^'(.*)'$/, '$1');
    if (word === '--out' && i + 1 < words.length) {
      out = words[++i];
    } else if (word === '--limit' && i + 1 < words.length) {
      const value = words[++i];
      limit = ['none', 'all', '0'].includes(value) ? null : Number(value);
    } else if (!word.startsWith('--') && connection === '') {
      connection = word;
    }
  }
  return {
    connection,
    out,
    limit,
    query: newline === -1 ? '' : source.slice(newline + 1),
    headerLength: newline === -1 ? source.length : newline + 1,
  };
}

/** The magic line for a cell. */
export function sqlHeader({
  connection,
  out,
  limit,
}: Omit<SqlCell, 'query' | 'headerLength'>): string {
  let line = `${SQL_MAGIC} ${quote(connection)} --out ${out}`;
  if (limit === null) {
    line += ' --limit none';
  } else if (limit !== undefined) {
    line += ` --limit ${limit}`;
  }
  return line;
}

/** The source with its magic line changed, the query left exactly as it was. */
export function withSqlOptions(source: string, changes: Partial<Omit<SqlCell, 'query'>>): string {
  const cell = parseSqlCell(source);
  if (cell === null) {
    return source;
  }
  return `${sqlHeader({ ...cell, ...changes })}\n${cell.query}`;
}

/** A code cell turned into a SQL cell on `connection`, its code kept as the query. */
export function toSqlSource(source: string, connection: string, out: string): string {
  return `${sqlHeader({ connection, out })}\n${source}`;
}

/** A SQL cell turned back into a code cell: its query, without the magic. */
export function fromSqlSource(source: string): string {
  const cell = parseSqlCell(source);
  return cell === null ? source : cell.query;
}

/**
 * The source a run sends for Load all or Run fresh: the same cell with a flag added for this run only,
 * so the notebook keeps the cell as it was written.
 */
export function withRunFlags(source: string, flags: { all?: boolean; fresh?: boolean }): string {
  const cell = parseSqlCell(source);
  if (cell === null) {
    return source;
  }
  let line = sqlHeader({ ...cell, limit: flags.all ? null : cell.limit });
  if (flags.fresh) {
    line += ' --fresh';
  }
  return `${line}\n${cell.query}`;
}

/** The next free `df_<n>` among names already used. */
export function nextFrameName(used: Iterable<string>): string {
  const taken = new Set(used);
  for (let n = 1; ; n++) {
    if (!taken.has(`df_${n}`)) {
      return `df_${n}`;
    }
  }
}

/** wanted, or wanted_2, wanted_3… when another cell already writes a dataframe by that name. */
export function freeFrameName(wanted: string, used: Iterable<string>): string {
  const taken = new Set(used);
  if (!taken.has(wanted)) {
    return wanted;
  }
  for (let n = 2; ; n++) {
    if (!taken.has(`${wanted}_${n}`)) {
      return `${wanted}_${n}`;
    }
  }
}
