import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

import {
  ApiError,
  apiErrorMessage,
  ChartAggregate,
  ChartAnswer,
  chartVariable,
  ColumnKind,
  RowFilter,
} from '@/api';
import { loadPlotly, PlotlyModule } from '@/ide/editor/notebook/PlotlyOutput';
import { Icon } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { useTheme } from '@/themes/useTheme';
import { chartCode } from './chartCode';
import { chartFigure, readPalette } from './chartFigure';
import {
  AGGREGATES,
  CHART_KINDS,
  ChartSpec,
  columnsOf,
  describeChart,
  FIELD_KINDS,
  withKind,
} from './chartSpec';

type Columns = { name: string; kind: ColumnKind }[];

interface ChartViewProps {
  kernelId: string;
  name: string;
  mode: 'cell' | 'tab';
  columns: Columns;
  filters: RowFilter[];
  spec: ChartSpec;
  onSpecChange: (spec: ChartSpec) => void;
  reload: number;
  paused: boolean;
  onGone?: () => void;
  /** The variable the chart's code is written against; null for an expression's output, which has none. */
  variable: string | null;
  /** Puts the code in a cell below the output; without it, the code is copied. */
  insertCode?: (source: string) => void;
}

function rowsLabel(answer: ChartAnswer): string {
  return answer.matched_rows === answer.total_rows
    ? `all ${answer.total_rows.toLocaleString()} rows`
    : `${answer.matched_rows.toLocaleString()} of ${answer.total_rows.toLocaleString()} rows`;
}

/** What the chart left out, said under it: a sample, a thinned line, groups folded into Other. */
function caveat(answer: ChartAnswer): string {
  if (answer.kind === 'scatter' && answer.sampled) {
    return `${answer.sampled.shown.toLocaleString()} of ${answer.sampled.of.toLocaleString()} points, drawn at random.`;
  }
  if (answer.kind === 'line' && answer.series.some((line) => line.points > line.x.length)) {
    return 'Each line is thinned to 2,000 points, keeping the lowest and highest of each stretch.';
  }
  const folded = 'other_categories' in answer ? (answer.other_categories ?? 0) : 0;
  if (folded > 0) {
    return answer.kind === 'box'
      ? `The 20 commonest categories; ${folded.toLocaleString()} more are left out.`
      : `Other is the ${folded.toLocaleString()} smallest, together.`;
  }
  return '';
}

