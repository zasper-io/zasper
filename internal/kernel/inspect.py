# Run inside a Python kernel as the module `_zasper_inspect`, never in the user's namespace. Every
# answer is base64 JSON, so it survives being returned as the repr of a str.
import base64
import json
import math
import operator
import reprlib
import types
import uuid
from collections import OrderedDict

from IPython import get_ipython

_summary = reprlib.Repr()
_summary.maxstring = 120
_summary.maxother = 120

MAX_COLUMNS = 200
MIN_HISTOGRAM = 5
_SKIPPED = (types.ModuleType, types.FunctionType, types.BuiltinFunctionType, types.MethodType, type)


def _encode(answer):
    return base64.b64encode(json.dumps(answer, allow_nan=False, default=str).encode()).decode()


def _namespace():
    shell = get_ipython()
    hidden = getattr(shell, "user_ns_hidden", {})
    return shell.user_ns, hidden


def _kind(value):
    module = type(value).__module__.split(".")[0]
    name = type(value).__name__
    if module == "pandas" and name == "DataFrame":
        return "dataframe"
    if module == "pandas" and name == "Series":
        return "series"
    if module == "polars" and name == "DataFrame":
        return "dataframe"
    if module == "numpy" and name == "ndarray":
        return "array"
    return "other"


def _shape(value):
    try:
        shape = getattr(value, "shape", None)
    except Exception:
        return None
    if isinstance(shape, tuple) and all(isinstance(n, int) for n in shape):
        return list(shape)
    return None


def _size(value):
    if isinstance(value, (str, bytes, list, tuple, dict, set, frozenset)):
        return len(value)
    return None


def _describe(name, value):
    kind = _kind(value)
    shape = _shape(value)
    if kind == "dataframe":
        names = [str(column) for column in list(value.columns)[:6]]
        summary = ", ".join(names) + (", …" if len(value.columns) > 6 else "")
    elif kind in ("series", "array"):
        summary = f"dtype {getattr(value, 'dtype', '?')}"
    else:
        try:
            summary = _summary.repr(value)
        except Exception:
            summary = "<no repr>"
    viewable = _tabular(value)
    return {
        "name": name,
        "type": type(value).__name__,
        "module": type(value).__module__,
        "kind": kind,
        "shape": shape,
        "size": _size(value),
        "summary": summary,
        "viewable": viewable,
    }


def variables():
    _view.clear()
    _converted.clear()
    namespace, hidden = _namespace()
    found = []
    for name, value in list(namespace.items()):
        if name.startswith("_") or name in hidden or isinstance(value, _SKIPPED):
            continue
        found.append(_describe(name, value))
    found.sort(key=lambda each: each["name"].lower())
    return _encode(found)


def _missing(item):
    if item is None:
        return "None"
    if isinstance(item, float) and math.isnan(item):
        return "NaN"
    name = type(item).__name__
    if name == "NaTType" or (name in ("datetime64", "timedelta64") and str(item) == "NaT"):
        return "NaT"
    if name == "NAType":
        return "<NA>"
    return None


def _value(item):
    missing = _missing(item)
    if missing is not None:
        return {"missing": missing}
    if hasattr(item, "item") and type(item).__module__.split(".")[0] == "numpy":
        try:
            item = item.item()
        except Exception:
            pass
    if isinstance(item, bool):
        return item
    if isinstance(item, int):
        return item if abs(item) < 2**53 else str(item)
    if isinstance(item, float):
        return item if math.isfinite(item) else str(item)
    if not isinstance(item, str):
        try:
            item = str(item)
        except Exception:
            return "<no str>"
    return item if len(item) <= 500 else item[:500] + "…"


# The last query's row order, so paging through a sorted or filtered view does not redo the work. A
# run may have changed any variable, so listing the variables after one forgets it.
_view = {}

_COMPARE = {
    "eq": operator.eq,
    "ne": operator.ne,
    "gt": operator.gt,
    "ge": operator.ge,
    "lt": operator.lt,
    "le": operator.le,
}


