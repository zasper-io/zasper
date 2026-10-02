import { describe, expect, it } from 'vitest';

import { ChartAnswer, ColumnKind } from '@/api';
import { chartCode } from './chartCode';
import { chartFigure, ChartPalette, withAlpha } from './chartFigure';
import { columnChart, defaultChart, withKind } from './chartSpec';

const column = (name: string, kind: ColumnKind) => ({ name, kind });
const sales = [
  column('region', 'text'),
  column('units', 'number'),
  column('price', 'number'),
  column('placed', 'datetime'),
];

const palette: ChartPalette = {
  accent: '#583bd8',
  series: ['#c1', '#c2', '#c3', '#c4', '#c5', '#c6', '#c7', '#c8'],
  other: '#999999',
  text: '#393939',
  muted: '#6d6d6d',
  grid: '#e0dceb',
  axis: '#969696',
  surface: '#eaf3fb',
  overlay: '#ffffff',
  font: 'Inter',
};

describe('the chart a frame opens on', () => {
  it('sums the first number by the first category', () => {
    expect(defaultChart(sales)).toEqual({ kind: 'bar', x: 0, y: [1], agg: 'sum' });
  });

  it('draws a number along a date when there is no category', () => {
    expect(defaultChart(sales.slice(1))).toMatchObject({ kind: 'line', x: 2, y: [0] });
  });

  it('puts two numbers against each other, and one in a histogram', () => {
    expect(defaultChart(sales.slice(1, 3))).toMatchObject({ kind: 'scatter', x: 0, y: [1] });
    expect(defaultChart([column('price', 'number')])).toMatchObject({ kind: 'histogram', x: 0 });
  });

  it('counts a text column alone, and has nothing to draw from objects', () => {
    expect(defaultChart([column('note', 'text')])).toEqual({
      kind: 'bar',
      x: 0,
      y: [],
      agg: 'count',
    });
    expect(defaultChart([column('blob', 'other')])).toBeNull();
  });

  it('opens a column from its menu as its distribution or its counts', () => {
    expect(columnChart(sales, 2)).toMatchObject({ kind: 'histogram', x: 2 });
    expect(columnChart(sales, 0)).toMatchObject({ kind: 'bar', x: 0, agg: 'count' });
  });
});

describe('changing kind', () => {
  const bar = { kind: 'bar' as const, x: 0, y: [1], agg: 'sum' as const, color: undefined };

  it('keeps the columns the new kind can still use', () => {
    expect(withKind(bar, 'box', sales)).toEqual({ kind: 'box', x: 0, y: [1], agg: 'sum' });
    expect(withKind(bar, 'line', sales)).toMatchObject({ kind: 'line', x: 3, y: [1], agg: 'sum' });
    expect(withKind(bar, 'scatter', sales)).toMatchObject({ kind: 'scatter', x: 1, y: [2] });
  });

  it('groups a bar by a category and runs a line along a date, whatever it came from', () => {
    const histogram = { kind: 'histogram' as const, x: 2, y: [], agg: 'count' as const };
    expect(withKind(histogram, 'bar', sales)).toMatchObject({
      kind: 'bar',
      x: 0,
      y: [2],
      agg: 'sum',
    });
    expect(withKind(histogram, 'line', sales)).toMatchObject({ kind: 'line', x: 3, y: [2] });
  });

  it('is refused for a frame with nothing that kind can draw', () => {
    const text = [column('region', 'text'), column('note', 'text')];
    expect(withKind({ ...bar, y: [], agg: 'count' }, 'histogram', text)).toBeNull();
    expect(withKind({ ...bar, y: [], agg: 'count' }, 'box', text)).toBeNull();
  });
});

describe('the code that draws a chart', () => {
  it('writes the filters as a mask and keeps the top twenty bars', () => {
    const code = chartCode(
      'sales',
      { kind: 'bar', x: 0, y: [1], agg: 'sum' },
      [{ column: 2, op: 'gt', value: '8' }],
      sales
    );
    expect(code).toBe(
      [
        'import plotly.express as px',
        '',
        'rows = sales[(sales["price"] > 8)]',
        'totals = rows.groupby("region", as_index=False)["units"].sum()',
        'px.bar(totals.nlargest(20, "units"), x="units", y="region", orientation="h")',
      ].join('\n')
    );
  });

  it('samples a scatter as the chart did, and imports pandas for a date filter', () => {
    const code = chartCode(
      'sales',
      { kind: 'scatter', x: 2, y: [1], agg: 'sum', color: 0 },
      [{ column: 3, op: 'ge', value: '2026-02-01' }],
      sales
    );
    expect(code).toContain('import pandas as pd');
    expect(code).toContain('rows = sales[(sales["placed"] >= pd.Timestamp("2026-02-01"))]');
    expect(code).toContain(
      'px.scatter(rows.sample(min(len(rows), 5000), random_state=0), x="price", y="units", color="region")'
    );
  });

  it('quotes a text filter as Python reads it', () => {
    const code = chartCode(
      'df',
      { kind: 'histogram', x: 1, y: [], agg: 'count' },
      [{ column: 0, op: 'contains', value: 'Nor"th' }],
      sales
    );
    expect(code).toContain(
      'df["region"].astype("string").str.lower().str.contains("nor\\"th", regex=False).fillna(False)'
    );
  });
});

describe('the figure', () => {
  const labels = { x: '', y: '' };

  it('draws one series in the accent, and Other in grey', () => {
    const answer: ChartAnswer = {
      kind: 'bar',
      categories: ['north', 'east'],
      other_categories: 3,
      series: [{ name: null, slot: null, other: false, values: [10, 8, 5] }],
      matched_rows: 30,
      total_rows: 30,
    };
    const { data } = chartFigure(answer, palette, labels, false);
    const bars = data[0] as { y: string[]; marker: { color: string[] } };
    expect(bars.y).toEqual(['north', 'east', 'Other (3)']);
    expect(bars.marker.color).toEqual(['#583bd8', '#583bd8', '#999999']);
  });

  it('colours a group by its slot in the whole frame, not by where it landed', () => {
    const answer: ChartAnswer = {
      kind: 'line',
      series: [
        { name: 'south', slot: 2, other: false, x: [1], y: [1], points: 1 },
        { name: null, slot: null, other: true, x: [1], y: [2], points: 1 },
      ],
      other_groups: 12,
      matched_rows: 2,
      total_rows: 9,
    };
    const { data, layout } = chartFigure(answer, palette, labels, true);
    const lines = data as { name: string; line: { color: string } }[];
    expect(lines.map((line) => line.line.color)).toEqual(['#c3', '#999999']);
    expect(lines[1].name).toBe('Other (12)');
    const missing = chartFigure({ ...answer, other_groups: 0 }, palette, labels, true);
    expect((missing.data[1] as { name: string }).name).toBe('Missing');
    expect(layout.showlegend).toBe(true);
  });

  it('makes a date histogram bin as wide as its edges are apart', () => {
    const answer: ChartAnswer = {
      kind: 'histogram',
      counts: [4],
      edges: ['2026-01-01 00:00:00', '2026-01-02 00:00:00'],
      matched_rows: 4,
      total_rows: 4,
    };
    const bars = chartFigure(answer, palette, labels, false).data[0] as { width: number[] };
    expect(bars.width).toEqual([24 * 60 * 60 * 1000]);
  });

  it('turns a token into a colour plotly can parse', () => {
    expect(withAlpha('#583bd8', 0.18)).toBe('rgba(88, 59, 216, 0.18)');
  });
});