function ColumnSelect(props: {
  label: string;
  value: number | undefined;
  options: number[];
  columns: Columns;
  optional?: string;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="dataChart-field">
      <span>{props.label}</span>
      <span className="z-select">
        <select
          value={props.value ?? ''}
          onChange={(event) =>
            props.onChange(event.target.value === '' ? undefined : Number(event.target.value))
          }
        >
          {props.optional !== undefined && <option value="">{props.optional}</option>}
          {props.options.map((index) => (
            <option key={index} value={index}>
              {props.columns[index].name}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

/**
 * The grid's rows as a chart: the kernel counts, plotly draws. One series is the accent, as a column's
 * distribution is; a colour column's groups take --z-chart-n by their place in the whole frame.
 */
export default function ChartView(props: ChartViewProps) {
  const { kernelId, name, mode, columns, filters, spec, onSpecChange, reload, paused, onGone } =
    props;
  const [answer, setAnswer] = useState<ChartAnswer | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const generation = useRef(0);
  const gone = useRef(onGone);
  gone.current = onGone;

  useEffect(() => {
    if (paused) {
      return;
    }
    const mine = ++generation.current;
    setReading(true);
    chartVariable(kernelId, name, { ...spec, filters })
      .then((found) => {
        if (mine === generation.current) {
          setAnswer(found);
          setError('');
        }
      })
      .catch((failure: unknown) => {
        if (mine !== generation.current) {
          return;
        }
        if (failure instanceof ApiError && failure.status === 410) {
          gone.current?.();
          return;
        }
        setError(apiErrorMessage(failure));
      })
      .finally(() => mine === generation.current && setReading(false));
  }, [kernelId, name, spec, filters, reload, paused]);

  useEffect(() => {
    const element = host.current;
    if (answer === null || element === null) {
      return;
    }
    let cancelled = false;
    let plotly: PlotlyModule | undefined;
    const coloured = spec.color !== undefined || spec.y.length > 1;
    const nameOf = (index: number | undefined) =>
      index === undefined ? '' : (columns[index]?.name ?? '');
    // A bar's axes are its own categories and values, and a line of several columns has a legend.
    const labels = {
      x: spec.kind === 'bar' ? '' : nameOf(spec.x),
      y:
        spec.kind === 'histogram'
          ? 'Rows'
          : spec.kind === 'bar' || spec.y.length > 1
            ? ''
            : nameOf(spec.y[0]),
    };
    const figure = chartFigure(
      answer,
      readPalette(element),
      labels,
      coloured,
      element.clientHeight || 300
    );
    void loadPlotly()
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        plotly = loaded;
        return loaded.react(element, figure.data, figure.layout, {
          responsive: true,
          displaylogo: false,
          modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
        });
      })
      .catch((failure: unknown) => {
        console.error('Could not draw the chart:', failure);
        if (!cancelled) {
          setError('This chart could not be drawn; the browser console has the reason.');
        }
      });
    return () => {
      cancelled = true;
      plotly?.purge(element);
    };
    // The theme is read off the page by readPalette, so a change of theme has to draw again.
  }, [answer, spec, columns, theme]);

  const kinds = FIELD_KINDS[spec.kind] as Partial<Record<'x' | 'y' | 'color', ColumnKind[]>>;
  const change = (next: Partial<ChartSpec>) => onSpecChange({ ...spec, ...next });
  const choose = (kinds_: ColumnKind[] | undefined, except: number[] = []) =>
    columnsOf(columns, kinds_ ?? [], except);

  const code = () => chartCode(props.variable ?? '', spec, filters, columns);
  const insert = () => {
    if (props.insertCode) {
      props.insertCode(code());
      return;
    }
    navigator.clipboard
      .writeText(code())
      .then(() => toast.success('Copied the code that draws this chart.'))
      .catch(() => toast.error('The clipboard would not take the code.'));
  };

  const fields = (() => {
    switch (spec.kind) {
      case 'histogram':
        return (
          <ColumnSelect
            label="Column"
            value={spec.x}
            options={choose(kinds.x)}
            columns={columns}
            onChange={(x) => change({ x })}
          />
        );
      case 'bar':
        return (
          <>
            <ColumnSelect
              label="Group by"
              value={spec.x}
              options={choose(kinds.x)}
              columns={columns}
              onChange={(x) => change({ x })}
            />
            <Aggregate spec={spec} onChange={change} measures={choose(kinds.y)} />
            {spec.agg !== 'count' && (
              <ColumnSelect
                label="Of"
                value={spec.y[0]}
                options={choose(kinds.y)}
                columns={columns}
                onChange={(y) => y !== undefined && change({ y: [y] })}
              />
            )}
            <ColumnSelect
              label="Colour"
              value={spec.color}
              options={choose(kinds.color, spec.x === undefined ? [] : [spec.x])}
              columns={columns}
              optional="None"
              onChange={(color) => change({ color })}
            />
          </>
        );
      case 'line':
        return (
          <>
            <ColumnSelect
              label="Along"
              value={spec.x}
              options={choose(kinds.x)}
              columns={columns}
              onChange={(x) => change({ x })}
            />
            {[0, 1, 2]
              .filter((at) => at < spec.y.length + (spec.color === undefined ? 1 : 0))
              .map((at) => (
                <ColumnSelect
                  key={at}
                  label={at === 0 ? 'Value' : 'and'}
                  value={spec.y[at]}
                  options={choose(
                    kinds.y,
                    spec.y.filter((_, other) => other !== at)
                  )}
                  columns={columns}
                  optional={at === 0 ? undefined : 'None'}
                  onChange={(y) => {
                    const next = [...spec.y];
                    if (y === undefined) {
                      next.splice(at, 1);
                    } else {
                      next[at] = y;
                    }
                    change({ y: next, color: next.length > 1 ? undefined : spec.color });
                  }}
                />
              ))}
            <Aggregate spec={spec} onChange={change} measures={choose(kinds.y)} noCount />
            {spec.y.length === 1 && (
              <ColumnSelect
                label="Colour"
                value={spec.color}
                options={choose(kinds.color)}
                columns={columns}
                optional="None"
                onChange={(color) => change({ color })}
              />
            )}
          </>
        );
      case 'scatter':
        return (
          <>
            <ColumnSelect
              label="X"
              value={spec.x}
              options={choose(kinds.x)}
              columns={columns}
              onChange={(x) => change({ x })}
            />
            <ColumnSelect
              label="Y"
              value={spec.y[0]}
              options={choose(kinds.y)}
              columns={columns}
              onChange={(y) => y !== undefined && change({ y: [y] })}
            />
            <ColumnSelect
              label="Colour"
              value={spec.color}
              options={choose(kinds.color)}
              columns={columns}
              optional="None"
              onChange={(color) => change({ color })}
            />
          </>
        );
      case 'box':
        return (
          <>
            <ColumnSelect
              label="Value"
              value={spec.y[0]}
              options={choose(kinds.y)}
              columns={columns}
              onChange={(y) => y !== undefined && change({ y: [y] })}
            />
            <ColumnSelect
              label="By"
              value={spec.x}
              options={choose(kinds.x)}
              columns={columns}
              optional="None"
              onChange={(x) => change({ x })}
            />
          </>
        );
    }
  })();

  const note = answer === null ? '' : caveat(answer);
  const named = props.variable !== null;

  return (
    <div className={mode === 'tab' ? 'dataChart is-tab' : 'dataChart'}>
      <div className="dataChart-controls">
        <span className="dataChart-kinds" role="group" aria-label="Chart kind">
          {CHART_KINDS.map((each) => {
            const next = each.kind === spec.kind ? spec : withKind(spec, each.kind, columns);
            return (
              <IconButton
                key={each.kind}
                icon={each.icon}
                label={
                  next === null
                    ? `${each.label}: no column in this table can be drawn so`
                    : each.label
                }
                pressed={each.kind === spec.kind}
                disabled={next === null}
                onClick={() => next !== null && onSpecChange(next)}
              />
            );
          })}
        </span>
        {fields}
      </div>

      {error !== '' && (
        <div className="z-notice z-notice-error dataGrid-error" role="alert">
          <Icon name="circle-alert" size={14} />
          <p>{error}</p>
        </div>
      )}

      <div className={reading ? 'dataChart-plot is-reading' : 'dataChart-plot'}>
        {answer === null && error === '' && (
          <p className="z-note dataChart-empty">Counting in the kernel…</p>
        )}
        {/* plotly owns this element's contents, so nothing React renders may live inside it. */}
        <div ref={host} className="dataChart-graph" />
      </div>
      {note !== '' && <p className="dataChart-note">{note}</p>}

      <div className="dataGrid-foot">
        <span className="z-tabular">
          {describeChart(spec, columns)}
          {answer !== null && `, over ${rowsLabel(answer)}`}
        </span>
        <button
          type="button"
          className="z-button z-button-secondary dataChart-insert"
          disabled={!named}
          title={
            named
              ? undefined
              : 'This output is an expression, so there is no name to write the code against.'
          }
          onClick={insert}
        >
          <Icon name="code" size={12} />
          {props.insertCode ? 'Insert as code' : 'Copy as code'}
        </button>
      </div>
    </div>
  );
}

function Aggregate(props: {
  spec: ChartSpec;
  onChange: (next: Partial<ChartSpec>) => void;
  measures: number[];
  noCount?: boolean;
}) {
  const { spec, onChange, measures } = props;
  return (
    <label className="dataChart-field">
      <span>As</span>
      <span className="z-select">
        <select
          value={spec.agg}
          onChange={(event) => {
            const agg = event.target.value as ChartAggregate;
            // A bar of counts needs no measure, and any other aggregate needs one.
            const y = agg === 'count' || spec.y.length > 0 ? spec.y : measures.slice(0, 1);
            onChange({ agg, y: spec.kind === 'bar' && agg === 'count' ? [] : y });
          }}
        >
          {AGGREGATES.filter(
            (each) =>
              !(props.noCount && each.agg === 'count') &&
              (each.agg === 'count' || measures.length > 0)
          ).map((each) => (
            <option key={each.agg} value={each.agg}>
              {each.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