class Gone(LookupError):
    """An output's table that the kernel no longer holds."""


def _lookup(name):
    if name.startswith("@"):
        key = name[1:]
        if key not in _outputs:
            raise Gone("This table is no longer in the kernel")
        _outputs.move_to_end(key)
        return _outputs[key]
    namespace, _ = _namespace()
    if name not in namespace:
        raise LookupError(f"{name} is not defined in the kernel")
    return namespace[name]


def _missing_answer(reason):
    return _encode({"error": str(reason), "gone": isinstance(reason, Gone)})


def _as_frame(value):
    """The value as a pandas DataFrame, or None when it is not a table or pandas is not there."""
    kind = _kind(value)
    module = type(value).__module__.split(".")[0]
    try:
        import pandas as pd
    except ImportError:
        return None
    if kind == "series":
        return value.to_frame()
    if kind == "dataframe" and module == "pandas":
        return value
    if kind == "dataframe" and module == "polars":
        return _from_polars(value, pd)
    if kind == "array" and value.ndim in (1, 2):
        return pd.DataFrame(value if value.ndim == 2 else value.reshape(-1, 1))
    return None


# The last polars frame converted, so paging through one does not convert it again for every page.
_converted = {}


def _from_polars(value, pd):
    if _converted.get("source") is value:
        return _converted["frame"]
    try:
        frame = value.to_pandas()
    except Exception:
        # to_pandas needs pyarrow, which many polars installs do not have.
        try:
            frame = pd.DataFrame(value.to_dict(as_series=False))
        except Exception:
            return None
    _converted.clear()
    _converted.update(source=value, frame=frame)
    return frame


def _tabular(value):
    """Whether a value can be shown as a table here: a DataFrame or a Series needs pandas to page."""
    kind = _kind(value)
    if kind == "array":
        shape = _shape(value)
        return shape is not None and 1 <= len(shape) <= 2
    if kind not in ("dataframe", "series"):
        return False
    try:
        import pandas  # noqa: F401
    except ImportError:
        return False
    return True


def _column_kind(series):
    from pandas.api import types as t

    if t.is_bool_dtype(series):
        return "bool"
    if t.is_numeric_dtype(series):
        return "number"
    if t.is_datetime64_any_dtype(series):
        return "datetime"
    if t.is_object_dtype(series) or t.is_string_dtype(series) or type(series.dtype).__name__ == "CategoricalDtype":
        return "text"
    return "other"


def _coerce(series, kind, op, value):
    if kind == "number":
        return float(value)
    if kind == "bool":
        if op not in ("eq", "ne"):
            raise ValueError("a true or false column can only be compared for equality")
        return value.strip().lower() in ("true", "1", "yes")
    if kind == "datetime":
        import pandas as pd

        stamp = pd.Timestamp(value)
        zone = getattr(series.dtype, "tz", None)
        if zone is not None and stamp.tzinfo is None:
            stamp = stamp.tz_localize(zone)
        return stamp
    return str(value)


def _mask(series, op, value):
    if op == "missing":
        return series.isna().to_numpy()
    if op == "present":
        return series.notna().to_numpy()
    if op in ("contains", "not_contains", "starts_with"):
        text = series.astype("string").str.lower()
        needle = str(value).lower()
        found = text.str.startswith(needle) if op == "starts_with" else text.str.contains(needle, regex=False)
        found = found.fillna(False).astype(bool).to_numpy()
        return ~found if op == "not_contains" else found
    kind = _column_kind(series)
    try:
        target = _coerce(series, kind, op, value)
    except (TypeError, ValueError) as reason:
        raise ValueError(f"{value!r} cannot be compared with column {series.name!r}: {reason}") from None
    left = series.astype("string") if kind == "text" else series
    try:
        result = _COMPARE[op](left, target)
    except TypeError as reason:
        raise ValueError(f"{value!r} cannot be compared with column {series.name!r}: {reason}") from None
    return result.fillna(False).astype(bool).to_numpy()


