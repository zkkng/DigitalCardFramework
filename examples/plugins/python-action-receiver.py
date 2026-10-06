"""Loopback action receiver with durable, atomic deduplication; Python standard library only."""
import hashlib
import hmac
import json
import math
import os
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from contextlib import contextmanager
from decimal import Decimal

TOKEN = os.environ["PLUGIN_TOKEN"]
DATABASE = sys.argv[1]
PLUGIN = "example.receiver"
HANDLER = "example.record"
PROTOCOL = "digital-card-action@1"
def setting(name, fallback, maximum):
    value = int(os.environ.get(name, fallback))
    if not 1 <= value <= maximum:
        raise ValueError("Invalid receiver resource setting")
    return value
MAX_RECEIPTS = setting("PLUGIN_MAX_RECEIPTS", 10000, 1000000)
MAX_DATABASE = setting("PLUGIN_MAX_DATABASE_BYTES", 64 * 1024 * 1024, 1024 * 1024 * 1024)
if not 16 <= len(TOKEN) <= 4096 or "\r" in TOKEN or "\n" in TOKEN:
    raise ValueError("PLUGIN_TOKEN is required")
@contextmanager
def database():
    db = sqlite3.connect(DATABASE, timeout=5)
    size = db.execute("PRAGMA page_size").fetchone()[0]
    if MAX_DATABASE < size:
        raise ValueError("Receiver database limit is too small")
    db.execute("PRAGMA synchronous=FULL")
    db.execute("PRAGMA max_page_count=" + str(MAX_DATABASE // size))
    try:
        with db:
            yield db
    finally:
        db.close()
def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("Duplicate JSON property")
        result[key] = value
    return result
def parse(raw):
    return json.loads(raw, object_pairs_hook=pairs, parse_int=Decimal, parse_float=Decimal,
                      parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))
def equivalent(left, right):
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(equivalent(left[key], right[key]) for key in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(equivalent(a, b) for a, b in zip(left, right))
    return left == right
def bounded(value, depth=0, count=None):
    count = count if count is not None else [0]
    count[0] += 1
    if depth > 16 or count[0] > 10000:
        raise ValueError()
    if isinstance(value, str):
        value.encode("utf-8")
    elif isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
        if not math.isfinite(value):
            raise ValueError()
        if isinstance(value, Decimal) and not -400 <= value.as_tuple().exponent <= 400:
            raise ValueError()
    elif isinstance(value, list):
        for child in value:
            bounded(child, depth + 1, count)
    elif isinstance(value, dict):
        for key, child in value.items():
            key.encode("utf-8")
            if key in {"__proto__", "constructor", "prototype"}:
                raise ValueError()
            bounded(child, depth + 1, count)
def valid(payload):
    fields = {"protocol", "pluginId", "handlerId", "jobId", "beneficiaryId", "source", "params"}
    if not isinstance(payload, dict) or set(payload) != fields:
        raise ValueError()
    job = payload["jobId"]
    if (payload["protocol"] != PROTOCOL or payload["pluginId"] != PLUGIN or payload["handlerId"] != HANDLER or
        not isinstance(job, str) or not 0 < len(job.encode("utf-16-le")) // 2 <= 128 or
        (payload["beneficiaryId"] is not None and not isinstance(payload["beneficiaryId"], str))):
        raise ValueError()
    if payload["beneficiaryId"] is not None:
        payload["beneficiaryId"].encode("utf-8")
    for key in ("source", "params"):
        if not isinstance(payload[key], dict):
            raise ValueError()
        bounded(payload[key])
    return job
with database() as db:
    db.execute("CREATE TABLE IF NOT EXISTS deliveries (job_id TEXT PRIMARY KEY, digest TEXT NOT NULL, payload TEXT NOT NULL)")

class Receiver(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

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
        if not hmac.compare_digest(self.headers.get("Authorization", "").encode(), ("Bearer " + TOKEN).encode()):
            return self.reply(403, {"error": "unauthorized"})
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            return self.reply(415, {"error": "JSON required"})
        self.connection.settimeout(10)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 65536:
                return self.reply(413, {"error": "request too large"})
            raw = self.rfile.read(size)
            text = raw.decode("utf-8")
            payload = parse(text)
            job = valid(payload)
            if self.headers.get("Idempotency-Key") != job:
                raise ValueError()
            canonical = text
            digest = hashlib.sha256(canonical.encode()).hexdigest()
            with database() as db:
                db.execute("BEGIN IMMEDIATE")
                old = db.execute("SELECT digest,payload FROM deliveries WHERE job_id=?", (job,)).fetchone()
                if old:
                    if hashlib.sha256(old[1].encode()).hexdigest() != old[0]:
                        return self.reply(503, {"error": "receipt storage unavailable"})
                    try:
                        previous = parse(old[1])
                        valid(previous)
                    except (ValueError, TypeError, UnicodeError):
                        return self.reply(503, {"error": "receipt storage unavailable"})
                    if not equivalent(previous, payload):
                        return self.reply(409, {"error": "intent conflict"})
                else:
                    page_size = db.execute("PRAGMA page_size").fetchone()[0]
                    page_count = db.execute("PRAGMA page_count").fetchone()[0]
                    if (db.execute("SELECT count(*) FROM deliveries").fetchone()[0] >= MAX_RECEIPTS or
                        page_size * page_count >= MAX_DATABASE):
                        return self.reply(507, {"error": "receipt capacity exhausted"})
                db.execute("INSERT OR IGNORE INTO deliveries VALUES (?, ?, ?)", (job, digest, canonical))
            return self.reply(200, {"protocol": PROTOCOL, "pluginId": PLUGIN, "jobId": job, "status": "completed"})
        except sqlite3.Error as error:
            status = 507 if "full" in str(error).lower() else 503
            return self.reply(status, {"error": "receipt storage unavailable"})
        except (ValueError, TypeError, KeyError, OverflowError, RecursionError, UnicodeError, json.JSONDecodeError):
            return self.reply(400, {"error": "invalid request"})

server = HTTPServer(("127.0.0.1", int(sys.argv[2]) if len(sys.argv) > 2 else 0), Receiver)
server.timeout = 10
print(server.server_address[1], flush=True)
server.serve_forever()
