// Export a selected-layer panel using only the Go standard library.
// Run: go run main.go OUTPUT_DIR
// The reviewed separate origin supplies the framework bootstrap module.
package main

import (
	"fmt"
	"os"
	"path/filepath"
)

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Selected layer workshop</title>
  <link rel="stylesheet" href="panel.css">
  <script type="module" src="/src/presentation/program-editor-bootstrap.js"></script>
</head>
<body>
  <main aria-labelledby="panel-title">
    <header><span class="eyebrow">LAYER WORKSHOP</span><h1 id="panel-title">Edit the selected layer</h1>
      <p id="panel-help">Select an unlocked layer in Studio. Edit its available properties, then propose changes for review.</p></header>
    <section aria-describedby="panel-help">
      <fieldset><legend>Text</legend>
        <label for="layer-text">Text</label>
        <textarea id="layer-text" data-editor-field="text" rows="3" maxlength="4096" disabled></textarea>
        <div class="grid">
          <label for="layer-color">Text or fill color<input id="layer-color" data-editor-field="color" type="color" value="#304853" disabled></label>
          <label for="type-size">Text size (px)<input id="type-size" data-editor-field="typography.size" type="number" min="1" max="512" step="1" disabled></label>
          <label for="line-height">Line height<input id="line-height" data-editor-field="typography.lineHeight" type="number" min="0.5" max="5" step="any" disabled></label>
          <label for="letter-spacing">Letter spacing (px)<input id="letter-spacing" data-editor-field="typography.letterSpacing" type="number" min="-100" max="100" step="any" disabled></label>
          <label for="type-align">Alignment<select id="type-align" data-editor-field="typography.align" disabled><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
          <label for="layer-opacity">Opacity<input id="layer-opacity" data-editor-field="opacity" type="number" min="0" max="1" step="any" disabled></label>
        </div>
      </fieldset>
      <fieldset><legend>Placement and appearance</legend><div class="grid">
        <label for="layer-x">Horizontal position (px)<input id="layer-x" data-editor-field="x" type="number" min="-1000" max="1000" step="1" disabled></label>
        <label for="layer-y">Vertical position (px)<input id="layer-y" data-editor-field="y" type="number" min="-1000" max="1000" step="1" disabled></label>
        <label for="layer-width">Width (px)<input id="layer-width" data-editor-field="width" type="number" min="1" max="4096" step="1" disabled></label>
        <label for="layer-height">Height (px)<input id="layer-height" data-editor-field="height" type="number" min="1" max="4096" step="1" disabled></label>
        <label for="layer-rotation">Rotation (degrees)<input id="layer-rotation" data-editor-field="rotation" type="number" min="-180" max="180" step="1" disabled></label>
        <label for="layer-brightness">Brightness<input id="layer-brightness" data-editor-field="brightness" type="number" min="0" max="4" step="any" disabled></label>
        <label for="layer-saturation">Saturation<input id="layer-saturation" data-editor-field="saturation" type="number" min="0" max="4" step="any" disabled></label>
        <label for="layer-blend">Blend mode<select id="layer-blend" data-editor-field="blend" disabled><option value="normal">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="add">Add</option></select></label>
      </div></fieldset>
      <button type="button" data-editor-propose disabled>Propose changes</button>
      <p class="review-note">Your proposal appears in Studio. Review and apply it there to update the layer.</p>
    </section>
  </main>
</body>
</html>
`
const css = `:root { color-scheme: light; font-family: system-ui, sans-serif; color: #183640; background: #f0f5f3; }
* { box-sizing: border-box; }
body { margin: 0; }
main { max-width: 680px; margin: auto; padding: 22px; }
header { border-bottom: 1px solid #bdcfca; padding-bottom: 16px; margin-bottom: 18px; }
.eyebrow { color: #3f665e; font-size: 11px; font-weight: 700; letter-spacing: .16em; }
h1 { font: 600 26px Georgia, serif; margin: 8px 0; }
p { font-size: 13px; line-height: 1.6; margin: 6px 0; }
fieldset { border: 1px solid #bdcfca; border-radius: 12px; padding: 16px; margin: 0 0 18px; background: #fff; }
legend { padding: 0 7px; font-weight: 700; font-size: 13px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
label { display: block; font-size: 12px; font-weight: 600; }
input, select, textarea { display: block; width: 100%; min-height: 40px; border: 1px solid #78948c; border-radius: 6px; margin: 6px 0 0; padding: 8px; color: #183640; background: #fff; font: 14px system-ui, sans-serif; }
textarea { resize: vertical; margin-bottom: 14px; }
input[type="color"] { padding: 4px; }
button { min-height: 44px; width: 100%; border: 0; border-radius: 8px; padding: 10px 16px; background: #205448; color: #fff; font: 600 14px system-ui, sans-serif; cursor: pointer; transition: background-color .12s ease; }
button:hover:enabled { background: #153e34; }
input:disabled, select:disabled, textarea:disabled { background: #e9eeec; color: #526961; }
button:disabled { background: #d3ddda; color: #526961; cursor: default; }
:focus-visible { outline: 3px solid #956124; outline-offset: 3px; }
.review-note { text-align: center; color: #3f665e; padding-top: 8px; }
@media (max-width: 360px) { main { padding: 12px; } .grid { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
`

func run() error {
	if len(os.Args) != 2 {
		return fmt.Errorf("Usage: live-editor-panel OUTPUT_DIR")
	}
	if err := os.MkdirAll(os.Args[1], 0755); err != nil {
		return err
	}
	for _, file := range []struct{ name, content string }{{"index.html", html}, {"panel.css", css}} {
		if err := os.WriteFile(filepath.Join(os.Args[1], file.name), []byte(file.content), 0644); err != nil {
			return err
		}
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Live editor panel export failed")
		os.Exit(1)
	}
}