def _positions(name, value, frame, query):
    import numpy as np

    key = (name, id(value), json.dumps(query.get("filters"), sort_keys=True), json.dumps(query.get("sort"), sort_keys=True))
    if _view.get("key") == key:
        return _view["positions"]

    positions = np.arange(len(frame))
    for condition in query.get("filters") or []:
        column = frame.iloc[positions, condition["column"]]
        positions = positions[_mask(column, condition["op"], condition.get("value", ""))]

    sort = query.get("sort")
    if sort is not None:
        column = frame.iloc[positions, sort["column"]].reset_index(drop=True)
        ascending = not sort.get("descending", False)
        try:
            order = column.sort_values(ascending=ascending, na_position="last", kind="stable").index
        except TypeError:
            order = column.astype("string").sort_values(ascending=ascending, na_position="last", kind="stable").index
        positions = positions[order.to_numpy()]

    _view.clear()
    _view.update(key=key, positions=positions)
    return positions


def _columns(frame, value):
    # A polars frame is read through pandas, but its columns are named by the types polars gave them.
    own = list(value.schema.values()) if type(value).__module__.split(".")[0] == "polars" else None
    return [
        {
            "name": str(column),
            "dtype": str(own[n] if own else frame.iloc[:, n].dtype),
            "kind": _column_kind(frame.iloc[:, n]),
        }
        for n, column in enumerate(list(frame.columns)[:MAX_COLUMNS])
    ]


def rows(name, request):
    """A page of a table-like variable, filtered and sorted in the kernel as the request says."""
    query = json.loads(request)
    try:
        value = _lookup(name)
    except LookupError as reason:
        return _missing_answer(reason)
    frame = _as_frame(value)
    offset, limit = query["offset"], query["limit"]

    if frame is None:
        if _kind(value) == "array" and value.ndim in (1, 2):
            page = value[offset : offset + limit]
            width = 1 if value.ndim == 1 else value.shape[1]
            columns = [{"name": str(n), "dtype": str(value.dtype), "kind": "other"} for n in range(width)]
            table = [[item] for item in page] if value.ndim == 1 else [list(row) for row in page]
            return _encode(_page(columns, width, [str(n) for n in range(offset, offset + len(page))], table, value.shape[0], value.shape[0], offset, False))
        return _encode({"error": f"{name} is a {type(value).__name__}, which cannot be shown as a table"})

    for condition in query.get("filters") or []:
        if condition.get("op") not in (*_COMPARE, "contains", "not_contains", "starts_with", "missing", "present"):
            return _encode({"error": f"unknown filter {condition.get('op')!r}"})
    try:
        positions = _positions(name, value, frame, query)
    except ValueError as reason:
        return _encode({"error": str(reason)})

    page = frame.iloc[positions[offset : offset + limit]]
    table = [list(row) for row in page.itertuples(index=False, name=None)]
    index = [str(label) for label in page.index]
    return _encode(_page(_columns(frame, value), frame.shape[1], index, table, len(frame), len(positions), offset, True))


def _page(columns, total_columns, index, table, total, matched, offset, queryable):
    return {
        "columns": columns,
        "total_columns": total_columns,
        "index": index,
        "rows": [[_value(item) for item in row[:MAX_COLUMNS]] for row in table],
        "total_rows": total,
        "matched_rows": matched,
        "offset": offset,
        "queryable": queryable,
    }


def _number(item):
    item = float(item)
    return item if math.isfinite(item) else None


