package kernel

import (
	"context"
	"encoding/json"
	"fmt"

	"os"

	"github.com/go-zeromq/zmq4"
	"github.com/rs/zerolog/log"
)

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
	log.Info().Msgf("writing connection info to %s", file.Name())
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
	socket := zmq4.NewDealer(ctx, zmq4.WithID(id))
	socket.Dial(url)
	return socket

}

func (conn *Connection) ConnectControl(ctx context.Context) zmq4.Socket {
	channel := "control"
	url := conn.makeURL(channel, conn.ControlPort)
	socket := zmq4.NewDealer(ctx)
	socket.Dial(url)
	return socket
}

func (conn *Connection) ConnectIopub(ctx context.Context) zmq4.Socket {
	channel := "iopub"

	url := conn.makeURL(channel, conn.IopubPort)
	socket := zmq4.NewSub(ctx)
	err := socket.SetOption(zmq4.OptionSubscribe, "")
	if err != nil {
		log.Info().Msgf("could not subscribe: %v", err)
	}
	socket.Dial(url)
	return socket

}

func (conn *Connection) ConnectStdin(ctx context.Context, id zmq4.SocketIdentity) zmq4.Socket {
	channel := "stdin"
	url := conn.makeURL(channel, conn.StdinPort)
	socket := zmq4.NewDealer(ctx, zmq4.WithID(id))
	err := socket.Dial(url)

	if err != nil {
		log.Fatal().Msgf("dealer failed to dial: %v", err)
	}

	return socket

}

func (conn *Connection) ConnectHb(ctx context.Context) zmq4.Socket {
	channel := "hb"
	url := conn.makeURL(channel, conn.HbPort)
	socket := zmq4.NewReq(ctx)
	socket.Dial(url)
	return socket
}
