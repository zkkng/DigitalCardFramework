"""Standard-library transport example for the authenticated readonly plugin protocol."""
import json
import os
import re
import sys
import uuid
from urllib.error import HTTPError, URLError
from datetime import datetime
from urllib.parse import urlsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener

PROTOCOL = "digital-card-plugin@1"
COMMANDS = {"inventory.read", "catalog.read"}
TOKEN = re.compile(r"[A-Za-z0-9_-]{43}\Z")

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args):
        return None

class PluginError(Exception):
    def __init__(self, code, status):
        super().__init__(code)
        self.code, self.status = code, status

class PluginClient:
    def __init__(self, url, plugin_id, version, credential, delegation, timeout=10):
        endpoint = urlsplit(url)
        if (endpoint.username or endpoint.password or endpoint.query or endpoint.fragment or
            endpoint.path not in {"", "/"} or not
            (endpoint.scheme == "https" or endpoint.scheme == "http" and endpoint.hostname in {"localhost", "127.0.0.1", "::1"})):
            raise PluginError("PLUGIN_CONFIG", 400)
        if not 16 <= len(credential) <= 4096 or "\r" in credential or "\n" in credential or not TOKEN.fullmatch(delegation):
            raise PluginError("PLUGIN_CONFIG", 400)
        self.url, self.plugin_id, self.version = url.rstrip("/"), plugin_id, version
        self.credential, self.delegation, self.timeout = credential, delegation, timeout
        self.opener, self.session = build_opener(NoRedirect()), None

    def _post(self, path, value, delegated=False):
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
        if len(body) > 65536:
            raise PluginError("PLUGIN_LIMIT", 413)
        headers = {"Content-Type": "application/json", "Authorization": "Bearer " + self.credential}
        if delegated:
            headers["X-DC-Delegation"] = self.delegation
        request = Request(self.url + path, data=body, headers=headers, method="POST")
        try:
            response = self.opener.open(request, timeout=self.timeout)
        except HTTPError as error:
            response = error
        except (URLError, OSError, ValueError):
            raise PluginError("PLUGIN_UNAVAILABLE", 503) from None
        with response:
            if response.headers.get_content_type() != "application/json":
                raise PluginError("PLUGIN_CONTRACT", 502)
            raw = response.read(1048577)
            if len(raw) > 1048576:
                raise PluginError("PLUGIN_LIMIT", 502)
            try:
                result = json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeError, RecursionError):
                raise PluginError("PLUGIN_CONTRACT", 502) from None
            if not isinstance(result, dict) or result.get("protocol") != PROTOCOL:
                raise PluginError("PLUGIN_CONTRACT", 502)
            if response.status != 200:
                error = result.get("error", {})
                code = error.get("code") if isinstance(error, dict) else None
                if not isinstance(code, str) or not re.fullmatch(r"[A-Z0-9_]{1,64}", code):
                    code = "PLUGIN_CONTRACT"
                raise PluginError(code, response.status)
            return result

    def handshake(self):
        result = self._post("/plugins/handshake", {"protocol": PROTOCOL, "pluginId": self.plugin_id, "version": self.version})
        fields = {"protocol", "pluginId", "version", "sessionId", "expiresAt", "generation", "commands", "quotas"}
        if (set(result) != fields or result["pluginId"] != self.plugin_id or result["version"] != self.version or
            not isinstance(result["sessionId"], str) or not TOKEN.fullmatch(result["sessionId"]) or
            type(result["generation"]) is not int or result["generation"] < 1 or not isinstance(result["commands"], list) or
            not all(command in COMMANDS for command in result["commands"]) or len(set(result["commands"])) != len(result["commands"])):
            raise PluginError("PLUGIN_CONTRACT", 502)
        try:
            datetime.fromisoformat(result["expiresAt"].replace("Z", "+00:00"))
            quotas = result["quotas"]
            bounds = {"maxRequestBytes":1048576, "maxResponseBytes":33554432, "concurrency":32, "timeoutMs":300000}
            if set(quotas) != set(bounds) or any(type(quotas[key]) is not int or not 1 <= quotas[key] <= maximum for key, maximum in bounds.items()):
                raise ValueError()
        except (AttributeError, TypeError, ValueError):
            raise PluginError("PLUGIN_CONTRACT", 502) from None
        self.session = result
        return result

    def command(self, command, input=None):
        if not self.session or command not in self.session["commands"]:
            raise PluginError("PLUGIN_GRANT", 403)
        input = input if input is not None else {}
        if not isinstance(input, dict) or (command == "catalog.read" and input) or (command == "inventory.read" and
            (set(input) - {"limit", "after"} or "limit" in input and (type(input["limit"]) is not int or not 1 <= input["limit"] <= 200) or
             "after" in input and (not isinstance(input["after"], str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", input["after"])) )):
            raise PluginError("PLUGIN_CONTRACT", 400)
        request_id = str(uuid.uuid4())
        result = self._post("/plugins/commands", {"protocol": PROTOCOL, "sessionId": self.session["sessionId"], "requestId": request_id, "command": command, "input": input}, delegated=True)
        if set(result) != {"protocol", "requestId", "command", "result"} or result["requestId"] != request_id or result["command"] != command or not isinstance(result["result"], dict):
            raise PluginError("PLUGIN_CONTRACT", 502)
        return result["result"]

    def close(self):
        if self.session:
            session_id = self.session["sessionId"]
            result = self._post("/plugins/sessions/close", {"protocol": PROTOCOL, "sessionId": session_id})
            if result != {"protocol": PROTOCOL, "sessionId": session_id, "status": "closed"}:
                raise PluginError("PLUGIN_CONTRACT", 502)
            self.session = None

if __name__ == "__main__":
    try:
        client = PluginClient(os.environ["PLUGIN_CONTROL_URL"], os.environ.get("PLUGIN_ID", "example.reader"),
                              os.environ.get("PLUGIN_VERSION", "1.0.0"), os.environ["PLUGIN_TOKEN"], os.environ["PLUGIN_DELEGATION"])
        client.handshake()
        result = client.command("catalog.read" if "--catalog" in sys.argv else "inventory.read", {} if "--catalog" in sys.argv else {"limit": 1})
        client.close()
        print(json.dumps(result, ensure_ascii=False))
    except PluginError as error:
        print(error.code + " HTTP " + str(error.status), file=sys.stderr)
        sys.exit(1)
    except KeyError:
        print("PLUGIN_CONFIG HTTP 400", file=sys.stderr)
        sys.exit(1)
