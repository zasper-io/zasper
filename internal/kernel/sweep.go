package kernel

import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// How old a connection file must be before a sweep may take it: a kernel still starting has written its
// file and not yet bound its ports.
const sweepAfter = time.Minute

/*
SweepConnectionFiles deletes the connection files of kernels that are no longer running, from servers
that were killed or crashed before they could stop them. Each holds a kernel's signing key. Several
servers share the folder, so a file is taken only when its kernel does not answer on its shell port.
*/
func SweepConnectionFiles() {
	sweepConnectionFiles(runtimeDir(), time.Now(), listening)
}

func sweepConnectionFiles(dir string, now time.Time, alive func(ip string, port int) bool) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	swept := 0
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, "kernel-") || !strings.HasSuffix(name, ".json") {
			continue
		}
		info, err := entry.Info()
		if err != nil || now.Sub(info.ModTime()) < sweepAfter {
			continue
		}
		path := filepath.Join(dir, name)
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var connection ConnectionFileData
		if json.Unmarshal(data, &connection) == nil && connection.ShellPort != 0 && alive(connection.IP, connection.ShellPort) {
			continue
		}
		if os.Remove(path) == nil {
			swept++
		}
	}
	if swept > 0 {
		log.Debug().Msgf("removed %d connection files of kernels no longer running", swept)
	}
}

func listening(ip string, port int) bool {
	if ip == "" {
		ip = "127.0.0.1"
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(ip, strconv.Itoa(port)), 200*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}
