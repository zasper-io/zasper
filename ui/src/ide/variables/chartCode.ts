import { ColumnKind, RowFilter } from '@/api';
import { ChartSpec } from './chartSpec';

type Columns = { name: string; kind: ColumnKind }[];

const SCATTER_POINTS = 5000;
const MAX_BARS = 20;

/** A Python string literal: JSON's escapes are all Python's too. */
const py = (text: string) => JSON.stringify(text);

const COMPARE: Record<string, string> = {
  eq: '==',
  ne: '!=',
  gt: '>',
  ge: '>=',
  lt: '<',
  le: '<=',
};

function literal(kind: ColumnKind, value: string): string {
  if (kind === 'number' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return value.trim();
  }
  if (kind === 'bool') {
    return ['true', '1', 'yes'].includes(value.trim().toLowerCase()) ? 'True' : 'False';
  }
  if (kind === 'datetime') {
    return `pd.Timestamp(${py(value)})`;
  }
  return py(value);
}

/** A filter as the boolean mask pandas reads, as the kernel applies it. */
function mask(frame: string, filter: RowFilter, columns: Columns): string {
  const { name, kind } = columns[filter.column];
  const column = `${frame}[${py(name)}]`;
  const text = `${column}.astype("string").str.lower()`;
  const needle = py(filter.value.toLowerCase());
  switch (filter.op) {
    case 'missing':
      return `${column}.isna()`;
    case 'present':
      return `${column}.notna()`;
    case 'contains':
      return `${text}.str.contains(${needle}, regex=False).fillna(False)`;
    case 'not_contains':
      return `~${text}.str.contains(${needle}, regex=False).fillna(False)`;
    case 'starts_with':
      return `${text}.str.startswith(${needle}).fillna(False)`;
    default: {
      const left = kind === 'text' ? `${column}.astype("string")` : column;
      return `(${left} ${COMPARE[filter.op]} ${literal(kind, filter.value)})`;
    }
  }
}

/**
 * The plotly.express code that draws the chart on screen from the variable called `variable`: the same
 * filters, aggregate and caps, so the cell reproduces what was seen rather than something better.
 */
export function chartCode(
  variable: string,
  spec: ChartSpec,
  filters: RowFilter[],
  columns: Columns
): string {
  const name = (index: number | undefined) => py(index === undefined ? '' : columns[index].name);
  const lines = ['import plotly.express as px'];
  if (filters.some((filter) => columns[filter.column]?.kind === 'datetime')) {
    lines.push('import pandas as pd');
  }
  lines.push('');

  let frame = variable;
  if (filters.length > 0) {
    const conditions = filters.map((filter) => mask(variable, filter, columns));
    lines.push(`rows = ${variable}[${conditions.join(' & ')}]`);
    frame = 'rows';
  }

  const x = name(spec.x);
  const color = spec.color === undefined ? '' : `, color=${name(spec.color)}`;
  const by = spec.color === undefined ? x : `[${x}, ${name(spec.color)}]`;
  const total = (measure: string) =>
    spec.agg === 'count'
      ? `${frame}.groupby(${by}, as_index=False).size()`
      : `${frame}.groupby(${by}, as_index=False)[${measure}].${spec.agg}()`;

  switch (spec.kind) {
    case 'histogram':
      lines.push(`px.histogram(${frame}, x=${x}, nbins=50)`);
      break;
    case 'bar': {
      const value = spec.agg === 'count' ? '"size"' : name(spec.y[0]);
      lines.push(`totals = ${total(name(spec.y[0]))}`);
      const shown = spec.color === undefined ? `totals.nlargest(${MAX_BARS}, ${value})` : 'totals';
      lines.push(
        `px.bar(${shown}, x=${value}, y=${x}${color}, orientation="h"${spec.color === undefined ? '' : ', barmode="group"'})`
      );
      break;
    }
    case 'line': {
      const measures =
        spec.y.length === 1
          ? name(spec.y[0])
          : `[${spec.y.map((index) => name(index)).join(', ')}]`;
      const value = spec.agg === 'count' ? '"size"' : measures;
      lines.push(`totals = ${total(measures)}.sort_values(${x})`);
      lines.push(`px.line(totals, x=${x}, y=${value}${color})`);
      break;
    }
    case 'scatter':
      lines.push(
        `px.scatter(${frame}.sample(min(len(${frame}), ${SCATTER_POINTS}), random_state=0), x=${x}, y=${name(spec.y[0])}${color})`
      );
      break;
    case 'box':
      lines.push(
        spec.x === undefined
          ? `px.box(${frame}, y=${name(spec.y[0])})`
          : `px.box(${frame}, x=${x}, y=${name(spec.y[0])})`
      );
      break;
  }
  return lines.join('\n');
}
