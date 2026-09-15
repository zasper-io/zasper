package search

import (
	"errors"
	"fmt"
	"regexp"
	"regexp/syntax"
	"strings"
	"unicode/utf8"
)

/*
Query is what the search panel asks for: one pattern, the find card's three options, and the file filters.

A pattern is matched a line at a time, as the editor's find is, so no match spans a line break.
*/
type Query struct {
	Pattern       string `json:"pattern"`
	CaseSensitive bool   `json:"case_sensitive"`
	WholeWord     bool   `json:"whole_word"`
	Regexp        bool   `json:"regexp"`
	// Comma-separated globs, see scope.
	Include string `json:"include"`
	Exclude string `json:"exclude"`
	// When set, each range carries what replacing it would write, which a preview cannot work out on
	// its own for a regular expression's groups.
	Replace *string `json:"replace,omitempty"`
}

var errNoPattern = errors.New("a pattern is required")

// compile answers the expression the query searches with. The error names what is wrong with the
// reader's pattern rather than with the expression built around it.
func (q Query) compile() (*regexp.Regexp, error) {
	if q.Pattern == "" {
		return nil, errNoPattern
	}
	expr := q.Pattern
	if q.Regexp {
		if _, err := syntax.Parse(expr, syntax.Perl); err != nil {
			var bad *syntax.Error
			if errors.As(err, &bad) {
				return nil, fmt.Errorf("Bad pattern: %s", bad.Code)
			}
			return nil, fmt.Errorf("Bad pattern: %w", err)
		}
	} else {
		expr = regexp.QuoteMeta(expr)
	}
	if q.WholeWord {
		expr = `\b(?:` + expr + `)\b`
	}
	if !q.CaseSensitive {
		expr = `(?i)` + expr
	}
	return regexp.Compile(expr)
}

// matchesIn answers the byte ranges re matches in line, with their groups, leaving out empty matches:
// `a*` matches between every two characters, and nothing can be shown or replaced there.
func matchesIn(re *regexp.Regexp, line string) [][]int {
	found := re.FindAllStringSubmatchIndex(line, -1)
	kept := found[:0]
	for _, loc := range found {
		if loc[1] > loc[0] {
			kept = append(kept, loc)
		}
	}
	return kept
}

/*
expand answers what replacing one match writes. For a regular expression, `$&` is the match and `$0`–`$9`
its groups, as in a notebook's own find; a group that did not take part is left as written.
*/
func expand(template string, isRegexp bool, line string, loc []int) string {
	if !isRegexp || !strings.Contains(template, "$") {
		return template
	}
	var out strings.Builder
	for i := 0; i < len(template); i++ {
		if template[i] == '$' && i+1 < len(template) {
			next := template[i+1]
			if next == '&' {
				out.WriteString(line[loc[0]:loc[1]])
				i++
				continue
			}
			if next >= '0' && next <= '9' {
				group := int(next - '0')
				if 2*group+1 < len(loc) && loc[2*group] >= 0 {
					out.WriteString(line[loc[2*group]:loc[2*group+1]])
					i++
					continue
				}
			}
		}
		out.WriteByte(template[i])
	}
	return out.String()
}

/*
columns converts ascending byte offsets in line to UTF-16 code units, which is what the editor counts
positions in: an emoji before a match is four bytes and two units, and a byte offset would land the
cursor two characters late.
*/
func columns(line string, offsets []int) []int {
	result := make([]int, len(offsets))
	column, at := 0, 0
	for i, offset := range offsets {
		for at < offset && at < len(line) {
			r, size := utf8.DecodeRuneInString(line[at:])
			if r >= 0x10000 {
				column += 2
			} else {
				column++
			}
			at += size
		}
		result[i] = column
	}
	return result
}
