# Charts from a DataFrame

The grid a DataFrame becomes in a cell, or in a tab, can be shown as a chart instead: the same frame and
the same filters, counted in the kernel and drawn with plotly. A million-row frame is a few hundred
numbers by the time it reaches the browser, as it is for the grid's pages.

This page is how that works, for anyone changing the kernel helper, the API or the chart view. The grid
itself is in [DATAFRAMES.md](DATAFRAMES.md).

## What there is

- **The toggle.** A chart button in the grid's bar turns the rows into a chart and back. The chart opens
  on a kind chosen from the columns: a category and a number is a bar of the sum, a date and a number a
  line, two numbers a scatter, one number or date a histogram, and text alone a bar of counts.
- **A column's menu**, which has *Chart this column*: a histogram for a number or date, a bar of counts
  for anything else.
- **Five kinds**, and the columns each takes:

  | Kind | Columns | The kernel sends | At most |
  | --- | --- | --- | --- |
  | Histogram | a number or date | counts and bin edges | 50 bins; a whole-number column a bin each |
  | Bar | a category, and a number summed, averaged, … or counted | a value per category | 20 bars, the rest as Other |
  | Line | a number or date along the bottom, one to three numbers | a point per x, aggregated | 2,000 points a line |
  | Scatter | two numbers | the points | 5,000, drawn at random and the same each time |
  | Box | a number, and a category | quartiles, whiskers at 1.5 IQR, mean | 20 boxes, 50 outliers each |

  A bar, a line of one number, and a scatter can be coloured by a category column.
- **Insert as code.** Writes the `plotly.express` call that draws the chart, with its filters, into a
  new cell below the output, without running it. A tab has no cell beside it, so there it copies the code.
  It needs a name to write against: an output whose cell ends in a bare name (`sales`) has one, a
  variable opened from the Variables panel has one, and an expression's output does not, so there the
  button says why it is disabled.
- **Open in a tab** carries the chart with the filters, and the tab draws it the tab's full height.

The chart is never saved in the notebook. What is kept is the code, which reads the same anywhere.

## How it works

| Piece | Where |
| --- | --- |
| The counting | `chart()` in `internal/kernel/inspect.py` |
| The API | `POST /api/kernels/{kernelId}/variables/{name}/chart`, in [API.md](API.md) |
| The view | `ui/src/ide/variables/ChartView.tsx`, inside `DataGrid` |
| Which kind, and which columns | `ui/src/ide/variables/chartSpec.ts` |
| plotly's arguments | `ui/src/ide/variables/chartFigure.ts` |
| The code a chart inserts | `ui/src/ide/variables/chartCode.ts` |

**Filters are the grid's.** A chart request carries the grid's filters and goes through the same
`_positions` as a page of rows, so the chart is of exactly the rows the grid shows. Sort does not apply.

**Go does not restate the answer.** The handler checks the request — the kind, the aggregate, the
columns, the filters — and passes the kernel's JSON on as it came, since each kind answers a different
shape. The TypeScript type `ChartAnswer` is where the shapes are written down.

**A group keeps its colour.** When a chart is coloured by a column, the groups are that column's
commonest values in the *whole* frame, not in the filtered rows, and each series carries its `slot` in
that order. The slot picks the colour, so a filter that empties one group does not repaint the rest.
Past eight groups (three for a scatter) the rest are one grey series, Other; with nothing past them, that
series is the rows with no value, and is called Missing.

**A line keeps its peaks.** A line longer than 2,000 points is thinned to the lowest and highest point
of each stretch, rather than averaged, so a spike survives.

## Colour

One series is `--z-fg-accent`, the colour of a column's distribution in its header. Groups take
`--z-chart-1` to `--z-chart-8`, then `--z-chart-other`, defined for light and dark in
`ui/src/styles/_tokens.scss`. The eight were checked as a set for colour-blind readers on every light
output tint, on white and on the dark output box: neighbouring groups stay apart (CVD ΔE 9.1 light, 8.4
dark). Some light hues are under 3:1 against the tint, which the legend, the tooltip and the table one
press away answer. A scatter stops at three groups, the most that stay apart for every pair.

The plot is drawn on the output's own surface, not on the white plate a kernel's figure gets, because
these pixels are the app's and take the theme. It is drawn again when the theme changes.

## Limits

- **A chart needs the kernel that holds the frame**, as the grid does. After a restart the output is
  pandas' HTML again, and there is no chart.
- **Insert as code writes pandas.** For a polars frame, add `.to_pandas()` to the inserted code. A
  coloured bar's code draws every category rather than the top 20.
- **Columns are named in the code by their printed names**, so a frame with duplicate or non-string
  column names inserts code that needs editing.
- **Times are wall times.** A date column with a time zone is drawn in that zone, without the offset.
- **A line aggregates by exact x.** Hourly rows along a date column are a point an hour; there is no
  bucketing by day.

Timed on 3 October 2026 against pandas 3.0 with two million rows: a histogram 40–80ms, a line 30ms
(300ms coloured by a column), a bar 220ms (470ms coloured), a scatter 170ms, a box by category 300ms.
