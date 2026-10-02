import { ChartAggregate, ChartKind, ColumnKind } from '@/api';
import type { IconName } from '@/ide/icons';

/** What a chart shows, with columns by position: a ChartQuery without the grid's filters. */
export interface ChartSpec {
  kind: ChartKind;
  x?: number;
  y: number[];
  color?: number;
  agg: ChartAggregate;
}

type Columns = { name: string; kind: ColumnKind }[];

export const CHART_KINDS: { kind: ChartKind; label: string; icon: IconName }[] = [
  { kind: 'histogram', label: 'Histogram', icon: 'chart-column' },
  { kind: 'bar', label: 'Bar', icon: 'chart-bar' },
  { kind: 'line', label: 'Line', icon: 'chart-line' },
  { kind: 'scatter', label: 'Scatter', icon: 'chart-scatter' },
  { kind: 'box', label: 'Box', icon: 'chart-candlestick' },
];

export const AGGREGATES: { agg: ChartAggregate; label: string }[] = [
  { agg: 'count', label: 'Count' },
  { agg: 'sum', label: 'Sum' },
  { agg: 'mean', label: 'Mean' },
  { agg: 'median', label: 'Median' },
  { agg: 'min', label: 'Min' },
  { agg: 'max', label: 'Max' },
];

const MEASURES: ColumnKind[] = ['number'];
const AXES: ColumnKind[] = ['number', 'datetime'];
const GROUPS: ColumnKind[] = ['text', 'bool'];

/** Which columns each field of each kind takes; the kernel refuses the rest. */
export const FIELD_KINDS = {
  histogram: { x: AXES },
  bar: { x: [...GROUPS, 'number', 'datetime'] as ColumnKind[], y: MEASURES, color: GROUPS },
  line: { x: AXES, y: MEASURES, color: GROUPS },
  scatter: { x: AXES, y: MEASURES, color: GROUPS },
  box: { x: GROUPS, y: MEASURES },
} satisfies Record<ChartKind, Partial<Record<'x' | 'y' | 'color', ColumnKind[]>>>;

export function columnsOf(columns: Columns, kinds: ColumnKind[], except: number[] = []): number[] {
  return columns
    .map((column, index) => ({ column, index }))
    .filter(({ column, index }) => kinds.includes(column.kind) && !except.includes(index))
    .map(({ index }) => index);
}

function fits(columns: Columns, index: number | undefined, kinds: ColumnKind[]): boolean {
  return index !== undefined && kinds.includes(columns[index]?.kind);
}

/**
 * The chart the toggle opens on: a category and a number is a bar of the sum, a date and a number a line,
 * two numbers a scatter, one number or date a histogram, and text alone a bar of counts. Null when no
 * column can be drawn.
 */
export function defaultChart(columns: Columns): ChartSpec | null {
  const numbers = columnsOf(columns, MEASURES);
  const dates = columnsOf(columns, ['datetime']);
  const groups = columnsOf(columns, GROUPS);
  if (groups.length > 0 && numbers.length > 0) {
    return { kind: 'bar', x: groups[0], y: [numbers[0]], agg: 'sum' };
  }
  if (dates.length > 0 && numbers.length > 0) {
    return { kind: 'line', x: dates[0], y: [numbers[0]], agg: 'sum' };
  }
  if (numbers.length > 1) {
    return { kind: 'scatter', x: numbers[0], y: [numbers[1]], agg: 'sum' };
  }
  if (numbers.length > 0 || dates.length > 0) {
    return { kind: 'histogram', x: numbers[0] ?? dates[0], y: [], agg: 'count' };
  }
  if (groups.length > 0) {
    return { kind: 'bar', x: groups[0], y: [], agg: 'count' };
  }
  return null;
}

/** One column on its own, from its menu: its distribution, or its commonest values counted. */
export function columnChart(columns: Columns, index: number): ChartSpec {
  return fits(columns, index, AXES)
    ? { kind: 'histogram', x: index, y: [], agg: 'count' }
    : { kind: 'bar', x: index, y: [], agg: 'count' };
}

/**
 * The same chart as another kind: every column the new kind can still use is kept, and the rest are
 * chosen as the toggle would choose them. Null when the frame has nothing the kind can draw.
 */
