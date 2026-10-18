"""Generate a complete marketplace document using the Python standard library.

Run: python python-marketplace-view.py OUTPUT_DIR
Serve /program-marketplace-bootstrap.js and its imports from the reviewed origin.
The parent owns seller drafts, financial commands and explicit native reviews.
"""
from pathlib import Path
import sys


def label(key):
    return '<span data-dc-marketplace-label="' + key + '"></span>'


def request(action, key):
    return '<button type="button" data-dc-marketplace-request="' + action + '" data-dc-marketplace-label="' + key + '" disabled></button>'


def paging(key):
    name = {"currencies": "Currency choices", "targets": "Stock choices", "shops": "Shops", "listings": "Listings", "orders": "Order history"}[key]
    return '<nav aria-label="' + name + '">' + ''.join('<button type="button" data-dc-marketplace-page="' + key + '" data-direction="' + direction + '" data-dc-marketplace-label="' + name + '" disabled></button>' for direction, name in [('-1', 'previous'), ('1', 'more')]) + '</nav>'


def field(key, name, textarea=False):
    element = '<textarea' if textarea else '<input type="text"'
    return '<label>' + label(name) + element + ' data-dc-marketplace-field="' + key + '" disabled>' + ('</textarea>' if textarea else '') + '</label>'


def options(key, name):
    return '<div class="option-window"><label>' + label(name) + '<select data-dc-marketplace-option="' + key + '" disabled></select></label>' + paging(key) + '</div>'


HTML = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Collector Market</title><link rel="stylesheet" href="marketplace.css"><script type="module" src="/program-marketplace-bootstrap.js"></script></head><body><main>
<header><h1 data-dc-marketplace-label="title">Collector Market</h1><p data-dc-marketplace-label="description"></p><button type="button" data-dc-marketplace-refresh data-dc-marketplace-label="refresh" disabled></button>''' + request('recover', 'retryPurchase') + '''</header><p role="status" aria-live="polite" data-dc-marketplace-status></p>
<section class="market-grid" data-dc-marketplace-listings></section>''' + paging('listings') + '''
<section class="seller" data-dc-marketplace-seller><h2 data-dc-marketplace-label="createShop"></h2><div class="form-grid">''' + field('shopName', 'shopName') + '''<label>''' + label('shopType') + '''<select data-dc-marketplace-field="shopKind" disabled><option value="player" data-dc-marketplace-label="playerShop"></option><option value="admin" data-dc-marketplace-label="adminShop"></option></select></label></div>''' + request('shop', 'createShopButton') + '''
<h2 data-dc-marketplace-label="listStock"></h2><div class="form-grid">''' + options('shops', 'shop') + field('title', 'listingTitle') + options('currencies', 'currency') + field('amount', 'unitPrice') + '''<label>''' + label('stockSource') + '''<select data-dc-marketplace-kind disabled></select></label>''' + options('targets', 'stockItem') + field('quantity', 'stockQuantity') + field('preview', 'previewTime') + field('starts', 'releaseTime') + field('ends', 'endTime') + field('raffle', 'raffleJson', True) + '''</div><div data-dc-marketplace-target-previews></div><div class="actions">''' + request('action', 'params') + request('stock', 'reviewStock') + '''</div><p data-dc-stock-disclosure></p><p data-dc-stock-review></p><p data-dc-stock-attempt></p></section>
<aside>''' + request('settings', 'settings') + '''</aside><section><h2 data-dc-marketplace-label="history"></h2><div data-dc-marketplace-orders></div>''' + paging('orders') + '''</section></main><template data-dc-marketplace-target-template><figure><img data-dc-marketplace-preview alt="" hidden><figcaption data-dc-target-name></figcaption></figure></template>
<template data-dc-marketplace-listing-template><article class="listing"><img data-dc-marketplace-preview alt="" hidden><h2 data-dc-listing-name></h2><p data-dc-listing-description></p><p data-dc-listing-shop></p><strong data-dc-listing-price></strong><p data-dc-listing-availability></p><p data-dc-listing-schedule></p><p data-dc-listing-allocation></p><p data-dc-listing-raffleStatus></p><div class="actions">''' + ''.join('<button type="button" data-dc-listing-action="' + action + '" data-dc-marketplace-label="' + name + '" disabled></button>' for action, name in [('purchase', 'reviewPurchase'), ('cancel', 'cancelStock'), ('status', 'checkRaffle'), ('entry', 'enterRaffle'), ('winner', 'reviewWinner')]) + '''</div></article></template>
<template data-dc-marketplace-order-template><article class="order"><span data-dc-order-summary></span><strong data-dc-order-quantity></strong><span data-dc-order-price></span><span data-dc-order-status></span></article></template></body></html>'''
CSS = '''*{box-sizing:border-box}body{margin:0;color:#233c34;background:#f0f5ef;font:16px system-ui,sans-serif}main{max-width:1160px;margin:auto;padding:24px}header,.seller{padding:24px;background:#dcecdf;border-radius:18px}h1{font-size:clamp(28px,5vw,44px)}.market-grid,.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.market-grid{margin-top:24px}.listing{padding:22px;background:white;border:1px solid #b8d0be;border-radius:16px}[data-dc-marketplace-target-previews]{display:flex;gap:12px;overflow:auto}[data-dc-marketplace-target-previews] img{max-width:80px;max-height:100px}[data-dc-marketplace-target-previews] figure{margin:12px 0}.listing img{max-width:100%;max-height:180px;object-fit:contain}.listing p,.seller p{line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.actions,nav,.order{display:flex;gap:10px;align-items:center;flex-wrap:wrap}nav{margin:12px 0}.seller{margin:24px 0}label{display:grid;gap:7px}button,input,select,textarea{font:inherit;padding:11px;border:1px solid #789986;border-radius:8px;max-width:100%}button{background:#e7f4e9;color:#173d29;cursor:pointer;min-height:44px}button:disabled,input:disabled,select:disabled,textarea:disabled{opacity:.55;cursor:default}textarea{min-height:100px}.order{padding:14px;border-bottom:1px solid #b8d0be}[hidden]{display:none!important}:focus-visible{outline:3px solid #be781b;outline-offset:3px}@media(max-width:550px){main{padding:12px}.seller,.listing,header{padding:16px}.form-grid{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}'''

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python python-marketplace-view.py OUTPUT_DIR')
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    (out / 'index.html').write_text(HTML, encoding='utf-8')
    (out / 'marketplace.css').write_text(CSS, encoding='utf-8')
