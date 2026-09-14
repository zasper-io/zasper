package provisioner

import (
	"runtime"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestALaunchedKernelIsKeptAndItsConnectionInfoAnswered(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses sh to stand in for a kernel")
	}
	provisioner := &LocalProvisioner{ConnectionInfo: KernelConnectionInfo{"shell_port": 5555}}

	// sh takes the connection file as $0 and ignores it, and stays up the way a kernel does.
	info, err := provisioner.LaunchKernel([]string{"sh", "-c", "sleep 30", "{connection_file}"}, map[string]interface{}{}, "kernel-test.json")

	require.NoError(t, err)
	require.NotNil(t, provisioner.Process)
	t.Cleanup(func() {
		provisioner.Process.Kill()
		select {
		case <-provisioner.Process.Done():
		case <-time.After(5 * time.Second):
		}
	})
	assert.Positive(t, provisioner.Process.Pid)
	assert.Equal(t, KernelConnectionInfo{"shell_port": 5555}, info)
}

func TestAKernelThatCannotStartIsNotKept(t *testing.T) {
	provisioner := &LocalProvisioner{}

	_, err := provisioner.LaunchKernel([]string{"/nowhere/python3", "-m", "ipykernel_launcher"}, map[string]interface{}{}, "kernel-test.json")

	assert.Error(t, err)
	assert.Nil(t, provisioner.Process)
}