export function withKind(spec: ChartSpec, kind: ChartKind, columns: Columns): ChartSpec | null {
  const fields: Partial<Record<'x' | 'y' | 'color', ColumnKind[]>> = FIELD_KINDS[kind];
  const pick = (current: number | undefined, kinds: ColumnKind[], except: number[] = []) =>
    fits(columns, current, kinds) && !except.includes(current as number)
      ? current
      : columnsOf(columns, kinds, except)[0];

  // A box's category is optional, and a bar's measure is only there for an aggregate that needs one.
  const keptY = spec.y.filter((index) => fits(columns, index, MEASURES));
  const fromX = fits(columns, spec.x, MEASURES) ? [spec.x as number] : [];
  const measures = [...keptY, ...fromX.filter((index) => !keptY.includes(index))];

  switch (kind) {
    case 'histogram': {
      const x = pick(spec.x, AXES) ?? measures[0];
      return x === undefined ? null : { kind, x, y: [], agg: 'count' };
    }
    case 'bar': {
      // A bar a category, so a number is grouped by only when the frame has nothing else to group by.
      const x = fits(columns, spec.x, GROUPS)
        ? spec.x
        : (columnsOf(columns, GROUPS)[0] ?? pick(spec.x, fields.x ?? []));
      if (x === undefined) {
        return null;
      }
      const y = measures.filter((index) => index !== x).slice(0, 1);
      const agg = y.length === 0 ? 'count' : spec.agg === 'count' ? 'sum' : spec.agg;
      return { kind, x, y, agg, color: pickColor(spec.color, columns, [x]) };
    }
    case 'line': {
      // Along a date when there is one, and never along the measure the chart was already showing.
      const x = fits(columns, spec.x, ['datetime'])
        ? spec.x
        : (columnsOf(columns, ['datetime'])[0] ??
          (fits(columns, spec.x, AXES) && !keptY.includes(spec.x as number)
            ? spec.x
            : columnsOf(columns, AXES, measures)[0]));
      if (x === undefined) {
        return null;
      }
      const kept = measures.filter((index) => index !== x).slice(0, 3);
      const y = kept.length > 0 ? kept : columnsOf(columns, MEASURES, [x]).slice(0, 1);
      if (y.length === 0) {
        return null;
      }
      const agg = spec.agg === 'count' ? 'sum' : spec.agg;
      const color = y.length === 1 ? pickColor(spec.color, columns, [x]) : undefined;
      return { kind, x, y, agg, color };
    }
    case 'scatter': {
      const x = pick(spec.x, AXES);
      if (x === undefined) {
        return null;
      }
      const y = measures.find((index) => index !== x) ?? columnsOf(columns, MEASURES, [x])[0];
      return y === undefined
        ? null
        : { kind, x, y: [y], agg: spec.agg, color: pickColor(spec.color, columns, [x, y]) };
    }
    case 'box': {
      const y = measures[0] ?? columnsOf(columns, MEASURES)[0];
      if (y === undefined) {
        return null;
      }
      const x = fits(columns, spec.x, GROUPS) ? spec.x : columnsOf(columns, GROUPS)[0];
      return { kind, x, y: [y], agg: spec.agg };
    }
  }
}

function pickColor(current: number | undefined, columns: Columns, except: number[]) {
  return fits(columns, current, GROUPS) && !except.includes(current as number)
    ? current
    : undefined;
}

/** What the chart counted, in words: the foot's first half. */
export function describeChart(spec: ChartSpec, columns: Columns): string {
  const name = (index: number | undefined) => (index === undefined ? '' : columns[index]?.name);
  const measure = (index: number) =>
    spec.agg === 'count'
      ? 'Rows'
      : `${AGGREGATES.find((each) => each.agg === spec.agg)?.label} of ${name(index)}`;
  switch (spec.kind) {
    case 'histogram':
      return `Distribution of ${name(spec.x)}`;
    case 'bar':
      return `${spec.agg === 'count' ? 'Rows' : measure(spec.y[0])} by ${name(spec.x)}`;
    case 'line':
      return `${spec.y.map((index) => measure(index)).join(', ')} along ${name(spec.x)}`;
    case 'scatter':
      return `${name(spec.y[0])} against ${name(spec.x)}`;
    case 'box':
      return spec.x === undefined ? `${name(spec.y[0])}` : `${name(spec.y[0])} by ${name(spec.x)}`;
  }
}
