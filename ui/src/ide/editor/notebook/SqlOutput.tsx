import { useState } from 'react';
import { toast } from 'react-toastify';

import { apiErrorMessage, installIntoKernel, SqlCount } from '@/api';
import { Icon } from '@/ide/icons';
import { formatMemory } from '@/ide/resources/memory';

export const SQL_MIME = 'application/vnd.zasper.sql+json';

/** What a SQL cell's run says about itself, as the kernel's helper publishes it. */
export interface SqlRunInfo {
  connection: string;
  out: string;
  rows: number;
  /** More rows were left than the limit took. */
  more: boolean;
  limit: number | null;
  seconds: number;
  cached: boolean;
  /** Seconds since the epoch. */
  ran_at: number;
  /** Memory per row of the rows fetched, when more were left: what Load all would cost. */
  row_bytes?: number | null;
}

/** What a SQL cell's output can do: run the cell again for Load all or Run fresh, and install a driver. */
export interface SqlActions {
  run: (flags: { all?: boolean; fresh?: boolean }) => void;
  /** Counts the rows the cell's query answers, so Load all can say what it would read. */
  count?: () => Promise<SqlCount>;
  kernelId?: string;
}

function ago(ranAt: number): string {
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - ranAt) / 60));
  return minutes === 0 ? 'just now' : `${minutes} min ago`;
}

/** What Load all knows before it reads everything: nothing yet, the count under way, or its answer. */
type LoadAll = { state: 'unasked' } | { state: 'counting' } | { state: 'counted'; count: SqlCount };

/**
 * The line above a SQL cell's result: where the rows came from, how long they took, and the two answers
 * to a result that is not all there is — Load all, past the limit, and Run fresh, past the cache.
 *
 * Load all asks twice. The first press counts the rows and says what reading them would take in memory;
 * the second reads them. Counting runs the query again, so it waits for the press rather than following
 * every run, and the kernel gives it ten seconds.
 */
export function SqlProvenance({ info, actions }: { info: SqlRunInfo; actions?: SqlActions }) {
  const [loadAll, setLoadAll] = useState<LoadAll>({ state: 'unasked' });
  const rows = info.rows.toLocaleString();
  const total = loadAll.state === 'counted' ? loadAll.count.rows : null;

  const pressLoadAll = () => {
    if (!actions) {
      return;
    }
    if (loadAll.state === 'counted' || !actions.count) {
      actions.run({ all: true });
      return;
    }
    setLoadAll({ state: 'counting' });
    actions
      .count()
      .then((count) => setLoadAll({ state: 'counted', count }))
      .catch((error) =>
        setLoadAll({ state: 'counted', count: { rows: null, error: apiErrorMessage(error) } })
      );
  };

  let loadLabel = 'Load all';
  if (loadAll.state === 'counting') {
    loadLabel = 'Counting…';
  } else if (total !== null && info.row_bytes) {
    loadLabel = `Load all · about ${formatMemory(total * info.row_bytes)}`;
  } else if (loadAll.state === 'counted' && total === null) {
    loadLabel = 'Load all anyway';
  }

  return (
    <div className="sqlOutput">
      <Icon name={total !== null ? 'triangle-alert' : 'timer'} size={12} />
      <span className="z-tabular">
        {info.out} · {info.connection} ·{' '}
        {info.more
          ? total !== null
            ? `first ${rows} of ${total.toLocaleString()} rows`
            : `first ${rows} rows, more available`
          : `${rows} ${info.rows === 1 ? 'row' : 'rows'}`}
        {info.cached
          ? ` · from the cache, ran ${ago(info.ran_at)}`
          : ` · ${info.seconds.toFixed(1)} s`}
      </span>
      {loadAll.state === 'counted' && loadAll.count.error && (
        <span className="sqlOutput-note">Not counted: {loadAll.count.error}</span>
      )}
      {actions && info.more && (
        <button
          type="button"
          className="sqlOutput-action"
          disabled={loadAll.state === 'counting'}
          onClick={pressLoadAll}
        >
          {loadLabel}
        </button>
      )}
      {actions && info.cached && (
        <button
          type="button"
          className="sqlOutput-action"
          onClick={() => actions.run({ fresh: true })}
        >
          Run fresh
        </button>
      )}
    </div>
  );
}

const MISSING = /^(\S+) is not installed in (.+)$/;

/**
 * A query the database refused, in its own words: the helper raises it without a Python traceback. A
 * driver that is missing offers to install itself into the kernel's own environment.
 */
export function SqlError({ message, actions }: { message: string; actions?: SqlActions }) {
  const missing = MISSING.exec(message);
  const [installing, setInstalling] = useState(false);

  const install = async (name: string) => {
    if (!actions?.kernelId) {
      return;
    }
    setInstalling(true);
    try {
      const answer = await installIntoKernel(actions.kernelId, name);
      if (answer.ok) {
        toast.success(`Installed ${name}. Run the cell again.`);
      } else {
        toast.error(`Could not install ${name}: ${answer.log.trim().split('\n').pop()}`);
      }
    } catch (error) {
      toast.error(`Could not install ${name}: ${apiErrorMessage(error)}`);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="output-error sqlError">
      <Icon name="circle-alert" size={12} />
      <span>{message}</span>
      {missing && actions?.kernelId && (
        <button
          type="button"
          className="z-button z-button-secondary sqlOutput-install"
          disabled={installing}
          onClick={() => void install(missing[1])}
        >
          {installing ? `Installing ${missing[1]}…` : `Install ${missing[1]}`}
        </button>
      )}
    </div>
  );
}
