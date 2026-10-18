"""Emit one complete portable application shell as UTF-8 JSON."""
import json
import sys


def region(name, **options):
    return {"type": "region", "name": name, **options}


def container(kind, children, **options):
    return {"type": kind, "children": children, **options}


groups = [
    {"label": "Explore", "entries": [{"section": "collection"}, {"section": "shop"}]},
    {"label": "Trades and marketplace", "entries": [{"section": "marketplace"}, {"section": "trades"}]},
]
rail = container("column", [
    {"type": "heading", "text": "Collection workspace"},
    container("row", [
        container("column", [region("account"), region("navigation", arrangement="vertical", groups=groups),
                             {"type": "text", "text": "Browse your cards, shop or review trades."}],
                  layout={"gap": 16, "padding": 12, "background": "panel"}),
        container("column", [region("balances"), region("status"), region("recovery"),
                             container("column", [region("content")], layout={"padding": 8}), region("statistics")],
                  layout={"grow": 1, "gap": 12}),
    ], layout={"gap": 24}, narrow={"flow": "column", "gap": 12}),
    region("overlays"),
], layout={"gap": 12})
header = container("column", [
    container("grid", [region("statistics"), region("account"), region("balances")],
              layout={"columns": 3, "gap": 12}, narrow={"columns": 1}),
    {"type": "heading", "text": "Your cards, your next discovery"},
    {"type": "text", "text": "Review balances and pending changes before choosing your next activity."},
    region("status"), region("recovery"),
    container("column", [region("content")], layout={"padding": 16, "gap": 8}),
    region("navigation", arrangement="horizontal", groups=list(reversed(groups))),
    region("overlays"),
], layout={"gap": 16})
if len(sys.argv) != 2 or sys.argv[1] not in ("rail", "header"):
    raise SystemExit("Usage: generate.py rail|header")
sys.stdout.buffer.write((json.dumps({"profile": "dc.application-shell@1", "tree": {"rail": rail, "header": header}[sys.argv[1]]},
                                  ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
