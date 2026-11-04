import { describe, expect, it } from 'vitest';

import { parseConnectionString, suggestName } from './connectionString';

describe('parseConnectionString', () => {
  it('fills the PostgreSQL form, taking the password out', () => {
    expect(parseConnectionString('postgresql://me:p%40ss@db.internal:5433/analytics')).toEqual({
      fields: {
        type: 'postgresql',
        host: 'db.internal',
        port: '5433',
        database: 'analytics',
        user: 'me',
      },
      password: 'p@ss',
      engine: 'postgresql',
    });
  });

  it('reads postgres:// and the default driver as PostgreSQL, with its default port', () => {
    expect(parseConnectionString('postgres://me@db/x')?.fields).toMatchObject({
      type: 'postgresql',
      port: '5432',
    });
    expect(parseConnectionString('postgresql+psycopg://db/x')?.fields.type).toBe('postgresql');
    expect(parseConnectionString('mysql+pymysql://root@localhost/shop')?.fields).toMatchObject({
      type: 'mysql',
      port: '3306',
      database: 'shop',
    });
  });

  it('keeps a URL with options the form has no field for, less its password', () => {
    expect(parseConnectionString('postgresql://me:secret@db/analytics?sslmode=require')).toEqual({
      fields: { type: 'url', url: 'postgresql://me@db/analytics?sslmode=require' },
      password: 'secret',
      engine: 'url',
    });
  });

  it('keeps a driver of its own as a URL, and renames postgres:// for SQLAlchemy', () => {
    expect(parseConnectionString('postgres+psycopg2://me@db/x')?.fields).toEqual({
      type: 'url',
      url: 'postgresql+psycopg2://me@db/x',
    });
  });

  it('names a warehouse by its engine, as a URL', () => {
    const parsed = parseConnectionString('snowflake://me:pw@acme/db/public?warehouse=wh');
    expect(parsed).toEqual({
      fields: { type: 'url', url: 'snowflake://me@acme/db/public?warehouse=wh' },
      password: 'pw',
      engine: 'snowflake',
    });
  });

  it('drops a password that has no user before it', () => {
    expect(parseConnectionString('trino://:token@host/catalog')?.fields.url).toBe(
      'trino://host/catalog'
    );
  });

  it('reads SQLite and DuckDB files, and DuckDB in memory', () => {
    expect(parseConnectionString('sqlite:///data/local.db')?.fields).toEqual({
      type: 'sqlite',
      path: 'data/local.db',
    });
    expect(parseConnectionString('sqlite:////abs/x.db')?.fields.path).toBe('/abs/x.db');
    expect(parseConnectionString('duckdb:///:memory:')?.fields).toEqual({
      type: 'duckdb',
      path: '',
    });
  });

  it('is null for what is not a URL', () => {
    expect(parseConnectionString('hello')).toBeNull();
    expect(parseConnectionString('')).toBeNull();
  });
});

describe('suggestName', () => {
  it('takes the database, the file, or the host', () => {
    expect(
      suggestName({ type: 'postgresql', host: 'db.internal', database: 'analytics' }, [])
    ).toBe('analytics');
    expect(suggestName({ type: 'sqlite', path: 'data/local.db' }, [])).toBe('local.db');
    expect(suggestName({ type: 'mysql', host: 'shop.example.com' }, [])).toBe('shop');
    expect(suggestName({ type: 'url', url: 'snowflake://me@acme/sales/public' }, [])).toBe(
      'public'
    );
  });

  it('makes a name the server accepts, and one not taken', () => {
    expect(suggestName({ type: 'postgresql', host: 'h', database: '2024 sales' }, [])).toBe(
      'db_2024_sales'
    );
    expect(suggestName({ type: 'postgresql', host: 'h', database: 'x' }, ['x', 'x-2'])).toBe('x-3');
    expect(suggestName({ type: 'duckdb', path: '' }, [])).toBe('duckdb');
    expect(suggestName({ type: 'duckdb', path: 'dataframes' }, [])).toBe('duckdb');
  });
});
