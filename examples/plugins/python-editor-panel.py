"""Print an installable Studio panel manifest using the Python standard library.

Run: python python-editor-panel.py > print-layout.json
Install the resulting JSON through Studio's panel import control.
"""
import json
import sys


def main():
    manifest = {
        "protocol": "digital-card-editor-contribution@1",
        "id": "example.print-layout",
        "version": "1.0.0",
        "title": "Layer position and rotation",
        "controls": [
            {"id": "position-x", "label": "Horizontal position", "field": "x",
             "minimum": -1000, "maximum": 1000, "step": 1},
            {"id": "position-y", "label": "Vertical position", "field": "y",
             "minimum": -1000, "maximum": 1000, "step": 1},
            {"id": "rotation", "label": "Rotation", "field": "rotation",
             "minimum": -180, "maximum": 180, "step": 1},
        ],
    }
    sys.stdout.write(json.dumps(manifest, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
