"""Loopback action receiver with durable, atomic deduplication; Python standard library only."""
import hashlib
import hmac
import json
import os
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

TOKEN = os.environ["PLUGIN_TOKEN"]
DATABASE = sys.argv[1]
PLUGIN = "example.receiver"
HANDLER = "example.record"
PROTOCOL = "digital-card-action@1"
with sqlite3.connect(DATABASE) as db:
    db.execute("CREATE TABLE IF NOT EXISTS deliveries (job_id TEXT PRIMARY KEY, digest TEXT NOT NULL, payload TEXT NOT NULL)")

class Receiver(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def reply(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/actions":
            return self.reply(404, {"error": "unknown operation"})
        if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + TOKEN):
            return self.reply(403, {"error": "unauthorized"})
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            return self.reply(415, {"error": "JSON required"})
        self.connection.settimeout(10)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 65536:
                return self.reply(413, {"error": "request too large"})
            raw = self.rfile.read(size)
            payload = json.loads(raw)
            fields = {"protocol", "pluginId", "handlerId", "jobId", "beneficiaryId", "source", "params"}
            if not isinstance(payload, dict) or set(payload) != fields:
                raise ValueError()
            job = payload["jobId"]
            if (payload["protocol"] != PROTOCOL or payload["pluginId"] != PLUGIN or
                payload["handlerId"] != HANDLER or not isinstance(job, str) or not 0 < len(job) <= 128 or
                self.headers.get("Idempotency-Key") != job or
                not isinstance(payload["source"], dict) or not isinstance(payload["params"], dict) or
                (payload["beneficiaryId"] is not None and not isinstance(payload["beneficiaryId"], str))):
                raise ValueError()
            canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
            digest = hashlib.sha256(canonical.encode()).hexdigest()
            with sqlite3.connect(DATABASE) as db:
                db.execute("BEGIN IMMEDIATE")
                old = db.execute("SELECT digest FROM deliveries WHERE job_id=?", (job,)).fetchone()
                if old and old[0] != digest:
                    return self.reply(409, {"error": "intent conflict"})
                db.execute("INSERT OR IGNORE INTO deliveries VALUES (?, ?, ?)", (job, digest, canonical))
            return self.reply(200, {"protocol": PROTOCOL, "pluginId": PLUGIN, "jobId": job, "status": "completed"})
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            return self.reply(400, {"error": "invalid request"})

server = HTTPServer(("127.0.0.1", int(sys.argv[2]) if len(sys.argv) > 2 else 0), Receiver)
server.timeout = 10
print(server.server_address[1], flush=True)
server.serve_forever()
