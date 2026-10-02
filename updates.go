package main

import (
	"context"
	_ "embed"
	"fmt"
	"io"

	"github.com/zasper-io/zasper/internal/updates"
)

// What's new is read from here, so it needs no network.
//
//go:embed CHANGELOG.md
var changelog string

// installMethod is stamped by a channel that builds its own binary: `-X main.installMethod=snap`.
var installMethod string

func newUpdateChecker() *updates.Checker {
	return updates.New(version, updates.DetectInstall(installMethod), changelog)
}

// checkForUpdate is `zasper --check-update`: it asks now, says what it was told, and answers the exit
// status, which is 0 when this is the newest version, 1 when there is a newer one and 2 when it could
// not tell.
func checkForUpdate(ctx context.Context, checker *updates.Checker, out io.Writer) int {
	release, err := checker.Check(ctx)
	if err != nil {
		fmt.Fprintf(out, "Could not check for updates: %v\n", err)
		return 2
	}
	notice := updateNotice(checker.Against(&release))
	if notice == nil {
		fmt.Fprintf(out, "Zasper %s is the newest version.\n", version)
		return 0
	}
	for _, line := range notice {
		fmt.Fprintln(out, line)
	}
	return 1
}
