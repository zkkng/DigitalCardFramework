// Loopback receipt recorder. Provider effects require their own atomic transaction.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/big"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	_ "modernc.org/sqlite"
)

const protocol = "digital-card-action@1"
const plugin = "example.receiver"
const handler = "example.record"
const maxBody = 65536

type boundedListener struct {
	net.Listener
	slots chan struct{}
}
type boundedConnection struct {
	net.Conn
	once    sync.Once
	release func()
}

func (connection *boundedConnection) Close() error {
	err := connection.Conn.Close()
	connection.once.Do(connection.release)
	return err
}
func (listener *boundedListener) Accept() (net.Conn, error) {
	listener.slots <- struct{}{}
	connection, err := listener.Listener.Accept()
	if err != nil {
		<-listener.slots
		return nil, err
	}
	return &boundedConnection{Conn: connection, release: func() { <-listener.slots }}, nil
}

func boundedSetting(name string, fallback, maximum int64) int64 {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 1 || value > maximum {
		panic("Invalid receiver resource setting")
	}
	return value
}
func length(value string) int { return len(utf16.Encode([]rune(value))) }
func unicodeJSON(raw []byte) bool {
	if !utf8.Valid(raw) {
		return false
	}
	for i := 0; i < len(raw); i++ {
		if raw[i] != '\\' {
			continue
		}
		i++
		if i >= len(raw) {
			return false
		}
		if raw[i] != 'u' {
			continue
		}
		if i+4 >= len(raw) {
			return false
		}
		unit, err := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		if err != nil {
			return false
		}
		i += 4
		if unit >= 0xdc00 && unit <= 0xdfff {
			return false
		}
		if unit >= 0xd800 && unit <= 0xdbff {
			if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
				return false
			}
			low, err := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
			if err != nil || low < 0xdc00 || low > 0xdfff {
				return false
			}
			i += 6
		}
	}
	return true
}
func decode(raw []byte) (map[string]any, error) {
	if !unicodeJSON(raw) {
		return nil, fmt.Errorf("invalid Unicode")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var parse func(int) (any, error)
	nodes := 0
	parse = func(depth int) (any, error) {
		nodes++
		if depth > 18 || nodes > 20020 {
			return nil, fmt.Errorf("JSON limit")
		}
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		delimiter, container := token.(json.Delim)
		if !container {
			return token, nil
		}
		if delimiter == '{' {
			value := map[string]any{}
			for decoder.More() {
				keyToken, err := decoder.Token()
				if err != nil {
					return nil, err
				}
				key, ok := keyToken.(string)
				if !ok {
					return nil, fmt.Errorf("invalid key")
				}
				if _, exists := value[key]; exists {
					return nil, fmt.Errorf("duplicate property")
				}
				child, err := parse(depth + 1)
				if err != nil {
					return nil, err
				}
				value[key] = child
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim('}') {
				return nil, fmt.Errorf("invalid object")
			}
			return value, nil
		}
		if delimiter == '[' {
			value := []any{}
			for decoder.More() {
				child, err := parse(depth + 1)
				if err != nil {
					return nil, err
				}
				value = append(value, child)
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim(']') {
				return nil, fmt.Errorf("invalid array")
			}
			return value, nil
		}
		return nil, fmt.Errorf("invalid delimiter")
	}
	parsed, err := parse(0)
	if err != nil {
		return nil, err
	}
	value, ok := parsed.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("object required")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, fmt.Errorf("trailing data")
	}
	return value, nil
}
func boundedJSON(value any, depth int, nodes *int) bool {
	*nodes++
	if depth > 16 || *nodes > 10000 {
		return false
	}
	switch v := value.(type) {
	case nil, bool, string:
		return true
	case json.Number:
		if at := strings.IndexAny(string(v), "eE"); at >= 0 {
			exponent, err := strconv.ParseInt(string(v)[at+1:], 10, 32)
			if err != nil || exponent < -400 || exponent > 400 {
				return false
			}
		}
		number, err := strconv.ParseFloat(string(v), 64)
		return err == nil && !math.IsInf(number, 0) && !math.IsNaN(number)
	case []any:
		for _, child := range v {
			if !boundedJSON(child, depth+1, nodes) {
				return false
			}
		}
		return true
	case map[string]any:
		for key, child := range v {
			if key == "__proto__" || key == "constructor" || key == "prototype" || !boundedJSON(child, depth+1, nodes) {
				return false
			}
		}
		return true
	default:
		return false
	}
}
func valid(value map[string]any) bool {
	fields := []string{"protocol", "pluginId", "handlerId", "jobId", "beneficiaryId", "source", "params"}
	if len(value) != len(fields) {
		return false
	}
	for _, key := range fields {
		if _, ok := value[key]; !ok {
			return false
		}
	}
	job, ok := value["jobId"].(string)
	if !ok || length(job) < 1 || length(job) > 128 || value["protocol"] != protocol || value["pluginId"] != plugin || value["handlerId"] != handler {
		return false
	}
	if value["beneficiaryId"] != nil {
		if _, ok := value["beneficiaryId"].(string); !ok {
			return false
		}
	}
	for _, key := range []string{"source", "params"} {
		child, ok := value[key].(map[string]any)
		if !ok {
			return false
		}
		nodes := 0
		if !boundedJSON(child, 0, &nodes) {
			return false
		}
	}
	return true
}
func equivalent(left, right any) bool {
	switch a := left.(type) {
	case json.Number:
		b, ok := right.(json.Number)
		if !ok {
			return false
		}
		x, ok := new(big.Rat).SetString(string(a))
		if !ok {
			return false
		}
		y, ok := new(big.Rat).SetString(string(b))
		return ok && x.Cmp(y) == 0
	case map[string]any:
		b, ok := right.(map[string]any)
		if !ok || len(a) != len(b) {
			return false
		}
		for key, value := range a {
			other, exists := b[key]
			if !exists || !equivalent(value, other) {
				return false
			}
		}
		return true
	case []any:
		b, ok := right.([]any)
		if !ok || len(a) != len(b) {
			return false
		}
		for i, value := range a {
			if !equivalent(value, b[i]) {
				return false
			}
		}
		return true
	case nil:
		return right == nil
	case string:
		b, ok := right.(string)
		return ok && a == b
	case bool:
		b, ok := right.(bool)
		return ok && a == b
	default:
		return false
	}
}
func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func reject(w http.ResponseWriter, status int, message string) {
	reply(w, status, map[string]string{"error": message})
}
func main() {
	if len(os.Args) < 2 {
		panic("Usage: action-receiver DATABASE [PORT]")
	}
	token := os.Getenv("PLUGIN_TOKEN")
	if len(token) < 16 || len(token) > 4096 || strings.ContainsAny(token, "\r\n") {
		panic("PLUGIN_TOKEN is required")
	}
	port := "0"
	if len(os.Args) > 2 {
		port = os.Args[2]
	}
	maxReceipts := boundedSetting("PLUGIN_MAX_RECEIPTS", 10000, 1000000)
	maxDatabase := boundedSetting("PLUGIN_MAX_DATABASE_BYTES", 64*1024*1024, 1024*1024*1024)
	db, err := sql.Open("sqlite", os.Args[1])
	if err != nil {
		panic("Receiver database unavailable")
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if _, err = db.Exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS deliveries (job_id TEXT PRIMARY KEY, digest TEXT NOT NULL, payload TEXT NOT NULL)"); err != nil {
		panic("Receiver database unavailable")
	}
	var pageSize int64
	if err = db.QueryRow("PRAGMA page_size").Scan(&pageSize); err != nil {
		panic("Receiver database unavailable")
	}
	pages := maxDatabase / pageSize
	if pages < 1 {
		panic("Receiver database limit is too small")
	}
	if _, err = db.Exec(fmt.Sprintf("PRAGMA max_page_count=%d", pages)); err != nil {
		panic("Receiver database limit unavailable")
	}
	slots := make(chan struct{}, 4)
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 10 * time.Second, MaxHeaderBytes: 8192}
	server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/actions" {
			reject(w, 404, "unknown operation")
			return
		}
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			reject(w, 403, "unauthorized")
			return
		}
		if strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])) != "application/json" {
			reject(w, 415, "JSON required")
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			reject(w, 429, "receiver busy")
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
		if err != nil || len(raw) == 0 {
			reject(w, 413, "request too large")
			return
		}
		value, err := decode(raw)
		if err != nil || !valid(value) || r.Header.Get("Idempotency-Key") != value["jobId"] {
			reject(w, 400, "invalid request")
			return
		}
		job := value["jobId"].(string)
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		connection, err := db.Conn(ctx)
		if err != nil {
			reject(w, 503, "receipt storage unavailable")
			return
		}
		defer connection.Close()
		if _, err = connection.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
			reject(w, 503, "receipt storage unavailable")
			return
		}
		committed := false
		defer func() {
			if !committed {
				_, _ = connection.ExecContext(context.Background(), "ROLLBACK")
			}
		}()
		var digest, payload string
		err = connection.QueryRowContext(ctx, "SELECT digest,payload FROM deliveries WHERE job_id=?", job).Scan(&digest, &payload)
		if err == nil {
			stored, parseErr := decode([]byte(payload))
			hash := sha256.Sum256([]byte(payload))
			if parseErr != nil || hex.EncodeToString(hash[:]) != digest || !valid(stored) {
				reject(w, 503, "receipt storage unavailable")
				return
			}
			if !equivalent(stored, value) {
				reject(w, 409, "intent conflict")
				return
			}
		} else if err == sql.ErrNoRows {
			var count int64
			if err = connection.QueryRowContext(ctx, "SELECT count(*) FROM deliveries").Scan(&count); err != nil {
				reject(w, 503, "receipt storage unavailable")
				return
			}
			var currentPages int64
			if err = connection.QueryRowContext(ctx, "PRAGMA page_count").Scan(&currentPages); err != nil {
				reject(w, 503, "receipt storage unavailable")
				return
			}
			if count >= maxReceipts || currentPages*pageSize >= maxDatabase {
				reject(w, 507, "receipt capacity exhausted")
				return
			}
			hash := sha256.Sum256(raw)
			if _, err = connection.ExecContext(ctx, "INSERT INTO deliveries VALUES (?,?,?)", job, hex.EncodeToString(hash[:]), string(raw)); err != nil {
				reject(w, 507, "receipt capacity exhausted")
				return
			}
		} else {
			reject(w, 503, "receipt storage unavailable")
			return
		}
		if _, err = connection.ExecContext(ctx, "COMMIT"); err != nil {
			reject(w, 503, "receipt storage unavailable")
			return
		}
		committed = true
		reply(w, 200, map[string]string{"protocol": protocol, "pluginId": plugin, "jobId": job, "status": "completed"})
	})
	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		panic("Loopback listener unavailable")
	}
	fmt.Println(listener.Addr().(*net.TCPAddr).Port)
	if err = server.Serve(&boundedListener{Listener: listener, slots: make(chan struct{}, 8)}); err != nil && err != http.ErrServerClosed {
		panic("Receiver stopped")
	}
}
