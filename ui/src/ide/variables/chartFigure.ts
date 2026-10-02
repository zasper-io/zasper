import type * as Plotly from 'plotly.js-dist-min';

import { ChartAnswer, CellValue } from '@/api';
import { cellText } from './filters';

/** The theme's colours for a chart, read off the page: plotly draws to SVG and wants strings. */
export interface ChartPalette {
  accent: string;
  series: string[];
  other: string;
  text: string;
  muted: string;
  grid: string;
  axis: string;
  surface: string;
  overlay: string;
  font: string;
}

const SERIES_TOKENS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `--z-chart-${n}`);

export function readPalette(element: Element): ChartPalette {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    accent: token('--z-fg-accent'),
    series: SERIES_TOKENS.map(token),
    other: token('--z-chart-other'),
    text: token('--z-fg-default'),
    muted: token('--z-fg-muted'),
    grid: token('--z-border'),
    axis: token('--z-border-strong'),
    surface: token('--z-bg-cell-output'),
    overlay: token('--z-bg-overlay'),
    font: token('--z-ui-font-family'),
  };
}

export interface Figure {
  data: Plotly.Data[];
  layout: Partial<Plotly.Layout>;
}

interface Group {
  name: CellValue | null;
  slot?: number | null;
  other?: boolean;
}

/** A group's colour: its slot in the whole column, so a filter never repaints the groups it leaves. */
function colourOf(group: Group, palette: ChartPalette, coloured: boolean): string {
  if (group.other) {
    return palette.other;
  }
  if (!coloured || group.slot === null || group.slot === undefined) {
    return palette.accent;
  }
  return palette.series[group.slot % palette.series.length];
}

function groupName(group: Group, others: number | undefined): string {
  // The rest is the groups past the commonest and the rows with no value; with none folded, only the latter.
  if (group.other) {
    return others ? `Other (${others.toLocaleString()})` : 'Missing';
  }
  return group.name === null ? '' : cellText(group.name);
}

/** The width of a bin from its edges, in the axis's own units: milliseconds for a date. */
function binWidth(from: number | string | null, to: number | string | null): number {
  if (typeof from === 'number' && typeof to === 'number') {
    return to - from;
  }
  const at = (edge: number | string | null) => Date.parse(`${String(edge).replace(' ', 'T')}Z`);
  return at(to) - at(from);
}

