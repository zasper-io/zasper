package kernel

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"os"

	"github.com/go-zeromq/zmq4"
	"github.com/rs/zerolog/log"
)

/*
How long a dial keeps trying, and how long between tries.

StartKernel returns as soon as the kernel process has been spawned, so the sockets below are dialled at
a kernel that has very likely not bound its ports yet — and zmq4 does not come back to a refused
endpoint later. It retries ten times a quarter of a second apart and then hands back a socket with
nothing behind it and no way to get anything: the connection is silently dead, which is worse than
slow. Two and a half seconds is less than a cold interpreter takes to import ipykernel, so the budget
here is the one the handshake in channels.go spends waiting for the kernel to answer. A dial still
failing at the end of it is cut short anyway when the client goes, since the retry loop watches the
socket's context.
*/
const (
	dialRetryInterval = 250 * time.Millisecond
	// KernelStartupBudget is how long a client connection waits for its kernel to bind its ports and
	// answer, before giving up and carrying on without it.
	KernelStartupBudget = 30 * time.Second
)

// dialOptions is the retry budget above, plus whatever else the socket asking for it needs.
func dialOptions(opts ...zmq4.Option) []zmq4.Option {
	return append(opts,
		zmq4.WithDialerRetry(dialRetryInterval),
		zmq4.WithDialerMaxRetries(int(KernelStartupBudget/dialRetryInterval)),
	)
}

// connectionFileMixin
type Connection struct {
	DataDir    string
	IP         string
	Transport  string
	KernelName string
	Context    context.Context

	HbPort      int
	ShellPort   int
	IopubPort   int
	StdinPort   int
	ControlPort int
}

func (km *KernelManager) getConnectionInfo() Connection {
	return km.ConnectionInfo
}

type ConnectionFileData struct {
	Transport       string `json:"transport"`
	IP              string `json:"ip"`
	Key             string `json:"key"`
	StdinPort       int    `json:"stdin_port"`
	IopubPort       int    `json:"iopub_port"`
	ShellPort       int    `json:"shell_port"`
	HbPort          int    `json:"hb_port"`
	ControlPort     int    `json:"control_port"`
	SignatureScheme string `json:"signature_scheme"`
	KernelName      string `json:"kernel_name"`
}

func (km *KernelManager) writeConnectionFile(connectionFile string) error {
	// Open the file for writing, create it if it doesn't exist, or truncate it if it does.
	file, err := os.Create(connectionFile)
	log.Debug().Msgf("writing connection info to %s", file.Name())
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	defer file.Close()

	// Create a JSON encoder and set indentation for pretty-printing.
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "    ")

	data := ConnectionFileData{
		Transport:       km.ConnectionInfo.Transport,
		IP:              km.ConnectionInfo.IP,
		Key:             km.Session.Key,
		StdinPort:       km.ConnectionInfo.StdinPort,
		IopubPort:       km.ConnectionInfo.IopubPort,
		ShellPort:       km.ConnectionInfo.ShellPort,
		HbPort:          km.ConnectionInfo.HbPort,
		ControlPort:     km.ConnectionInfo.ControlPort,
		SignatureScheme: km.Session.SignatureScheme,
		KernelName:      km.KernelName,
	}

	// Encode the data as JSON and write it to the file.
	if err := encoder.Encode(data); err != nil {
		return fmt.Errorf("failed to encode JSON: %w", err)
	}

	return nil
}

/*********************************************************************
**********************************************************************
***                  Create Connected Sockets                      ***
**********************************************************************
*********************************************************************/

func (conn *Connection) makeURL(channel string, port int) string {

	if conn.Transport == "tcp" {
		return fmt.Sprintf("tcp://%s:%d", conn.IP, port)
	}
	return fmt.Sprintf("%s://%s-%d", conn.Transport, conn.IP, port)
}

func (conn *Connection) ConnectShell(ctx context.Context, id zmq4.SocketIdentity) zmq4.Socket {
	channel := "shell"
	url := conn.makeURL(channel, conn.ShellPort)
	socket := zmq4.NewDealer(ctx, dialOptions(zmq4.WithID(id))...)
	err := socket.Dial(url)
	if err != nil {
		log.Error().Msgf("could not dial: %v", err)
	}
	return socket

}

func (conn *Connection) ConnectControl(ctx context.Context) zmq4.Socket {
	channel := "control"
	url := conn.makeURL(channel, conn.ControlPort)
	socket := zmq4.NewDealer(ctx, dialOptions()...)
	err := socket.Dial(url)
	if err != nil {
		log.Error().Msgf("could not dial: %v", err)
	}
	return socket
}

func (conn *Connection) ConnectIopub(ctx context.Context) zmq4.Socket {
	channel := "iopub"

	url := conn.makeURL(channel, conn.IopubPort)
	socket := zmq4.NewSub(ctx, dialOptions()...)
	err := socket.SetOption(zmq4.OptionSubscribe, "")
	if err != nil {
		log.Error().Msgf("could not subscribe: %v", err)
	}
	// Reported like the rest of them: a socket that failed to dial is one no output ever comes out of,
	// and this is the channel every cell's output arrives on.
	if err := socket.Dial(url); err != nil {
		log.Error().Msgf("could not dial: %v", err)
	}
	return socket

}

func (conn *Connection) ConnectStdin(ctx context.Context, id zmq4.SocketIdentity) zmq4.Socket {
	channel := "stdin"
	url := conn.makeURL(channel, conn.StdinPort)
	socket := zmq4.NewDealer(ctx, dialOptions(zmq4.WithID(id))...)
	err := socket.Dial(url)

	if err != nil {
		log.Error().Msgf("could not dial: %v", err)
	}

	return socket

}

func (conn *Connection) ConnectHb(ctx context.Context) zmq4.Socket {
	channel := "hb"
	url := conn.makeURL(channel, conn.HbPort)
	socket := zmq4.NewReq(ctx, dialOptions()...)
	err := socket.Dial(url)

	if err != nil {
		log.Error().Msgf("could not dial: %v", err)
	}
	return socket
}
