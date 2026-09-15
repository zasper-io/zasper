package search

import (
	"path"
	"strings"
)

/*
scope is the panel's two file filters, each a comma-separated list of globs.

A glob without a slash is a name: `*.py` is any Python file, and `tests` is anything inside a folder of that
name, at any depth. A glob with a slash is a path from the project's root: `src/model` is that folder and
everything in it. A trailing `/` or `/**` says the same as nothing.
*/
type scope struct {
	include []string
	exclude []string
}

func newScope(include, exclude string) scope {
	return scope{include: globList(include), exclude: globList(exclude)}
}

func globList(list string) []string {
	globs := []string{}
	for _, glob := range strings.Split(list, ",") {
		glob = strings.TrimSpace(glob)
		glob = strings.TrimPrefix(glob, "./")
		glob = strings.TrimPrefix(glob, "**/")
		glob = strings.TrimSuffix(glob, "/**")
		glob = strings.TrimSuffix(glob, "/")
		if glob != "" {
			globs = append(globs, glob)
		}
	}
	return globs
}

// admits answers whether a file, by its project-relative slash path, is searched.
func (s scope) admits(relative string) bool {
	if len(s.include) > 0 && !anyGlob(s.include, relative) {
		return false
	}
	return !anyGlob(s.exclude, relative)
}

// excludes answers whether nothing inside a folder can be searched, so a walk need not go into it.
func (s scope) excludes(folder string) bool {
	return anyGlob(s.exclude, folder)
}

func anyGlob(globs []string, relative string) bool {
	segments := strings.Split(relative, "/")
	for _, glob := range globs {
		if globMatches(glob, segments) {
			return true
		}
	}
	return false
}

func globMatches(glob string, segments []string) bool {
	if !strings.Contains(glob, "/") {
		for _, segment := range segments {
			if ok, _ := path.Match(glob, segment); ok {
				return true
			}
		}
		return false
	}
	parts := strings.Split(strings.TrimPrefix(glob, "/"), "/")
	if len(parts) > len(segments) {
		return false
	}
	for i, part := range parts {
		if ok, _ := path.Match(part, segments[i]); !ok {
			return false
		}
	}
	return true
}
