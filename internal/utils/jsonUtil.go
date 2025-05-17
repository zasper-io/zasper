package utils

import (
	"fmt"
	"regexp"
	"time"
)

var iso8601Pattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2})?$`)

func parseDate(s string) interface{} {
	// parse an ISO8601 date string

	// If it is None or not a valid ISO8601 timestamp,
	// it will be returned unmodified.
	// Otherwise, it will return a datetime object.

	if s == "" {
		return nil
	}

	// Check if s matches ISO8601 pattern
	if iso8601Pattern.MatchString(s) {
		dt, err := time.Parse(time.RFC3339, s)
		if err != nil {
			fmt.Println("Error parsing datetime:", err)
			return s // return original string on parse error
		}
		dt = ensureTzinfo(dt)
		return dt
	}

	return s // return original string if not matching ISO8601 pattern
}

func ensureTzinfo(dt time.Time) time.Time {
	if dt.Location() == time.UTC {
		local := time.Now().Location()
		dt = dt.In(local)
	}
	return dt
}

func main() {
	// Example usage
	s := "2023-01-30T12:45:00Z"
	result := parseDate(s)
	fmt.Println("Parsed datetime:", result)

	s2 := "not-a-date"
	result2 := parseDate(s2)
	fmt.Println("Original string:", result2)
}
