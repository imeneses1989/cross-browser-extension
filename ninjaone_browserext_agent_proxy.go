/*
* https://github.com/jfarleyx/chrome-native-messaging-golang
* @Author: J. Farley
* @Date: 2019-05-19
* @Description: Basic chrome native messaging host example.
 */
package main

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"log"
	"os"
	"syscall"
	"unsafe"
)

const _pipeName = "/tmp/chrome-native-host"

// constants for Logger
var (
	// Trace logs general information messages.
	Trace *log.Logger
	// Error logs error messages.
	Error *log.Logger
)

// nativeEndian used to detect native byte order
var nativeEndian binary.ByteOrder

// bufferSize used to set size of IO buffer - adjust to accommodate message payloads
var bufferSize = 8192

// IncomingMessage represents a message sent to the native host.
type IncomingMessage struct {
	Query string `json:"query"`
}

// OutgoingMessage respresents a response to an incoming message query.
type OutgoingMessage struct {
	Query    string `json:"query"`
	Response string `json:"response"`
}

// Init initializes logger and determines native byte order.
func Init(traceHandle io.Writer, errorHandle io.Writer) {
	Trace = log.New(traceHandle, "TRACE: ", log.Ldate|log.Ltime|log.Lshortfile)
	Error = log.New(errorHandle, "ERROR: ", log.Ldate|log.Ltime|log.Lshortfile)

	// determine native byte order so that we can read message size correctly
	var one int16 = 1
	b := (*byte)(unsafe.Pointer(&one))
	if *b == 0 {
		nativeEndian = binary.BigEndian
	} else {
		nativeEndian = binary.LittleEndian
	}
}

func main() {
	file, err := os.OpenFile("chrome-native-host-log.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		Init(os.Stdout, os.Stderr)
		Error.Printf("Unable to create and/or open log file. Will log to Stdout and Stderr. Error: %v", err)
	} else {
		Init(file, file)
		// ensure we close the log file when we're done
		defer file.Close()
	}

	defer file.Close()

	// initializeLogFile()
	initializeNamedPipe(_pipeName)

	Trace.Printf("Chrome native messaging host started. Native byte order: %v.", nativeEndian)

	readFromStdInDone := make(chan bool)
	waitForDataFromPipeDone := make(chan bool)

	go readFromStdIn(readFromStdInDone)
	go waitForDataFromPipe(_pipeName, waitForDataFromPipeDone)

	// Wait for one of the coroutines to finish
	select {
	case <-readFromStdInDone:
		Trace.Printf("readFromStdIn finished first, exiting")
	case <-waitForDataFromPipeDone:
		Trace.Printf("waitForDataFromPipe finished first, exiting")
	}

	Trace.Print("Chrome native messaging is exiting")
}

func initializeNamedPipe(pipeName string) {
	// Create a named pipe (FIFO) if it doesn't exist already
	if _, err := os.Stat(pipeName); os.IsNotExist(err) {
		err := os.MkdirAll("/tmp", 0755) // Ensure the /tmp directory exists
		if err != nil {
			Trace.Printf("Error creating directory:", err)
			return
		}

		err = os.Remove(pipeName) // Ensure no stale pipe exists
		if err != nil && !os.IsNotExist(err) {
			Trace.Printf("Error removing old pipe:", err)
			return
		}

		err = syscall.Mkfifo(pipeName, 0666)
		if err != nil {
			Trace.Printf("Error creating named pipe:", err)
			return
		}
		Trace.Printf("Named pipe created at", pipeName)
	}
}

func waitForDataFromPipe(pipeName string, done chan bool) {
	for {
		file, err := os.OpenFile(pipeName, os.O_RDONLY, os.ModeNamedPipe)
		if err != nil {
			Trace.Printf("Error opening named pipe: %s", err.Error())
			return
		}
		defer file.Close()

		reader := bufio.NewReader(file)
		for {
			Trace.Println("Waiting for data on the named pipe...")
			line, err := reader.ReadString('\n')
			if err != nil {
				Trace.Println(err.Error())
				if err == io.EOF {
					Trace.Println("EOF encountered, reopening pipe...")
					file.Close()
					break // Break the inner loop and reopen the pipe
				}
			}
			Trace.Printf("Received: %s", line)
			send(OutgoingMessage{Query: "hello", Response: line})
		}
	}

	done <- true
}

