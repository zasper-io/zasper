/*
Package connections keeps the data connections SQL cells run on: what each one is, in connections.json,
and its password, in the secrets store. A project's connections are in <project>/.zasper/connections.json
and can be committed with it; a user's own are in ~/.zasper/connections.json. Neither file ever holds a
password. Queries run in a kernel, which is handed a connection only when it is about to use it; see
docs/SQL.md.
*/
package connections

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sync"

	"github.com/zasper-io/zasper/internal/atomicfile"
	"github.com/zasper-io/zasper/internal/secrets"

	"bytes"
)

// Where a connection is kept.
const (
	ScopeProject = "project"
	ScopeUser    = "user"
)

// Dataframes is the connection every kernel has: DuckDB over its own dataframes. It is not kept anywhere.
const Dataframes = "dataframes"

// Types are the kinds of connection a form can be filled for. Any other database is a SQLAlchemy URL.
var Types = []string{"postgresql", "mysql", "sqlite", "duckdb", "snowflake", "bigquery", "redshift", "databricks", "clickhouse", "url"}

var namePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_.-]{0,63}$`)

// Connection is one connection, as connections.json keeps it: never with its password.
type Connection struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Host     string `json:"host,omitempty"`
	Port     string `json:"port,omitempty"`
	Database string `json:"database,omitempty"`
	User     string `json:"user,omitempty"`
	// A file, for SQLite and DuckDB: relative paths are read from the project's folder.
	Path string `json:"path,omitempty"`
	// A SQLAlchemy URL without its password, for type url.
	URL string `json:"url,omitempty"`

	// Answered, never stored.
	Scope       string `json:"scope,omitempty"`
	HasPassword bool   `json:"has_password,omitempty"`
}

// Store reads and writes the two files and the secrets beside them.
type Store struct {
	project string
	home    func() (string, error)
	secrets secrets.Store
	mu      sync.Mutex
}

// New is the store for the project at root.
func New(root string) *Store {
	return &Store{project: root, home: os.UserHomeDir, secrets: secrets.Default()}
}

func (s *Store) file(scope string) (string, error) {
	if scope == ScopeProject {
		return filepath.Join(s.project, ".zasper", "connections.json"), nil
	}
	home, err := s.home()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".zasper", "connections.json"), nil
}

// secretKey names a password in the secrets store. A project's carries the project's folder, so two
// projects can each have an "analytics" with a password of its own.
func (s *Store) secretKey(scope, name string) string {
	if scope == ScopeProject {
		return "connection:" + s.project + ":" + name
	}
	return "connection:" + name
}

func (s *Store) read(scope string) ([]Connection, error) {
	path, err := s.file(scope)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return []Connection{}, nil
	}
	if err != nil {
		return nil, err
	}
	var list []Connection
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, fmt.Errorf("%s is not a list of connections: %w", path, err)
	}
	return list, nil
}

func (s *Store) write(scope string, list []Connection) error {
	path, err := s.file(scope)
	if err != nil {
		return err
	}
	kept := make([]Connection, len(list))
	for i, c := range list {
		c.Scope, c.HasPassword = "", false
		kept[i] = c
	}
	data, err := json.MarshalIndent(kept, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	_, err = atomicfile.Write(path, bytes.NewReader(append(data, '\n')), 0o644)
	return err
}

// List answers the project's connections, then the user's.
func (s *Store) List() ([]Connection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	answer := []Connection{}
	for _, scope := range []string{ScopeProject, ScopeUser} {
		list, err := s.read(scope)
		if err != nil {
			return nil, err
		}
		for _, c := range list {
			c.Scope = scope
			_, err := s.secrets.Get(s.secretKey(scope, c.Name))
			c.HasPassword = err == nil
			answer = append(answer, c)
		}
	}
	return answer, nil
}

// Find answers the connection called name: the project's when both scopes have one.
func (s *Store) Find(name string) (Connection, bool) {
	list, err := s.List()
	if err != nil {
		return Connection{}, false
	}
	for _, c := range list {
		if c.Name == name {
			return c, true
		}
	}
	return Connection{}, false
}

// Validate says what is wrong with a connection a form sent, if anything.
func Validate(c Connection) error {
	if !namePattern.MatchString(c.Name) {
		return errors.New("a connection's name starts with a letter and has letters, digits, _, . and - in it")
	}
	if c.Name == Dataframes {
		return errors.New("dataframes is the name of the kernel's own dataframes")
	}
	if !slices.Contains(Types, c.Type) {
		return fmt.Errorf("%q is not a kind of connection Zasper knows", c.Type)
	}
	switch c.Type {
	case "sqlite", "duckdb":
		if c.Path == "" && c.Type == "sqlite" {
			return errors.New("a SQLite connection needs the database file")
		}
	case "url":
		if c.URL == "" {
			return errors.New("a URL connection needs its SQLAlchemy URL")
		}
	default:
		if c.Host == "" && c.Type != "bigquery" {
			return errors.New("a connection needs its host")
		}
	}
	return nil
}

// Save writes c into its scope, replacing previous (a name, for a rename) or c.Name. A nil password
// leaves the stored one as it is; an empty one removes it.
func (s *Store) Save(c Connection, previous string, password *string) error {
	if err := Validate(c); err != nil {
		return err
	}
	if c.Scope != ScopeProject && c.Scope != ScopeUser {
		return errors.New("a connection is kept for this project or for all of yours")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	list, err := s.read(c.Scope)
	if err != nil {
		return err
	}
	if previous == "" {
		previous = c.Name
	}
	replaced := false
	for i := range list {
		if list[i].Name == previous {
			list[i] = c
			replaced = true
		} else if list[i].Name == c.Name {
			return fmt.Errorf("there is already a connection called %s", c.Name)
		}
	}
	if !replaced {
		list = append(list, c)
	}
	// The password first: a connection saved without the password it was given would fail later, and
	// further from the dialog that could have said why.
	renamed := previous != c.Name
	if renamed && password == nil {
		if stored, err := s.secrets.Get(s.secretKey(c.Scope, previous)); err == nil {
			password = &stored
		}
	}
	switch {
	case password == nil:
	case *password == "":
		if err := s.secrets.Delete(s.secretKey(c.Scope, c.Name)); err != nil {
			return err
		}
	default:
		if err := s.secrets.Set(s.secretKey(c.Scope, c.Name), *password); err != nil {
			return fmt.Errorf("the password could not be kept: %w", err)
		}
	}
	if err := s.write(c.Scope, list); err != nil {
		return err
	}
	if renamed {
		_ = s.secrets.Delete(s.secretKey(c.Scope, previous))
	}
	return nil
}

// Delete removes a connection and its password.
func (s *Store) Delete(scope, name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	list, err := s.read(scope)
	if err != nil {
		return err
	}
	kept := slices.DeleteFunc(slices.Clone(list), func(c Connection) bool { return c.Name == name })
	if len(kept) == len(list) {
		return fmt.Errorf("there is no connection called %s", name)
	}
	if err := s.write(scope, kept); err != nil {
		return err
	}
	return s.secrets.Delete(s.secretKey(scope, name))
}

// Spec is what a kernel is handed for a connection: where it is, and its password, which travels from
// here to the kernel and nowhere else.
type Spec struct {
	Type     string `json:"type"`
	Host     string `json:"host,omitempty"`
	Port     string `json:"port,omitempty"`
	Database string `json:"database,omitempty"`
	User     string `json:"user,omitempty"`
	Password string `json:"password,omitempty"`
	Path     string `json:"path,omitempty"`
	URL      string `json:"url,omitempty"`
}

// SpecFor is c with its password and with a relative file read from the project.
func (s *Store) SpecFor(c Connection, password *string) Spec {
	spec := Spec{Type: c.Type, Host: c.Host, Port: c.Port, Database: c.Database, User: c.User, Path: c.Path, URL: c.URL}
	if password != nil {
		spec.Password = *password
	} else if stored, err := s.secrets.Get(s.secretKey(c.Scope, c.Name)); err == nil {
		spec.Password = stored
	}
	if spec.Path != "" && !filepath.IsAbs(spec.Path) {
		spec.Path = filepath.Join(s.project, spec.Path)
	}
	return spec
}
