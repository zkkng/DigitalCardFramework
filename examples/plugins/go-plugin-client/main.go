// A bounded standard-library transport example for scoped plugin commands.
package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

const protocol = "digital-card-plugin@1"

var tokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var commands = map[string]bool{"inventory.read": true, "catalog.read": true, "purchase.quote": true, "purchase.register": true, "purchase.pending": true, "purchase.execute": true, "purchase.acknowledge": true}

type transport struct {
	url, credential, delegation string
	client                      *http.Client
}

func (t transport) post(path string, input any, delegated bool) (map[string]json.RawMessage, error) {
	body, err := json.Marshal(input)
	if err != nil || len(body) > 65536 {
		return nil, fmt.Errorf("PLUGIN_CONTRACT")
	}
	req, err := http.NewRequest(http.MethodPost, t.url+path, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("PLUGIN_CONFIG")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+t.credential)
	if delegated {
		req.Header.Set("X-DC-Delegation", t.delegation)
	}
	res, err := t.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("PLUGIN_UNAVAILABLE")
	}
	defer res.Body.Close()
	if strings.Split(res.Header.Get("Content-Type"), ";")[0] != "application/json" {
		return nil, fmt.Errorf("PLUGIN_CONTRACT")
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1048577))
	if err != nil || len(raw) > 1048576 {
		return nil, fmt.Errorf("PLUGIN_CONTRACT")
	}
	var output map[string]json.RawMessage
	if json.Unmarshal(raw, &output) != nil || stringField(output, "protocol") != protocol {
		return nil, fmt.Errorf("PLUGIN_CONTRACT")
	}
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("PLUGIN_REQUEST HTTP %d", res.StatusCode)
	}
	return output, nil
}
func stringField(value map[string]json.RawMessage, key string) string {
	var result string
	_ = json.Unmarshal(value[key], &result)
	return result
}
func run() error {
	base, credential, delegation := os.Getenv("PLUGIN_CONTROL_URL"), os.Getenv("PLUGIN_TOKEN"), os.Getenv("PLUGIN_DELEGATION")
	u, err := url.Parse(base)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || !(u.Scheme == "https" || u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1")) || len(credential) < 16 || len(credential) > 4096 || strings.ContainsAny(credential, "\r\n") || !tokenPattern.MatchString(delegation) {
		return fmt.Errorf("PLUGIN_CONFIG")
	}
	t := transport{strings.TrimRight(base, "/"), credential, delegation, &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	id, version := os.Getenv("PLUGIN_ID"), os.Getenv("PLUGIN_VERSION")
	if id == "" {
		id = "example.reader"
	}
	if version == "" {
		version = "1.0.0"
	}
	ready, err := t.post("/plugins/handshake", map[string]any{"protocol": protocol, "pluginId": id, "version": version}, false)
	if err != nil {
		return err
	}
	session := stringField(ready, "sessionId")
	var grants []string
	var generation int64
	var quotas map[string]int64
	defer func() {
		if tokenPattern.MatchString(session) {
			_, _ = t.post("/plugins/sessions/close", map[string]any{"protocol": protocol, "sessionId": session}, false)
		}
	}()
	if len(ready) != 8 || stringField(ready, "pluginId") != id || stringField(ready, "version") != version || !tokenPattern.MatchString(session) || json.Unmarshal(ready["generation"], &generation) != nil || generation < 1 || json.Unmarshal(ready["commands"], &grants) != nil || json.Unmarshal(ready["quotas"], &quotas) != nil {
		return fmt.Errorf("PLUGIN_CONTRACT")
	}
	if _, err = time.Parse(time.RFC3339Nano, stringField(ready, "expiresAt")); err != nil {
		return fmt.Errorf("PLUGIN_CONTRACT")
	}
	bounds := map[string]int64{"maxRequestBytes": 1048576, "maxResponseBytes": 33554432, "concurrency": 32, "timeoutMs": 300000}
	if len(quotas) != len(bounds) {
		return fmt.Errorf("PLUGIN_CONTRACT")
	}
	for key, max := range bounds {
		if quotas[key] < 1 || quotas[key] > max {
			return fmt.Errorf("PLUGIN_CONTRACT")
		}
	}
	seen := map[string]bool{}
	for _, grant := range grants {
		if !commands[grant] || seen[grant] {
			return fmt.Errorf("PLUGIN_CONTRACT")
		}
		seen[grant] = true
	}
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 65537))
	if err != nil || len(raw) > 65536 {
		return fmt.Errorf("PLUGIN_LIMIT")
	}
	var input map[string]json.RawMessage
	if json.Unmarshal(raw, &input) != nil || len(input) != 2 {
		return fmt.Errorf("PLUGIN_CONTRACT")
	}
	command := stringField(input, "command")
	if !seen[command] {
		return fmt.Errorf("PLUGIN_GRANT")
	}
	var object map[string]json.RawMessage
	if json.Unmarshal(input["input"], &object) != nil || object == nil {
		return fmt.Errorf("PLUGIN_CONTRACT")
	}
	identity := make([]byte, 16)
	if _, err = rand.Read(identity); err != nil {
		return fmt.Errorf("PLUGIN_UNAVAILABLE")
	}
	requestID := hex.EncodeToString(identity)
	result, err := t.post("/plugins/commands", map[string]any{"protocol": protocol, "sessionId": session, "requestId": requestID, "command": command, "input": input["input"]}, true)
	if err != nil {
		return err
	}
	if len(result) != 4 || stringField(result, "requestId") != requestID || stringField(result, "command") != command || json.Unmarshal(result["result"], &object) != nil || object == nil {
		return fmt.Errorf("PLUGIN_CONTRACT")
	}
	closed, err := t.post("/plugins/sessions/close", map[string]any{"protocol": protocol, "sessionId": session}, false)
	if err != nil {
		return err
	}
	if len(closed) != 3 || stringField(closed, "sessionId") != session || stringField(closed, "status") != "closed" {
		return fmt.Errorf("PLUGIN_CONTRACT")
	}
	_, err = fmt.Fprintln(os.Stdout, string(result["result"]))
	return err
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
