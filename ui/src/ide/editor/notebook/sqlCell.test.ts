import { describe, expect, it } from 'vitest';

import {
  fromSqlSource,
  freeFrameName,
  nextFrameName,
  parseSqlCell,
  toSqlSource,
  withRunFlags,
  withSqlOptions,
} from './sqlCell';

const cell = '%%zasper_sql analytics --out df_orders --limit 1000\nSELECT *\nFROM orders';

describe('a SQL cell', () => {
  it('is read from its magic line', () => {
    expect(parseSqlCell(cell)).toEqual({
      connection: 'analytics',
      out: 'df_orders',
      limit: 1000,
      query: 'SELECT *\nFROM orders',
      headerLength: cell.indexOf('\n') + 1,
    });
    expect(parseSqlCell('%%zasper_sql local --limit none\nSELECT 1')?.limit).toBeNull();
    expect(parseSqlCell('%%zasper_sql local')?.query).toBe('');
    expect(parseSqlCell('print(1)')).toBeNull();
    expect(parseSqlCell('%%sql local\nSELECT 1')).toBeNull();
  });

  it('changes its magic line and leaves the query exactly as written', () => {
    expect(withSqlOptions(cell, { connection: 'local', out: 'df_1' })).toBe(
      '%%zasper_sql local --out df_1 --limit 1000\nSELECT *\nFROM orders'
    );
    expect(withSqlOptions('print(1)', { out: 'x' })).toBe('print(1)');
  });

  it('is made from a code cell, and turned back into one', () => {
    const made = toSqlSource('SELECT 1', 'dataframes', 'df_1');
    expect(made).toBe('%%zasper_sql dataframes --out df_1\nSELECT 1');
    expect(fromSqlSource(made)).toBe('SELECT 1');
  });

  it('adds Load all and Run fresh for one run', () => {
    expect(withRunFlags(cell, { all: true, fresh: true })).toBe(
      '%%zasper_sql analytics --out df_orders --limit none --fresh\nSELECT *\nFROM orders'
    );
  });

  it('names a new dataframe after the ones already taken', () => {
    expect(nextFrameName(['df_1', 'df_3', 'x'])).toBe('df_2');
  });

  it('keeps a wanted name unless another cell writes it', () => {
    expect(freeFrameName('df_orders', ['df_1'])).toBe('df_orders');
    expect(freeFrameName('df_orders', ['df_orders', 'df_orders_2'])).toBe('df_orders_3');
  });
});
