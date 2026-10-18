// Emit a portable application shell with the standard library only.
package main

import (
	"encoding/json"
	"fmt"
	"os"
)

type object = map[string]any

func region(name string) object                  { return object{"type": "region", "name": name} }
func box(kind string, children ...object) object { return object{"type": kind, "children": children} }
func main() {
	if len(os.Args) != 2 || (os.Args[1] != "rail" && os.Args[1] != "header") {
		fmt.Fprintln(os.Stderr, "Usage: generate.go rail|header")
		os.Exit(2)
	}
	navigation := region("navigation")
	navigation["groups"] = []object{
		{"label": "Collection", "entries": []object{{"section": "packs"}, {"section": "collection"}}},
		{"label": "Wallet and shops", "entries": []object{{"section": "wallet"}, {"section": "marketplace"}, {"section": "shop"}}},
	}
	var tree object
	if os.Args[1] == "rail" {
		navigation["arrangement"] = "vertical"
		sidebar := box("column", object{"type": "heading", "level": 2, "text": "Your cards"}, navigation, region("balances"))
		sidebar["layout"] = object{"gap": 12, "padding": 16, "background": "panel"}
		workspace := box("column", region("statistics"), region("account"), object{"type": "text", "text": "Pending results stay available while you explore."}, region("recovery"), region("status"), box("column", region("content")))
		workspace["layout"] = object{"grow": 1, "gap": 12}
		row := box("row", sidebar, workspace)
		row["layout"] = object{"gap": 24}
		row["narrow"] = object{"flow": "column", "gap": 8}
		tree = box("column", row, region("overlays"))
	} else {
		navigation["arrangement"] = "horizontal"
		heading := box("row", object{"type": "heading", "text": "Card journeys"}, region("account"))
		heading["layout"] = object{"justify": "space-between", "gap": 16}
		heading["narrow"] = object{"flow": "column"}
		information := box("grid", region("balances"), object{"type": "text", "text": "Choose an activity below; every purchase still needs your review."}, region("statistics"))
		information["layout"] = object{"columns": 3, "gap": 16}
		information["narrow"] = object{"columns": 1}
		content := box("column", region("status"), region("recovery"), region("content"))
		content["layout"] = object{"padding": 12, "gap": 12}
		tree = box("column", heading, information, content, navigation, region("overlays"))
		tree["layout"] = object{"gap": 16}
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(object{"profile": "dc.application-shell@1", "tree": tree}); err != nil {
		panic(err)
	}
}
