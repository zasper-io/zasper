# nbformat

Reads and writes Jupyter notebooks (`.ipynb`), in Go, with the same results as Python's
[nbformat](https://github.com/jupyter/nbformat). A notebook that Zasper opens and saves comes out
byte-for-byte the file that Jupyter would have written, so a save produces no spurious diff and no
merge conflict.

It replaces the hand-rolled notebook structs that used to live in `internal/content/notebook.go`,
which lost every key they did not name.

## The two forms of a notebook

nbformat keeps a notebook's long strings in two interchangeable shapes, and so does this package:

- **disk form** — `source`, output `text` and mime-bundle values are lists of lines. This is what a
  `.ipynb` file holds.
- **wire form** — each of those is one string. This is what the editor consumes and sends back.

```
file ──Read──▶ wire form ──▶ editor ──▶ Unmarshal ──▶ Normalize ──▶ Marshal ──▶ file
                                                       (disk form)
```

Joining and splitting are deliberately asymmetrical, following nbformat's `rwbase.py`: base64 image
data is joined on the way in but never split on the way out, because one line of base64 is not a
line of text and splitting it would rewrite every image in the file. JSON mime types are left alone
in both directions.

## API

A notebook is a `Document` — the decoded JSON as a `map[string]interface{}`, not a set of structs.
The format is extensible by design (arbitrary keys in notebook and cell metadata, standard keys that
change shape between minor versions), and a field a struct does not name is a field a round trip
silently drops. Only what this package has a reason to touch is interpreted.

| Function | What it does |
| --- | --- |
| `Read(data)` | Decodes a file into wire form. Converts anything older than 4, so callers only see version 4. |
| `Unmarshal(data)` | Decodes a notebook already in wire form — what the editor sends back. No joining, no conversion. |
| `Normalize(doc)` | Returns a copy in disk form: lines split, cells and outputs carrying only the keys their type allows, cell ids present exactly when the version has them. |
| `Marshal(doc)` | Renders a document as a file. Normalizes first, so calling `Normalize` yourself is only needed if you want to inspect the result. |
| `Validate(doc)` | Checks a document against the rules of nbformat 4 and returns every `Problem` it finds. Accepts either form. |
| `Convert(doc)` | Upgrades a version 2 or 3 document to 4.5 in place. Called by `Read`. |
| `New()` | An empty notebook at 4.5, which is what a new notebook created by Jupyter is. |

`Document` has `Version()`, `Cells()` and `Metadata()` accessors; `Cells()` hands back the
document's own maps, so writing to one writes to the document. `Normalize` copies first, so a save
cannot write through to the document a caller still holds.

```go
doc, err := nbformat.Read(data)          // wire form, version 4
for _, problem := range nbformat.Validate(doc) {
    log.Warn().Msgf("%s: %s", path, problem)
}
out, err := nbformat.Marshal(doc)        // disk form, ready to write
```

## Version support

| Version | Behaviour |
| --- | --- |
| 1 | Refused. It predates `worksheets`, and there is nothing to map from. |
| 2, 3 | Converted to 4.5 on read, by nbformat's own mapping (`worksheets` → `cells`, `input` → `source`, `prompt_number` → `execution_count`, heading and html cells → markdown, `pyout`/`pyerr` → `execute_result`/`error`, sibling output keys → a mime bundle). See the comment at the top of `convert.go` for the full table. |
| 4.0 – 4.5 | Read and written as they are. |
| A future 4.x | Read as it is and written back at its own minor version. Rules gated on the version (cell ids, attachments) treat it as 4.5, the newest this package knows. |
| 5.x and later | Refused: a major version newer than this build understands. |

**A file keeps its own minor version on save.** A 4.2 notebook is written back as 4.2, not silently
upgraded — unlike JupyterLab, which rewrites to the newest revision. The version-dependent rules
follow from it: cell ids are written from 4.5 onwards and stripped below it, and attachments from
4.1 onwards.

## Validation

`Validate` encodes nbformat's JSON schema by hand rather than pulling in a schema validator, and
reports every problem instead of the first. Each `Problem` has a `Path` (`cells[2].outputs[0].data`)
and a `Message`.

Nearly everything is reported and not refused: a save is the wrong moment to decline to keep
someone's work, and a notebook with a missing cell id or an output short of a required field is
still a notebook. The exception is a field whose JSON type leaves nothing to read at all — `cells`
that is a number, `metadata` that is a string, a cell that is not an object. Those are marked
`Fatal`, and `Read`/`Unmarshal` reject the document, because carrying on would mean handing back a
notebook whose content had been silently dropped.

What is checked: the version keys; a known `cell_type`; `source` and `metadata`; `execution_count`
and `outputs` on code cells and nowhere else; `attachments` on markdown and raw cells from 4.1;
cell ids (1–64 characters of `[a-zA-Z0-9-_]`, unique, present exactly from 4.5); and the required
fields of each output type.

## What a save preserves, and what it drops

Preserved: every key the file arrived with, including ones this package has never heard of, at the
notebook, cell, output and metadata level. Cell ids too — from 4.5 they belong to the document and
are what another client's diffs and comments are keyed to.

Dropped, to match what nbformat itself does in both directions: `orig_nbformat`,
`orig_nbformat_minor` and `signature` from notebook metadata, and `trusted` from cell metadata —
all of these describe a session rather than the notebook. Also dropped are the editor's own keys
(`reload`) and keys a cell's type does not allow, which is how the editor holds every cell in one
shape.

## Byte format

`Marshal` writes what nbformat writes: keys sorted, indented by one space, no HTML escaping (Go
escapes `<`, `>` and `&` by default, which nothing else writing notebooks does), and a closing
newline. Numbers are decoded with `json.Number` so the file's own spelling survives — decoding into
`float64` would rewrite `1e10` as `10000000000` and round anything a float cannot hold.

## Tests

```sh
go test ./internal/nbformat/
```

`testdata/` holds one fixture per version — v4.0 through v4.5 and a v3 — each with a code cell
carrying all four output types, a markdown cell with an attachment, and a raw cell. They are written
by Python nbformat itself, so they are exactly what Jupyter puts on disk. Regenerate them with:

```sh
python3 internal/nbformat/testdata/make_fixtures.py   # needs the nbformat package installed
```

The acceptance test is `TestRoundTripIsByteIdentical`: read a fixture, write it again, and the bytes
must match for every version. Anything dropped, reformatted or relabelled shows up there as a diff.

## Not implemented

- Version 1, and writing any version below 4.
- Notebook signing and the trust database. `trusted` is stripped rather than computed.
- JSON-schema-driven validation. The rules are hand-written, and a schema change means editing
  `validate.go`.