def _profile_column(series):
    import numpy as np

    kind = _column_kind(series)
    present = series.dropna()
    found = {"kind": kind, "count": int(len(series)), "missing": int(len(series) - len(present))}
    try:
        found["distinct"] = int(present.nunique())
    except TypeError:
        found["distinct"] = None

    if kind == "number" and len(present):
        values = present.astype(float).to_numpy()
        values = values[np.isfinite(values)]
        if len(values):
            found.update(
                min=_number(values.min()),
                max=_number(values.max()),
                mean=_number(values.mean()),
                std=_number(values.std(ddof=1)) if len(values) > 1 else None,
            )
        # A shape needs a few values to have one; four bars over four numbers say nothing.
        if len(values) >= MIN_HISTOGRAM:
            bins = max(1, min(20, found["distinct"] or 20))
            counts, edges = np.histogram(values, bins=bins)
            found["histogram"] = {"counts": counts.tolist(), "edges": [_number(edge) for edge in edges]}
    elif kind == "datetime" and len(present):
        found.update(min=str(present.min()), max=str(present.max()))
        if len(present) >= MIN_HISTOGRAM:
            stamps = present.to_numpy().astype("datetime64[ns]").astype("int64")
            counts, _ = np.histogram(stamps, bins=max(1, min(20, found["distinct"] or 20)))
            found["histogram"] = {"counts": counts.tolist(), "edges": []}
    elif len(present):
        top = present.astype(str).value_counts().head(5)
        found["top"] = [{"value": _value(label), "count": int(count)} for label, count in top.items()]
    return found


def profile(name):
    """What is in each column of a table-like variable: missing values, distinct values, a distribution."""
    try:
        value = _lookup(name)
    except LookupError as reason:
        return _missing_answer(reason)
    frame = _as_frame(value)
    if frame is None:
        return _encode({"error": f"{name} cannot be profiled"})
    return _encode({"columns": [_profile_column(frame.iloc[:, n]) for n in range(min(frame.shape[1], MAX_COLUMNS))]})


def csv(name, request):
    """The rows a query leaves, as CSV, up to the request's limit."""
    query = json.loads(request)
    try:
        value = _lookup(name)
    except LookupError as reason:
        return _missing_answer(reason)
    frame = _as_frame(value)
    if frame is None:
        return _encode({"error": f"{name} cannot be exported as a table"})
    try:
        positions = _positions(name, value, frame, query)
    except ValueError as reason:
        return _encode({"error": str(reason)})
    rows = frame.iloc[positions[: query["limit"]]]
    columns = query.get("columns")
    if columns:
        if max(columns) >= frame.shape[1]:
            return _encode({"error": "no such column"})
        rows = rows.iloc[:, columns]
    return _encode({"csv": rows.to_csv()})


# A chart is answered in a few hundred numbers however long the frame is: these are what bound it.
MAX_BINS = 50
MAX_BARS = 20
MAX_GROUPS = 8
# Three hues stay apart for every pair of readers with colour-blindness; eight only for neighbours.
MAX_SCATTER_GROUPS = 3
MAX_BOXES = 20
MAX_OUTLIERS = 50
LINE_POINTS = 2000
SCATTER_POINTS = 5000
_AGGREGATES = ("count", "sum", "mean", "median", "min", "max")


def _column(frame, query, field, kinds=None):
    index = query.get(field)
    if not isinstance(index, int) or not 0 <= index < frame.shape[1]:
        raise ValueError(f"choose a column for {field}")
    series = frame.iloc[:, index]
    kind = _column_kind(series)
    if kinds is not None and kind not in kinds:
        raise ValueError(f"{series.name} is a {kind} column, and this chart needs a {' or '.join(kinds)} column")
    return series


def _plain(series):
    """A date column without its time zone, as wall time: plotly reads a date string with an offset wrong."""
    if getattr(series.dtype, "tz", None) is not None:
        return series.dt.tz_localize(None)
    return series


def _floats(values):
    return [_number(item) for item in values]


def _labels(values):
    return [_value(item) for item in values]


def _axis(values):
    """An x axis's values: a date as pandas prints it, which numpy's own `item()` turns into an int."""
    import numpy as np
    import pandas as pd

    if np.issubdtype(values.dtype, np.datetime64):
        return [str(stamp) for stamp in pd.DatetimeIndex(values)]
    return _floats(values)


