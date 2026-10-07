package resources

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStatIsReadFromAfterTheCommandName(t *testing.T) {
	// A command name with a space and a parenthesis in it, which is why fields count from the last `)`.
	stat := "4242 (python (worker) 1) S 4200 4200 4200 0 -1 4194560 500 0 0 0 10 2 0 0 20 0 3 0 9000 " +
		"812000000 1500 18446744073709551615 1 1 0 0 0 0 0 16781312 2 0 0 0 17 3 0 0 0 0 0\n"

	p, ok := parseStat(4242, []byte(stat), 4096)
	require.True(t, ok)
	assert.Equal(t, Process{Pid: 4242, Ppid: 4200, Pgid: 4200, RSS: 1500 * 4096}, p)

	_, ok = parseStat(1, []byte("1 (init) S 0"), 4096)
	assert.False(t, ok)
}

func TestMeminfoUsedIsWhatIsNotAvailable(t *testing.T) {
	meminfo := "MemTotal:       65536000 kB\nMemFree:         1000000 kB\nMemAvailable:   24576000 kB\n"

	machine, err := parseMeminfo(strings.NewReader(meminfo))
	require.NoError(t, err)
	assert.Equal(t, &Machine{Used: 40960000 * 1024, Total: 65536000 * 1024, Limit: "machine"}, machine)
}

func TestACgroupLimitIsTheContainersAndLeavesOutInactiveCache(t *testing.T) {
	dir := t.TempDir()
	write := func(name, content string) {
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600))
	}
	write("memory.max", "17179869184\n")
	write("memory.current", "10737418240\n")
	write("memory.stat", "anon 8589934592\ninactive_file 2147483648\nactive_file 1\n")

	machine, ok := cgroupMemory(dir, "memory.max", "memory.current", "inactive_file", 256*gib)
	require.True(t, ok)
	assert.Equal(t, &Machine{Used: 8 * gib, Total: 16 * gib, Limit: "container"}, machine)

	write("memory.max", "max\n")
	_, ok = cgroupMemory(dir, "memory.max", "memory.current", "inactive_file", 256*gib)
	assert.False(t, ok, "no limit")

	write("memory.max", "9223372036854771712\n")
	_, ok = cgroupMemory(dir, "memory.max", "memory.current", "inactive_file", 256*gib)
	assert.False(t, ok, "cgroup v1's way of saying no limit")
}

func TestPSRowsAreInKiB(t *testing.T) {
	out := "    1     0     1  12000\n  812     1   812 524288\nnot a row\n"

	assert.Equal(t, []Process{
		{Pid: 1, Ppid: 0, Pgid: 1, RSS: 12000 * 1024},
		{Pid: 812, Ppid: 1, Pgid: 812, RSS: 512 * mib},
	}, parsePS(out))
}

func TestVMStatUsedIsWiredActiveAndCompressed(t *testing.T) {
	out := `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               10000.
Pages active:                            200000.
Pages inactive:                          150000.
Pages wired down:                         50000.
Pages occupied by compressor:             25000.
`
	used, err := parseVMStat(out)
	require.NoError(t, err)
	assert.Equal(t, uint64(275000*16384), used)
}

func TestNvidiaSMIRows(t *testing.T) {
	gpus, err := parseGPUs([]byte("0, GPU-a1, NVIDIA A10G, 87, 18637, 23028\n1, GPU-b2, NVIDIA A10G, [N/A], 0, 23028\n"))
	require.NoError(t, err)
	require.Len(t, gpus, 2)
	busy := 87
	assert.Equal(t, GPU{Index: 0, UUID: "GPU-a1", Name: "NVIDIA A10G", Utilization: &busy,
		MemoryUsed: 18637 * mib, MemoryTotal: 23028 * mib}, gpus[0])
	assert.Nil(t, gpus[1].Utilization, "[N/A] is not a number")

	procs := parseGPUProcesses([]byte("4242, GPU-a1, 18329\n4250, GPU-a1, 300\n"))
	assert.Equal(t, []GPUProcess{
		{Pid: 4242, UUID: "GPU-a1", Memory: 18329 * mib},
		{Pid: 4250, UUID: "GPU-a1", Memory: 300 * mib},
	}, procs)
}

func TestPssIsReadFromSmapsRollup(t *testing.T) {
	rollup := "55d0c0000000-7ffd5a7fe000 ---p 00000000 00:00 0  [rollup]\nRss:             1048576 kB\nPss:              409600 kB\nPss_Anon:         400000 kB\n"

	pss, ok := parsePss([]byte(rollup))
	require.True(t, ok)
	assert.Equal(t, uint64(400*mib), pss)

	_, ok = parsePss([]byte("Rss: 10 kB\n"))
	assert.False(t, ok)
}
