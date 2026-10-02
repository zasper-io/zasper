import { CellValue, ColumnKind, FilterOp, RowFilter } from '@/api';

export const OP_LABELS: Record<FilterOp, string> = {
  eq: '=',
  ne: '≠',
  gt: '>',
  ge: '≥',
  lt: '<',
  le: '≤',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  missing: 'is missing',
  present: 'is not missing',
};

const ORDERED: FilterOp[] = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'missing', 'present'];

/** The comparisons that mean something for a column of this kind, the likeliest first. */
export function opsFor(kind: ColumnKind): FilterOp[] {
  switch (kind) {
    case 'number':
    case 'datetime':
      return ORDERED;
    case 'bool':
      return ['eq', 'ne', 'missing', 'present'];
    case 'text':
      return ['contains', 'not_contains', 'starts_with', 'eq', 'ne', 'missing', 'present'];
    default:
      return ['contains', 'not_contains', 'eq', 'ne', 'missing', 'present'];
  }
}

/** Whether a comparison needs something to compare with. */
export function takesValue(op: FilterOp): boolean {
  return op !== 'missing' && op !== 'present';
}

export function describeFilter(filter: RowFilter, columnName: string): string {
  const op = OP_LABELS[filter.op];
  return takesValue(filter.op) ? `${columnName} ${op} ${filter.value}` : `${columnName} ${op}`;
}

/** A number as a table shows it in a summary: six significant figures, grouped. */
export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'string') {
    return value;
  }
  return value.toLocaleString(undefined, { maximumSignificantDigits: 6 });
}

export function cellText(value: CellValue): string {
  return typeof value === 'object' ? value.missing : String(value);
}

/** A cell's text: a float to at most six decimal places, as pandas prints one, and anything else as it came. */
export function displayValue(value: string | number | boolean): string {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    return String(Number(value.toFixed(6)));
  }
  return String(value);
}