def _group_order(series, limit):
    """The commonest values of a whole column, so a filter that removes a group never repaints the rest."""
    counts = series.dropna().value_counts(sort=True)
    return list(counts.index[:limit]), max(0, len(counts) - limit)


def _grouped(data, column, order):
    """Rows split by `column` as (slot, label, rows) in `order`, and the rest as one group with neither.
    The slot is a group's place in the whole column, which is the colour it keeps when a filter empties another."""
    import pandas as pd

    codes = pd.Categorical(data[column], categories=order).codes
    parts = dict(iter(data.groupby(codes, sort=True)))
    groups = [(code, label, parts[code]) for code, label in enumerate(order) if code in parts]
    if -1 in parts:
        groups.append((None, None, parts[-1]))
    return groups


def _group(slot, label):
    return {"name": None if slot is None else _value(label), "slot": slot, "other": slot is None}


def _aggregate(rows, by, agg):
    grouped = rows.groupby(by, sort=False, observed=True, dropna=True)
    return grouped.size() if agg == "count" else grouped["y"].agg(agg)


def _histogram(frame, rows, query):
    import numpy as np
    import pandas as pd

    series = _plain(_column(rows, query, "x", ("number", "datetime")).dropna())
    dates = _column_kind(series) == "datetime"
    if dates:
        values = series.to_numpy().astype("datetime64[ns]").astype("int64")
    else:
        values = series.astype(float).to_numpy()
        values = values[np.isfinite(values)]
    if not len(values):
        return {"counts": [], "edges": []}
    low, high = values.min(), values.max()
    if not dates and np.all(values == np.round(values)) and high - low < MAX_BINS:
        # Whole numbers get a bin each, centred on the number, so a bar stands over the value it counts.
        bins = np.arange(low - 0.5, high + 1.5)
    else:
        bins = max(1, min(MAX_BINS, len(np.unique(values))))
    counts, edges = np.histogram(values, bins=bins)
    edges = [str(pd.Timestamp(int(edge))) for edge in edges] if dates else _floats(edges)
    return {"counts": counts.tolist(), "edges": edges}


def _bar(frame, rows, query):
    import pandas as pd

    agg = query.get("agg") or "count"
    if agg not in _AGGREGATES:
        raise ValueError(f"unknown aggregate {agg!r}")
    data = pd.DataFrame({"x": _plain(_column(rows, query, "x")).to_numpy()})
    if agg != "count":
        data["y"] = _column(rows, query, "y", ("number",)).to_numpy()
    totals = _aggregate(data, "x", agg).sort_values(ascending=False, kind="stable")
    kept = list(totals.index[:MAX_BARS])
    folded = max(0, len(totals) - MAX_BARS)

    def heights(part):
        found = _aggregate(part, "x", agg)
        heights = [found.get(label) for label in kept]
        if folded:
            rest = part[~part["x"].isin(kept) & part["x"].notna()]
            heights.append(_aggregate(rest.assign(x=0), "x", agg).get(0) if len(rest) else None)
        return [None if height is None else _number(height) for height in heights]

    answer = {"categories": _labels(kept), "other_categories": folded}
    if query.get("color") is None:
        return {**answer, "series": [{"name": None, "slot": None, "other": False, "values": heights(data)}]}
    order, other_groups = _group_order(_column(frame, query, "color"), MAX_GROUPS)
    data["c"] = _column(rows, query, "color").to_numpy()
    series = [{**_group(slot, label), "values": heights(part)} for slot, label, part in _grouped(data, "c", order)]
    return {**answer, "series": series, "other_groups": other_groups}


