"""Emit a portable administrator policy document; no server or SDK required."""
import json

policy = {
    "schemaVersion": 1,
    "id": "museum.postcards",
    "revision": 1,
    "name": "Museum postcards",
    "fields": [{
        "key": "museum.year",
        "label": "Year acquired",
        "type": "integer",
        "required": True,
        "minimum": 1800,
        "maximum": 2200,
    }],
    "defaults": {"stats": {"museum.year": 2026}},
    "requirements": {},
}
print(json.dumps(policy, ensure_ascii=False, indent=2))
