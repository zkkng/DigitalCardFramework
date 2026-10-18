// Generate a complete marketplace document with the Go standard library.
// Run: go run main.go OUTPUT_DIR
// The reviewed origin serves /program-marketplace-bootstrap.js and its imports.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func label(key string) string { return `<span data-dc-marketplace-label="` + key + `"></span>` }
func request(action, key string) string {
	return `<button type="button" data-dc-marketplace-request="` + action + `" data-dc-marketplace-label="` + key + `" disabled></button>`
}
func paging(key string) string {
	name := map[string]string{"currencies": "Currency choices", "targets": "Stock choices", "shops": "Shops", "listings": "Listings", "orders": "Order history"}[key]
	return `<nav aria-label="` + name + `"><button type="button" data-dc-marketplace-page="` + key + `" data-direction="-1" data-dc-marketplace-label="previous" disabled></button><button type="button" data-dc-marketplace-page="` + key + `" data-direction="1" data-dc-marketplace-label="more" disabled></button></nav>`
}
func field(key, name string, multiline bool) string {
	element := `<input type="text" data-dc-marketplace-field="` + key + `" disabled>`
	if multiline {
		element = `<textarea data-dc-marketplace-field="` + key + `" disabled></textarea>`
	}
	return `<label>` + label(name) + element + `</label>`
}
func options(key, name string) string {
	return `<div class="option-window"><label>` + label(name) + `<select data-dc-marketplace-option="` + key + `" disabled></select></label>` + paging(key) + `</div>`
}
func document() string {
	var out strings.Builder
	out.WriteString(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Market Dispatch</title><link rel="stylesheet" href="marketplace.css"><script type="module" src="/program-marketplace-bootstrap.js"></script></head><body><main><header><h1 data-dc-marketplace-label="title">Market Dispatch</h1><p data-dc-marketplace-label="description"></p><button type="button" data-dc-marketplace-refresh data-dc-marketplace-label="refresh" disabled></button>`)
	out.WriteString(request("recover", "retryPurchase"))
	out.WriteString(`</header><p role="status" aria-live="polite" data-dc-marketplace-status></p><section class="dispatch" data-dc-marketplace-listings></section>` + paging("listings"))
	out.WriteString(`<section class="seller" data-dc-marketplace-seller><h2 data-dc-marketplace-label="createShop"></h2><div class="form-grid">` + field("shopName", "shopName", false) + `<label>` + label("shopType") + `<select data-dc-marketplace-field="shopKind" disabled><option value="player" data-dc-marketplace-label="playerShop"></option><option value="admin" data-dc-marketplace-label="adminShop"></option></select></label></div>` + request("shop", "createShopButton"))
	out.WriteString(`<h2 data-dc-marketplace-label="listStock"></h2><div class="form-grid">` + options("shops", "shop") + field("title", "listingTitle", false) + options("currencies", "currency") + field("amount", "unitPrice", false) + `<label>` + label("stockSource") + `<select data-dc-marketplace-kind disabled></select></label>` + options("targets", "stockItem") + field("quantity", "stockQuantity", false))
	for _, entry := range [][2]string{{"preview", "previewTime"}, {"starts", "releaseTime"}, {"ends", "endTime"}, {"raffle", "raffleJson"}} {
		out.WriteString(field(entry[0], entry[1], entry[0] == "raffle"))
	}
	out.WriteString(`</div><div data-dc-marketplace-target-previews></div><div class="actions">` + request("action", "params") + request("stock", "reviewStock") + `</div><p data-dc-stock-disclosure></p><p data-dc-stock-review></p><p data-dc-stock-attempt></p></section><aside>` + request("settings", "settings") + `</aside><section><h2 data-dc-marketplace-label="history"></h2><div data-dc-marketplace-orders></div>` + paging("orders") + `</section></main>`)
	out.WriteString(`<template data-dc-marketplace-target-template><figure><img data-dc-marketplace-preview alt="" hidden><figcaption data-dc-target-name></figcaption></figure></template><template data-dc-marketplace-listing-template><article class="dispatch-row"><div><img data-dc-marketplace-preview alt="" hidden><h2 data-dc-listing-name></h2><p data-dc-listing-description></p><p data-dc-listing-shop></p><p data-dc-listing-allocation></p></div><div><strong data-dc-listing-price></strong><p data-dc-listing-availability></p><p data-dc-listing-schedule></p><p data-dc-listing-raffleStatus></p></div><div class="actions">`)
	for _, entry := range [][2]string{{"purchase", "reviewPurchase"}, {"cancel", "cancelStock"}, {"status", "checkRaffle"}, {"entry", "enterRaffle"}, {"winner", "reviewWinner"}} {
		out.WriteString(`<button type="button" data-dc-listing-action="` + entry[0] + `" data-dc-marketplace-label="` + entry[1] + `" disabled></button>`)
	}
	out.WriteString(`</div></article></template><template data-dc-marketplace-order-template><article class="order"><span data-dc-order-summary></span><strong data-dc-order-quantity></strong><span data-dc-order-price></span><span data-dc-order-status></span></article></template></body></html>`)
	return out.String()
}

const css = `*{box-sizing:border-box}body{margin:0;background:#f7f4ed;color:#273143;font:16px system-ui,sans-serif}main{max-width:1240px;margin:auto;padding:28px}header{border-top:6px solid #435873;padding:20px 0}h1{font:clamp(30px,5vw,48px) Georgia,serif}.dispatch-row{display:grid;grid-template-columns:1.1fr 1fr 200px;gap:20px;border-bottom:1px solid #a8b0be;padding:24px 0}[data-dc-marketplace-target-previews]{display:flex;gap:12px;overflow:auto}[data-dc-marketplace-target-previews] img{max-width:80px;max-height:100px}[data-dc-marketplace-target-previews] figure{margin:12px 0}.dispatch-row img{max-width:130px;max-height:180px;object-fit:contain}.dispatch-row p,.seller p{line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.seller{padding:24px;border:1px solid #a8b0be;margin:24px 0}.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}label{display:grid;gap:6px}.actions{display:flex;gap:10px;flex-wrap:wrap;align-content:start}button,input,select,textarea{font:inherit;padding:11px;border:1px solid #70819c;border-radius:3px;max-width:100%}button{color:white;background:#435873;cursor:pointer;min-height:44px}button:disabled,input:disabled,select:disabled,textarea:disabled{opacity:.5;cursor:default}nav{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}textarea{min-height:100px}.order{display:flex;gap:18px;padding:14px 0;border-bottom:1px solid #a8b0be}[hidden]{display:none!important}:focus-visible{outline:3px solid #be781b;outline-offset:3px}@media(max-width:650px){main{padding:14px}.dispatch-row,.form-grid{grid-template-columns:1fr}.seller{padding:16px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}`

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "Usage: go run main.go OUTPUT_DIR")
		os.Exit(1)
	}
	if err := os.MkdirAll(os.Args[1], 0700); err != nil {
		panic(err)
	}
	for name, content := range map[string]string{"index.html": document(), "marketplace.css": css} {
		if err := os.WriteFile(filepath.Join(os.Args[1], name), []byte(content), 0600); err != nil {
			panic(err)
		}
	}
}
