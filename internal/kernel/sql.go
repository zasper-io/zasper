package kernel

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed sql.py
var sqlSource []byte

// sqlCode loads sql.py as the module _zasper_sql, which also registers the %%zasper_sql magic.
var sqlCode = moduleCode("_zasper_sql", sqlSource)

// SQLSchema is a connection's schemas and their tables, or why they could not be read.
type SQLSchema struct {
	Schemas []SQLSchemaEntry `json:"schemas"`
	SQLProblem
}

type SQLSchemaEntry struct {
	Name    string     `json:"name"`
	Default bool       `json:"default,omitempty"`
	Tables  []SQLTable `json:"tables"`
}

type SQLTable struct {
	Name string `json:"name"`
	// table, view or dataframe.
	Kind string `json:"kind"`
	Rows *int   `json:"rows,omitempty"`
}

// SQLColumns is a table's columns, or why they could not be read.
type SQLColumns struct {
	Columns []SQLColumn `json:"columns"`
	SQLProblem
}

type SQLColumn struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// SQLTest is what connecting found.
type SQLTest struct {
	OK      bool   `json:"ok"`
	Version string `json:"version,omitempty"`
	MS      int    `json:"ms,omitempty"`
	SQLProblem
}

// SQLProblem is why a connection could not be used, and the package to install when that is the reason.
type SQLProblem struct {
	Error   string `json:"error,omitempty"`
	Missing string `json:"missing,omitempty"`
}

func (km *KernelManager) sql(ctx context.Context, call string, into interface{}) error {
	return km.ask(ctx, sqlCode, "__import__('_zasper_sql')."+call, into)
}

// SQLRegister hands the kernel a connection, password included, for the queries about to run on it. It
// is kept in the helper module, never in the user's namespace.
func (km *KernelManager) SQLRegister(ctx context.Context, name string, spec any) error {
	encoded, err := json.Marshal(spec)
	if err != nil {
		return err
	}
	var ok bool
	return km.sql(ctx, fmt.Sprintf("register(%s, %s)", pyString(name), pyString(string(encoded))), &ok)
}

// SQLSchema reads what a connection holds, down to its tables.
func (km *KernelManager) SQLSchema(ctx context.Context, name string) (SQLSchema, error) {
	var answer SQLSchema
	err := km.sql(ctx, fmt.Sprintf("schema(%s)", pyString(name)), &answer)
	return answer, err
}

// SQLColumns reads one table's columns.
func (km *KernelManager) SQLColumns(ctx context.Context, name, schema, table string) (SQLColumns, error) {
	var answer SQLColumns
	err := km.sql(ctx, fmt.Sprintf("columns(%s, %s, %s)", pyString(name), pyString(schema), pyString(table)), &answer)
	return answer, err
}

// SQLTest connects and answers what is on the other end.
func (km *KernelManager) SQLTest(ctx context.Context, name string) (SQLTest, error) {
	var answer SQLTest
	err := km.sql(ctx, fmt.Sprintf("test(%s)", pyString(name)), &answer)
	return answer, err
}
