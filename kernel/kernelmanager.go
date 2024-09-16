package kernel

import (
	"fmt"
	"net"
	"os"
	"slices"
	"strconv"
	"zasper_go/kernelspec"

	"github.com/rs/zerolog/log"

	"github.com/go-zeromq/zmq4"
	"golang.org/x/exp/rand"
)

type KernelManager struct {
	ConnectionFile string
	OwnsKernel     bool
	ShutdownStatus bool
	AttemptedStart bool
	Ready          bool
	KernelName     string
	ControlSocket  zmq4.Socket
	CachePorts     bool
	Provisioner    LocalProvisioner
	Kernelspec     string

	LastActivity   string
	ExecutionState string
	Connections    int

	KernelId     string
	ShuttingDown bool

	Session        KernelSession
	ConnectionInfo Connection
}

/*********************************************************************
**********************************************************************
***                       START KERNEL                            ***
**********************************************************************
*********************************************************************/

func (km *KernelManager) StartKernel(kernelName string) {

	log.Info().Msg("starting kernel")

	km.AttemptedStart = true

	kernelCmd, kw := km.asyncPrestartKernel(kernelName)

	km.asyncLaunchKernel(kernelCmd, kw)
	km.asyncPostStartKernel(kw)
}

func (km *KernelManager) asyncPostStartKernel(kw map[string]interface{}) {
	km.ControlSocket = km.connectControlSocket()
	km.Ready = true
}

func (km *KernelManager) getKernelspec() kernelspec.KernelSpecJsonData {
	return kernelspec.GetKernelSpec(km.KernelName)
}

func (km *KernelManager) asyncPrestartKernel(kernelName string) ([]string, map[string]interface{}) {
	km.ShuttingDown = false

	km.Provisioner = LocalProvisioner{
		KernelId:    km.KernelId,
		Kernelspec:  km.getKernelspec(),
		PortsCached: false,
	}

	kw := km.preLaunch()
	kernelCmd := kw["cmd"].([]string)
	log.Info().Msgf("kenelName: %s", kernelName)
	return kernelCmd, kw
}

var LOCAL_IPS []string

func isLocalIP(ip string) bool {
	//does `ip` point to this machine?
	return slices.Contains(LOCAL_IPS, ip)
}

/*********************************************************************
**********************************************************************
***                       LAUNCH KERNEL                            ***
**********************************************************************
*********************************************************************/

func (km *KernelManager) asyncLaunchKernel(kernelCmd []string, kw map[string]interface{}) {
	// km.Provisioner.launchKernel(kernelCmd)
	log.Info().Msgf("kw : %s", kw)
	log.Info().Msgf("cmd : %s", kernelCmd)

	ConnectionInfo := km.Provisioner.launchKernel(kernelCmd, kw)
	log.Info().Msgf("connectionInfo: %s", ConnectionInfo)
}

func (km *KernelManager) preLaunch() map[string]interface{} {

	if km.ConnectionInfo.Transport == "tcp" && !isLocalIP(km.ConnectionInfo.IP) {
		log.Info().Msg("Can only launch a kernel on a local interface.")
	}
	log.Info().Msgf("cache ports: %t", km.CachePorts)
	log.Info().Msgf("km.Provisioner.PortsCached %t", km.Provisioner.PortsCached)

	if km.CachePorts && !km.Provisioner.PortsCached {
		km.ConnectionInfo.ShellPort, _ = findAvailablePort()
		km.ConnectionInfo.IopubPort, _ = findAvailablePort()
		km.ConnectionInfo.StdinPort, _ = findAvailablePort()
		km.ConnectionInfo.HbPort, _ = findAvailablePort()
		km.ConnectionInfo.ControlPort, _ = findAvailablePort()
		log.Info().Msgf("connectionInfo : %+v", km.ConnectionInfo)
	}
	km.writeConnectionFile("kernelConnection.json")

	kernelCmd := km.formatKernelCmd()
	log.Info().Msgf("kernel cmd is %s", kernelCmd)
	// the following one is from super
	env := make(map[string]interface{})
	env["cmd"] = kernelCmd
	env["env"] = os.Environ()
	return env
}

func (km *KernelManager) formatKernelCmd() []string {
	cmd := km.getKernelspec().Argv
	return cmd
}

/*********************************************************************
**********************************************************************
***                     CONNECT TO SOCKETS                         ***
**********************************************************************
*********************************************************************/

var ChannelSocketTypes map[string]zmq4.SocketType

func (km *KernelManager) makeURL(channel string) string {
	ip := km.ConnectionInfo.IP
	port := km.ConnectionInfo.ControlPort // TODO getPort

	if km.ConnectionInfo.Transport == "tcp" {
		return fmt.Sprintf("tcp://%s:%d", ip, port)
	}
	return fmt.Sprintf("%s://%s-%d", km.ConnectionInfo.Transport, ip, port)
}

func SetUpChannelSocketTypes() map[string]zmq4.SocketType {
	cst := make(map[string]zmq4.SocketType)
	cst["hb"] = zmq4.Req
	cst["iopub"] = zmq4.Sub
	cst["shell"] = zmq4.Dealer
	cst["stdin"] = zmq4.Dealer
	cst["control"] = zmq4.Dealer

	return cst
}

func (km *KernelManager) connectControlSocket() zmq4.Socket {
	channel := "control"
	url := km.makeURL(channel)
	log.Info().Msgf("url is ====> %s", url)
	log.Info().Msgf("channel is ====> %s", channel)

	socket := zmq4.NewDealer(km.ConnectionInfo.Context)

	// err := socket.Dial(url)
	return socket

}

func (km *KernelManager) connectHbSocket() zmq4.Socket {
	channel := "control"
	url := km.makeURL(channel)
	log.Info().Msgf("url is ====> %s", url)
	log.Info().Msgf("channel is ====> %s", channel)

	socket := zmq4.NewReq(km.ConnectionInfo.Context)

	return socket

}

/*********************************************************************
**********************************************************************
***                           PORT CACHING                         ***
**********************************************************************
*********************************************************************/

var currentlyUsedPorts []int

func findAvailablePort() (int, error) {

	// Start with a random port number or a specific range if needed.
	for {
		port := rand.Intn(5001)
		if portExists(port) {
			continue
		}
		log.Info().Msgf("check port %d", port)
		l, err := net.Listen("tcp", ":"+strconv.Itoa(port))
		if err == nil {
			currentlyUsedPorts = append(currentlyUsedPorts, port)
			l.Close()
			return port, nil
		}
	}
}

func portExists(portNum int) bool {
	// Iterate over the list of ports
	for _, port := range currentlyUsedPorts {
		// Only add the port to the result if it is not the one to remove
		if port == portNum {
			return true
		}
	}
	return false
}

func removePort(portToRemove int) {
	// Create a new slice to hold the ports after removal
	var result []int

	// Iterate over the list of ports
	for _, port := range currentlyUsedPorts {
		// Only add the port to the result if it is not the one to remove
		if port != portToRemove {
			result = append(result, port)
		}
	}

	currentlyUsedPorts = result
}