// readFromStdIn Creates a new buffered I/O reader and reads messages from Stdin.
func readFromStdIn(done chan bool) {
	v := bufio.NewReader(os.Stdin)
	// adjust buffer size to accommodate your json payload size limits; default is 4096
	s := bufio.NewReaderSize(v, bufferSize)
	Trace.Printf("IO buffer reader created with buffer size of %v.", s.Size())

	lengthBytes := make([]byte, 4)
	lengthNum := int(0)

	// we're going to indefinitely read the first 4 bytes in buffer, which gives us the message length.
	// if stdIn is closed we'll exit the loop and shut down host
	for b, err := s.Read(lengthBytes); b > 0 && err == nil; b, err = s.Read(lengthBytes) {
		// convert message length bytes to integer value
		lengthNum = readMessageLength(lengthBytes)
		Trace.Printf("Message size in bytes: %v", lengthNum)

		// If message length exceeds size of buffer, the message will be truncated.
		// This will likely cause an error when we attempt to unmarshal message to JSON.
		if lengthNum > bufferSize {
			Error.Printf("Message size of %d exceeds buffer size of %d. Message will be truncated and is unlikely to unmarshal to JSON.", lengthNum, bufferSize)
		}

		// read the content of the message from buffer
		content := make([]byte, lengthNum)
		_, err := s.Read(content)
		if err != nil && err != io.EOF {
			Error.Fatal(err)
		}

		// message has been read, now parse and process
		parseMessage(content)
	}

	Trace.Print("Stdin closed.")
	done <- true
}

// readMessageLength reads and returns the message length value in native byte order.
func readMessageLength(msg []byte) int {
	var length uint32
	buf := bytes.NewBuffer(msg)
	err := binary.Read(buf, nativeEndian, &length)
	if err != nil {
		Error.Printf("Unable to read bytes representing message length: %v", err)
	}
	return int(length)
}

// parseMessage parses incoming message
func parseMessage(msg []byte) {
	iMsg := decodeMessage(msg)
	Trace.Printf("Message received: %s", msg)

	// start building outgoing json message
	oMsg := OutgoingMessage{
		Query:    iMsg.Query,
		Response: "This is the service host responding to your message of:" + iMsg.Query,
	}

	send(oMsg)
}

// decodeMessage unmarshals incoming json request and returns query value.
func decodeMessage(msg []byte) IncomingMessage {
	var iMsg IncomingMessage
	err := json.Unmarshal(msg, &iMsg)
	if err != nil {
		Error.Printf("Unable to unmarshal json to struct: %v", err)
	}
	return iMsg
}

// send sends an OutgoingMessage to os.Stdout.
func send(msg OutgoingMessage) {
	byteMsg := dataToBytes(msg)
	writeMessageLength(byteMsg)

	var msgBuf bytes.Buffer
	_, err := msgBuf.Write(byteMsg)
	if err != nil {
		Error.Printf("Unable to write message length to message buffer: %v", err)
	}

	_, err = msgBuf.WriteTo(os.Stdout)
	if err != nil {
		Error.Printf("Unable to write message buffer to Stdout: %v", err)
	}
}

// dataToBytes marshals OutgoingMessage struct to slice of bytes
func dataToBytes(msg OutgoingMessage) []byte {
	byteMsg, err := json.Marshal(msg)
	if err != nil {
		Error.Printf("Unable to marshal OutgoingMessage struct to slice of bytes: %v", err)
	}
	return byteMsg
}

// writeMessageLength determines length of message and writes it to os.Stdout.
func writeMessageLength(msg []byte) {
	err := binary.Write(os.Stdout, nativeEndian, uint32(len(msg)))
	if err != nil {
		Error.Printf("Unable to write message length to Stdout: %v", err)
	}
}
