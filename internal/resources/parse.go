package resources

// The parsers for each platform's readings, kept apart from the reads so that every one of them is
// tested on every platform.

import (
	"bufio"
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

/*
parseStat reads /proc/<pid>/stat. The command name is in parentheses and may itself hold spaces and
parentheses, so the fields are counted from the last `)`: after it come the state, the parent, the
process group, and 20 fields further on the resident set in pages.
*/
func parseStat(pid int, stat []byte, page uint64) (Process, bool) {
	end := bytes.LastIndexByte(stat, ')')
	if end < 0 {
		return Process{}, false
	}
	fields := strings.Fields(string(stat[end+1:]))
	if len(fields) < 22 {
		return Process{}, false
	}
	ppid, err1 := strconv.Atoi(fields[1])
	pgid, err2 := strconv.Atoi(fields[2])
	rss, err3 := strconv.ParseInt(fields[21], 10, 64)
	if err1 != nil || err2 != nil || err3 != nil || rss < 0 {
		return Process{}, false
	}
	return Process{Pid: pid, Ppid: ppid, Pgid: pgid, RSS: uint64(rss) * page}, true
}

func parseMeminfo(file io.Reader) (*Machine, error) {
	values := map[string]uint64{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		name, rest, ok := strings.Cut(scanner.Text(), ":")
		if !ok {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) == 0 {
			continue
		}
		if value, err := strconv.ParseUint(fields[0], 10, 64); err == nil {
			values[name] = value * 1024
		}
	}
	total, available := values["MemTotal"], values["MemAvailable"]
	if total == 0 {
		return nil, errors.New("no MemTotal in /proc/meminfo")
	}
	return &Machine{Used: total - min(available, total), Total: total, Limit: "machine"}, nil
}

func statValue(stat []byte, key string) uint64 {
	for line := range strings.SplitSeq(string(stat), "\n") {
		name, value, ok := strings.Cut(line, " ")
		if ok && name == key {
			parsed, _ := strconv.ParseUint(strings.TrimSpace(value), 10, 64)
			return parsed
		}
	}
	return 0
}

func parsePS(out string) []Process {
	var processes []Process
	for line := range strings.SplitSeq(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) != 4 {
			continue
		}
		var numbers [4]int64
		ok := true
		for i, field := range fields {
			value, err := strconv.ParseInt(field, 10, 64)
			if err != nil || value < 0 {
				ok = false
				break
			}
			numbers[i] = value
		}
		if ok {
			processes = append(processes, Process{
				Pid: int(numbers[0]), Ppid: int(numbers[1]), Pgid: int(numbers[2]), RSS: uint64(numbers[3]) * 1024,
			})
		}
	}
	return processes
}

func parseVMStat(out string) (uint64, error) {
	lines := strings.Split(out, "\n")
	if len(lines) == 0 {
		return 0, errors.New("vm_stat said nothing")
	}
	// "Mach Virtual Memory Statistics: (page size of 16384 bytes)"
	page := uint64(4096)
	if _, rest, ok := strings.Cut(lines[0], "page size of "); ok {
		if value, err := strconv.ParseUint(strings.Fields(rest)[0], 10, 64); err == nil {
			page = value
		}
	}
	pages := map[string]uint64{}
	for _, line := range lines[1:] {
		name, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		parsed, err := strconv.ParseUint(strings.TrimSuffix(strings.TrimSpace(value), "."), 10, 64)
		if err == nil {
			pages[strings.TrimSpace(name)] = parsed
		}
	}
	active, ok := pages["Pages active"]
	if !ok {
		return 0, errors.New("no active pages in vm_stat")
	}
	return (active + pages["Pages wired down"] + pages["Pages occupied by compressor"]) * page, nil
}

func cgroupMemory(dir, limitFile, usageFile, inactiveKey string, hostTotal uint64) (*Machine, bool) {
	limit, ok := readUint(filepath.Join(dir, limitFile))
	// `max` in v2, and a number near 2^63 in v1, both mean no limit.
	if !ok || limit == 0 || limit >= hostTotal {
		return nil, false
	}
	usage, ok := readUint(filepath.Join(dir, usageFile))
	if !ok {
		return nil, false
	}
	if stat, err := os.ReadFile(filepath.Join(dir, "memory.stat")); err == nil {
		usage -= min(statValue(stat, inactiveKey), usage)
	}
	return &Machine{Used: usage, Total: limit, Limit: "container"}, true
}

func readUint(path string) (uint64, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	value, err := strconv.ParseUint(strings.TrimSpace(string(data)), 10, 64)
	return value, err == nil
}

// parsePss reads the `Pss:` line of /proc/<pid>/smaps_rollup, in kB.
func parsePss(rollup []byte) (uint64, bool) {
	for line := range strings.SplitSeq(string(rollup), "\n") {
		rest, ok := strings.CutPrefix(line, "Pss:")
		if !ok {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) == 0 {
			return 0, false
		}
		kb, err := strconv.ParseUint(fields[0], 10, 64)
		return kb * 1024, err == nil
	}
	return 0, false
}
