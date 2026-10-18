// Print an installable Studio panel manifest using the Go standard library.
// Run: go run main.go > print-layout.json
// Install the resulting JSON through Studio's panel import control.
package main

import (
	"encoding/json"
	"os"
)

type control struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Field   string `json:"field"`
	Minimum int    `json:"minimum"`
	Maximum int    `json:"maximum"`
	Step    int    `json:"step"`
}

type contribution struct {
	Protocol string    `json:"protocol"`
	ID       string    `json:"id"`
	Version  string    `json:"version"`
	Title    string    `json:"title"`
	Controls []control `json:"controls"`
}

func main() {
	manifest := contribution{
		Protocol: "digital-card-editor-contribution@1",
		ID:       "example.print-layout",
		Version:  "1.0.0",
		Title:    "Layer position and rotation",
		Controls: []control{
			{"position-x", "Horizontal position", "x", -1000, 1000, 1},
			{"position-y", "Vertical position", "y", -1000, 1000, 1},
			{"rotation", "Rotation", "rotation", -180, 180, 1},
		},
	}
	if err := json.NewEncoder(os.Stdout).Encode(manifest); err != nil {
		os.Exit(1)
	}
}
