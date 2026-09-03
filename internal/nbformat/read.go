package nbformat

import (
	"bytes"
	"encoding/json"
	"fmt"
)

/*
Read decodes a .ipynb file into its wire form: the same document with the multiline strings joined.

A document older than nbformat 4 is converted (see [Convert]), so callers only ever see version 4.
An error means the bytes are not a notebook that can be worked with at all — malformed JSON, or a
field whose JSON type leaves nothing to read, such as `cells` that is not a list. Everything a
notebook can survive, including a missing cell id or an output that is missing a required field, is
carried through and left for [Validate] to report.
*/
func Read(data []byte) (Document, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	// Numbers stay as they were written. Decoding them into float64 would rewrite 1 as 1 but also
	// 1e10 as 10000000000, and would round anything a float cannot hold.
	decoder.UseNumber()

	var doc Document
	if err := decoder.Decode(&doc); err != nil {
		return nil, fmt.Errorf("not a valid notebook: %w", err)
	}

	major, minor := doc.Version()
	switch {
	case major == 0:
		return nil, fmt.Errorf("not a valid notebook: no nbformat version")
	case major > Major:
		return nil, fmt.Errorf(
			"notebook format %s is newer than this build supports (%d.x)", versionString(major, minor), Major)
	case major < Major:
		if err := Convert(doc); err != nil {
			return nil, err
		}
	}

	if err := fatalProblem(Validate(doc)); err != nil {
		return nil, fmt.Errorf("not a valid notebook: %w", err)
	}

	joinDocument(doc)
	stripTransient(doc)
	return doc, nil
}

/*
Unmarshal decodes a notebook that is already in wire form — the shape the editor sends back — with
no line joining and no conversion.
*/
func Unmarshal(data []byte) (Document, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()

	var doc Document
	if err := decoder.Decode(&doc); err != nil {
		return nil, fmt.Errorf("not a valid notebook: %w", err)
	}
	if err := fatalProblem(Validate(doc)); err != nil {
		return nil, fmt.Errorf("not a valid notebook: %w", err)
	}
	return doc, nil
}

func fatalProblem(problems []Problem) error {
	for _, problem := range problems {
		if problem.Fatal {
			return problem
		}
	}
	return nil
}
