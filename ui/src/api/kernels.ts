import { Kernel, KernelspecsState } from '@/store/kernels';
import { requestBlob, requestEmpty, requestJson, requestText } from './client';

export async function listKernelspecs(): Promise<KernelspecsState> {
  const res = await requestJson<{ kernelspecs?: KernelspecsState }>('/api/kernelspecs');
  return res.kernelspecs || {};
}

/** A file from a kernelspec's `resources`, such as its logo, by the path listed there. */
export function getKernelspecResource(path: string): Promise<Blob> {
  return requestBlob(path);
}

/** The project's own .venv, under one name in every project: internal/kernelspec/interpreters.go. */
export const PROJECT_KERNEL_NAME = 'project-venv';

/** Setting up that .venv, as /api/environment/setup reports it. */
export interface EnvironmentSetup {
  state: 'idle' | 'running' | 'succeeded' | 'failed';
  log: string;
  error?: string;
  kernel?: string;
}

/** Starts the setup. A 409 is an ApiError: one is already running, and its state is in the body. */
export function startEnvironmentSetup(): Promise<EnvironmentSetup> {
  return requestJson<EnvironmentSetup>('/api/environment/setup', { method: 'POST' });
}

export function getEnvironmentSetup(): Promise<EnvironmentSetup> {
  return requestJson<EnvironmentSetup>('/api/environment/setup');
}

/**
 * A kernel as `/api/kernels` reports it, in the server's own snake case.
 *
 * `Kernel` is the pair every other endpoint sends — a name and an id — and these three are what the
 * server knows about a kernel that this window may have nothing to do with.
 */
export interface KernelModel extends Kernel {
  /** RFC 3339, UTC. When the kernel last published anything, or when it started if it never has. */
  last_activity: string;
  /**
   * `starting`, `busy` or `idle` — Jupyter's own names, and the last thing the kernel itself said rather
   * than a guess about what it is doing. `starting` only for the moment between a kernel being launched
   * and its first message; the server listens to every kernel it runs, so this is answered for a kernel
   * no window has ever opened.
   */
  execution_state: string;
  /** Clients this server is forwarding to, which is 0 for a kernel whose notebook has been closed. */
  connections: number;
}

/**
 * Every kernel this server is running, which is not the same as every kernel this browser tab started
 * one of. A reload loses the second list and not the first.
 */
export function listKernels(): Promise<KernelModel[]> {
  return requestJson<KernelModel[]>('/api/kernels');
}

/** A name in a Python kernel's namespace, described without its value. */
export interface KernelVariable {
  name: string;
  type: string;
  module: string;
  kind: 'dataframe' | 'series' | 'array' | 'other';
  shape: number[] | null;
  size: number | null;
  summary: string;
  /** Whether it can be opened as a table. */
  viewable: boolean;
}

export type ColumnKind = 'number' | 'datetime' | 'bool' | 'text' | 'other';

/** A missing value is `{ missing }`, with the text pandas prints for it: NaN, None, NaT or <NA>. */
export type CellValue = string | number | boolean | { missing: string };

export type FilterOp =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'ge'
  | 'lt'
  | 'le'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'missing'
  | 'present';

/** Columns are named by position, so a frame with duplicate or non-string names still works. */
export interface RowFilter {
  column: number;
  op: FilterOp;
  value: string;
}

export interface RowSort {
  column: number;
  descending: boolean;
}

export interface RowQuery {
  offset: number;
  limit: number;
  sort?: RowSort;
  filters?: RowFilter[];
}

export interface RowsPage {
  columns: { name: string; dtype: string; kind: ColumnKind }[];
  total_columns: number;
  index: string[];
  rows: CellValue[][];
  total_rows: number;
  /** Rows left after the filters. */
  matched_rows: number;
  offset: number;
  /** False for an array in a kernel without pandas: it pages, but cannot be sorted or filtered. */
  queryable: boolean;
}

export interface ColumnProfile {
  kind: ColumnKind;
  count: number;
  missing: number;
  distinct: number | null;
  min?: number | string | null;
  max?: number | string | null;
  mean?: number | null;
  std?: number | null;
  histogram?: { counts: number[]; edges: (number | null)[] };
  top?: { value: CellValue; count: number }[];
}

/** The kernel's variables. Waits behind a running cell, and answers 504 if that takes too long. */
export function listVariables(kernelId: string): Promise<KernelVariable[]> {
  return requestJson<KernelVariable[]>(`/api/kernels/${kernelId}/variables`);
}

/** A page of a table-like variable, filtered and sorted in the kernel. */
export function queryRows(kernelId: string, name: string, query: RowQuery): Promise<RowsPage> {
  return requestJson<RowsPage>(`/api/kernels/${kernelId}/variables/${name}/rows`, {
    method: 'POST',
    body: query,
  });
}

/** The rows a query leaves as CSV, the first 100,000 of them. */
export function exportRows(kernelId: string, name: string, query: RowQuery): Promise<string> {
  return requestText(`/api/kernels/${kernelId}/variables/${name}/csv`, {
    method: 'POST',
    body: query,
  });
}

/** What a cell's DataFrame output carries beside pandas' HTML, while the kernel holds the frame. */
export const TABLE_MIME = 'application/vnd.zasper.dataframe+json';

export interface OutputTable {
  id: string;
  kind: 'dataframe' | 'series';
  rows: number;
  columns: number;
}

/** What is in each column of a table-like variable. */
export function profileVariable(
  kernelId: string,
  name: string
): Promise<{ columns: ColumnProfile[] }> {
  return requestJson<{ columns: ColumnProfile[] }>(
    `/api/kernels/${kernelId}/variables/${name}/profile`
  );
}

/** One running kernel; a kernel that has stopped answers 404. */
export function getKernel(kernelId: string): Promise<KernelModel> {
  return requestJson<KernelModel>(`/api/kernels/${kernelId}`);
}

export function interruptKernel(kernelId: string): Promise<void> {
  return requestEmpty(`/api/kernels/${kernelId}/interrupt`, { method: 'POST' });
}

/** Kills a kernel, and with it any session bound to it. */
export function deleteKernel(kernelId: string): Promise<void> {
  return requestEmpty(`/api/kernels/${kernelId}`, { method: 'DELETE' });
}