def _downsample(xs, ys, points):
    """The lowest and highest point of each stretch, in order: a peak survives, which an average loses."""
    import numpy as np

    if len(xs) <= points:
        return xs, ys
    keep = []
    edges = np.linspace(0, len(xs), points // 2 + 1).astype(int)
    for start, stop in zip(edges[:-1], edges[1:]):
        if stop > start:
            stretch = ys[start:stop]
            keep.extend(sorted({start + int(np.argmin(stretch)), start + int(np.argmax(stretch))}))
    return xs[keep], ys[keep]


def _line(frame, rows, query):
    import pandas as pd

    agg = query.get("agg") or "sum"
    if agg not in _AGGREGATES:
        raise ValueError(f"unknown aggregate {agg!r}")
    x = _plain(_column(rows, query, "x", ("number", "datetime"))).to_numpy()
    measures = query["measures"]
    if not 1 <= len(measures) <= 3:
        raise ValueError("a line chart draws one to three columns")
    if len(measures) > 1 and query.get("color") is not None:
        raise ValueError("a line chart is coloured by a column or draws several, not both")

    def line(group, part):
        points = _aggregate(part, "x", agg).sort_index().dropna()
        xs, ys = _downsample(points.index.to_numpy(), points.to_numpy(dtype=float), LINE_POINTS)
        return {**group, "x": _axis(xs), "y": _floats(ys), "points": int(len(points))}

    if query.get("color") is None:
        series = []
        for index in measures:
            measure = _column(rows, {"y": index}, "y", ("number",))
            group = {"name": str(measure.name), "slot": len(series), "other": False}
            series.append(line(group, pd.DataFrame({"x": x, "y": measure.to_numpy()})))
        return {"series": series}
    data = pd.DataFrame({"x": x, "y": _column(rows, {"y": measures[0]}, "y", ("number",)).to_numpy()})
    order, other_groups = _group_order(_column(frame, query, "color"), MAX_GROUPS)
    data["c"] = _column(rows, query, "color").to_numpy()
    series = [line(_group(slot, label), part) for slot, label, part in _grouped(data, "c", order)]
    return {"series": series, "other_groups": other_groups}


def _scatter(frame, rows, query):
    import numpy as np
    import pandas as pd

    data = pd.DataFrame(
        {
            "x": _plain(_column(rows, query, "x", ("number", "datetime"))).to_numpy(),
            "y": _column(rows, query, "y", ("number",)).to_numpy(),
        }
    )
    if query.get("color") is not None:
        data["c"] = _column(rows, query, "color").to_numpy()
    data = data.dropna(subset=["x", "y"])
    total = len(data)
    if total > SCATTER_POINTS:
        # Seeded, so the same frame draws the same points every time it is asked.
        chosen = np.sort(np.random.default_rng(0).choice(total, SCATTER_POINTS, replace=False))
        data = data.iloc[chosen]
    sampled = {"shown": len(data), "of": total} if total > SCATTER_POINTS else None

    def points(group, part):
        return {**group, "x": _axis(part["x"].to_numpy()), "y": _floats(part["y"].to_numpy())}

    if query.get("color") is None:
        return {"series": [points({"name": None, "slot": None, "other": False}, data)], "sampled": sampled}
    order, other_groups = _group_order(_column(frame, query, "color"), MAX_SCATTER_GROUPS)
    series = [points(_group(slot, label), part) for slot, label, part in _grouped(data, "c", order)]
    return {"series": series, "sampled": sampled, "other_groups": other_groups}


def _box_of(name, values):
    import numpy as np

    q1, median, q3 = np.percentile(values, [25, 50, 75])
    reach = 1.5 * (q3 - q1)
    inside = values[(values >= q1 - reach) & (values <= q3 + reach)]
    outliers = np.sort(values[(values < q1 - reach) | (values > q3 + reach)])
    if len(outliers) > MAX_OUTLIERS:
        # Spread over the range rather than the first fifty, so the furthest on each side are still drawn.
        outliers = outliers[np.linspace(0, len(outliers) - 1, MAX_OUTLIERS).astype(int)]
    return {
        "name": name,
        "q1": _number(q1),
        "median": _number(median),
        "q3": _number(q3),
        "lower": _number(inside.min()),
        "upper": _number(inside.max()),
        "mean": _number(values.mean()),
        "count": int(len(values)),
        "outliers": _floats(outliers),
    }


def _box(frame, rows, query):
    import numpy as np
    import pandas as pd

    data = pd.DataFrame({"y": _column(rows, query, "y", ("number",)).astype(float).to_numpy()})
    data = data[np.isfinite(data["y"])]
    if query.get("x") is None:
        return {"series": [_box_of(None, data["y"].to_numpy())] if len(data) else []}
    data["x"] = _plain(_column(rows, query, "x")).to_numpy()[data.index]
    order, folded = _group_order(data["x"], MAX_BOXES)
    series = [_box_of(_value(label), part["y"].to_numpy()) for slot, label, part in _grouped(data, "x", order) if slot is not None]
    return {"series": series, "other_categories": folded}


_CHARTS = {"histogram": _histogram, "bar": _bar, "line": _line, "scatter": _scatter, "box": _box}


def chart(name, request):
    """What a chart of a table-like variable draws, counted in the kernel: never the rows themselves."""
    query = json.loads(request)
    try:
        value = _lookup(name)
    except LookupError as reason:
        return _missing_answer(reason)
    frame = _as_frame(value)
    if frame is None:
        return _encode({"error": f"{name} cannot be drawn as a chart"})
    draw = _CHARTS.get(query.get("kind"))
    if draw is None:
        return _encode({"error": f"unknown chart {query.get('kind')!r}"})
    measures = query.get("y") or []
    query = {**query, "y": measures[0] if measures else None, "measures": measures}
    filters = query.get("filters") or []
    for condition in filters:
        if condition.get("op") not in (*_COMPARE, "contains", "not_contains", "starts_with", "missing", "present"):
            return _encode({"error": f"unknown filter {condition.get('op')!r}"})
    try:
        positions = _positions(name, value, frame, {"filters": filters})
        answer = draw(frame, frame.iloc[positions], query)
    except (ValueError, TypeError) as reason:
        return _encode({"error": str(reason)})
    return _encode({"kind": query["kind"], **answer, "matched_rows": int(len(positions)), "total_rows": int(len(frame))})


# The tables a cell's output showed, so the output can page, sort and filter the very frame it printed —
# an expression's result has no name to find it by. The newest are kept; an output whose frame was let
# go shows the HTML pandas wrote, as a notebook opened without a kernel does.
MIME = "application/vnd.zasper.dataframe+json"
MAX_OUTPUTS = 50
_outputs = globals().get("_outputs", OrderedDict())


def _keep_output(value):
    if not _tabular(value):
        return None
    shape = _shape(value) or [0]
    key = uuid.uuid4().hex
    _outputs[key] = value
    while len(_outputs) > MAX_OUTPUTS:
        _outputs.popitem(last=False)
    kind = "series" if _kind(value) == "series" else "dataframe"
    return {"id": key, "kind": kind, "rows": shape[0], "columns": shape[1] if len(shape) > 1 else 1}


def install():
    """Adds the formatter that keeps a displayed table, once per kernel."""
    from IPython.core.formatters import BaseFormatter
    from traitlets import ObjectName, Unicode

    formatters = get_ipython().display_formatter.formatters
    if MIME not in formatters:

        class TableFormatter(BaseFormatter):
            format_type = Unicode(MIME)
            print_method = ObjectName("_repr_zasper_table_")
            _return_type = (dict,)

        formatters[MIME] = TableFormatter(parent=get_ipython().display_formatter)
    formatter = formatters[MIME]
    # By the module a class reports, which pandas 3 shortens to `pandas`; registering both keeps older
    # pandas, and a name that is not imported yet costs nothing until it is.
    for module, name in (
        ("pandas", "DataFrame"),
        ("pandas.core.frame", "DataFrame"),
        ("pandas", "Series"),
        ("pandas.core.series", "Series"),
        ("polars", "DataFrame"),
        ("polars.dataframe.frame", "DataFrame"),
    ):
        formatter.for_type_by_name(module, name, _keep_output)
    return _encode(True)


try:
    install()
except Exception:
    pass