/** A `#rrggbb` token at an opacity, which plotly can parse where it cannot parse color-mix(). */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) {
    return hex;
  }
  const [r, g, b] = match.slice(1).map((pair) => parseInt(pair, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * plotly's arguments for a chart the kernel counted. `coloured` is whether the series are groups of a
 * colour column or several measures, rather than the one series a chart has by default.
 */
export function chartFigure(
  answer: ChartAnswer,
  palette: ChartPalette,
  labels: { x: string; y: string },
  coloured: boolean,
  height = 300
): Figure {
  const axis = {
    gridcolor: palette.grid,
    linecolor: palette.axis,
    zeroline: false,
    automargin: true,
    tickfont: { color: palette.muted },
    title: { font: { color: palette.muted } },
  };
  const layout: Partial<Plotly.Layout> = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: palette.font, size: 11, color: palette.text },
    margin: { l: 8, r: 8, t: 8, b: 8 },
    xaxis: { ...axis, title: { text: labels.x, font: { color: palette.muted } } },
    yaxis: { ...axis, title: { text: labels.y, font: { color: palette.muted } } },
    hoverlabel: {
      bgcolor: palette.overlay,
      bordercolor: palette.grid,
      font: { color: palette.text, family: palette.font, size: 11 },
    },
    showlegend: coloured,
    legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { color: palette.text } },
    bargap: 0.3,
    barcornerradius: 4,
    modebar: { bgcolor: 'rgba(0,0,0,0)', color: palette.muted, activecolor: palette.accent },
  } as Partial<Plotly.Layout>;

  switch (answer.kind) {
    case 'histogram': {
      const edges = answer.edges;
      return {
        layout: {
          ...layout,
          bargap: 0.04,
          barcornerradius: 2,
          yaxis: { ...layout.yaxis, tickformat: ',' },
        } as Partial<Plotly.Layout>,
        data: [
          {
            type: 'bar',
            x: edges.slice(0, -1),
            y: answer.counts,
            width: answer.counts.map((_, at) => binWidth(edges[at], edges[at + 1])),
            offset: 0,
            marker: { color: palette.accent },
            customdata: answer.counts.map((_, at) => [edges[at], edges[at + 1]]),
            hovertemplate: '%{customdata[0]} to %{customdata[1]}<br>%{y:,} rows<extra></extra>',
          } as Plotly.Data,
        ],
      };
    }
    case 'bar': {
      const categories = answer.categories.map(cellText);
      if (answer.other_categories > 0) {
        categories.push(`Other (${answer.other_categories.toLocaleString()})`);
      }
      // Bars no thicker than 24px, whatever the height: the rest of each band is air.
      const band = (height * 0.8) / Math.max(categories.length, 1);
      const thickness = Math.min(24 * answer.series.length, band * 0.7);
      return {
        layout: {
          ...layout,
          barmode: 'group',
          bargap: Math.max(0.3, 1 - thickness / band),
          xaxis: { ...layout.xaxis, tickformat: ',' },
          yaxis: { ...layout.yaxis, autorange: 'reversed', type: 'category' },
        },
        data: answer.series.map((group) => ({
          type: 'bar',
          orientation: 'h',
          name: groupName(group, answer.other_groups),
          y: categories,
          x: group.values,
          marker: {
            color: group.values.map((_, at) =>
              !coloured && at === answer.categories.length
                ? palette.other
                : colourOf(group, palette, coloured)
            ),
          },
          hovertemplate: `%{y}<br>%{x:,}<extra>${coloured ? '%{fullData.name}' : ''}</extra>`,
          // A value at each bar's tip when there is one series; with groups the legend and tooltip say it.
          ...(coloured
            ? {}
            : {
                texttemplate: '%{x:,}',
                textposition: 'outside',
                textfont: { color: palette.text, size: 11 },
                cliponaxis: false,
              }),
        })),
      };
    }
    case 'line':
      return {
        layout: { ...layout, yaxis: { ...layout.yaxis, tickformat: ',' } },
        data: answer.series.map((group) => ({
          type: 'scatter',
          mode: 'lines',
          name: groupName(group, answer.other_groups),
          x: group.x,
          y: group.y,
          line: { color: colourOf(group, palette, coloured), width: 2, shape: 'linear' },
          hovertemplate: `%{x}<br>%{y:,}<extra>${coloured ? '%{fullData.name}' : ''}</extra>`,
        })),
      };
    case 'scatter':
      return {
        layout: { ...layout, yaxis: { ...layout.yaxis, tickformat: ',' } },
        data: answer.series.map((group) => ({
          type: 'scatter',
          mode: 'markers',
          name: groupName(group, answer.other_groups),
          x: group.x,
          y: group.y,
          marker: {
            color: colourOf(group, palette, coloured),
            size: 6,
            opacity: 0.7,
            line: { color: palette.surface, width: 1 },
          },
          hovertemplate: `%{x}, %{y}<extra>${coloured ? '%{fullData.name}' : ''}</extra>`,
        })),
      };
    case 'box': {
      const names = answer.series.map((box) => (box.name === null ? labels.y : cellText(box.name)));
      return {
        layout: {
          ...layout,
          xaxis: { ...layout.xaxis, type: 'category' },
          yaxis: { ...layout.yaxis, tickformat: ',' },
        },
        data: [
          {
            type: 'box',
            x: names,
            q1: answer.series.map((box) => box.q1),
            median: answer.series.map((box) => box.median),
            q3: answer.series.map((box) => box.q3),
            lowerfence: answer.series.map((box) => box.lower),
            upperfence: answer.series.map((box) => box.upper),
            mean: answer.series.map((box) => box.mean),
            boxpoints: false,
            marker: { color: palette.accent },
            line: { color: palette.accent, width: 1.5 },
            fillcolor: withAlpha(palette.accent, 0.18),
            name: labels.y,
          } as Plotly.Data,
          {
            type: 'scatter',
            mode: 'markers',
            x: answer.series.flatMap((box, at) => box.outliers.map(() => names[at])),
            y: answer.series.flatMap((box) => box.outliers),
            marker: { color: palette.muted, size: 5 },
            hovertemplate: '%{x}<br>%{y:,}<extra>outlier</extra>',
            showlegend: false,
          },
        ],
      };
    }
  }
}
