import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {albumAppearance,validateAlbumAppearance} from '../src/album-appearance.js';
import {renderAlbum} from '../src/ui.js';

test('historical album colors and bounded spacing migrate without executing CSS',()=>{
  assert.deepEqual(albumAppearance({css:'.dc-album { background: #142321; padding:24px; border-radius:9px; color:white; }',appearance:{padding:12,borderWidth:2}}),{background:'#142321',color:'white',padding:12,radius:9,borderWidth:2});
  assert.deepEqual(albumAppearance({appearance:{background:'rgba(12, 20, 30, 0.4)',color:'#fff',padding:0}}),{background:'rgba(12, 20, 30, 0.4)',color:'#fff',padding:0});
});

test('host, network, geometry, overflow and pointer styles never enter an album stylesheet',async()=>{
  const window=new Window();globalThis.document=window.document;
  try{
    const attacks=[':host {position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647}', '.dc-album{background:url(https://example.invalid/secret);padding:100000px;position:absolute;overflow:visible;pointer-events:none}', '@import url(https://example.invalid/style);', '.dc-album{background:var(--secret);color:expression(alert(1));padding:calc(1px + 100vh)}', '.dc-album{background:rgb(999,0,0);border-width:999px;transform:scale(999)}'];
    for(const css of attacks){const host=renderAlbum({layout:{css,appearance:{background:'url(/api/me)',padding:1e9}},cards:[]});window.document.body.append(host);const stylesheet=host.shadowRoot.querySelector('style').textContent;assert(!stylesheet.includes(css));assert(!stylesheet.includes('example.invalid'));const node=host.shadowRoot.querySelector('.dc-album');assert.equal(node.style.backgroundColor,'');assert.equal(node.style.padding,'');assert.equal(host.style.contain,'layout paint');assert.equal(host.style.overflow,'hidden');host.remove();}
    const first=renderAlbum({layout:{appearance:{background:'#123456',padding:9}},cards:[]}),second=renderAlbum({layout:{appearance:{background:'#abcdef'}},cards:[]});assert.notEqual(first.shadowRoot,second.shadowRoot);assert.equal(first.shadowRoot.querySelector('.dc-album').style.padding,'9px');assert.equal(second.shadowRoot.querySelector('.dc-album').style.padding,'');
  }finally{await window.happyDOM.abort();delete globalThis.document;}
});

test('the album editor validator rejects unknown fields, invalid ranges and URL colors',()=>{
  for(const value of [null,[],{padding:-1},{padding:101},{radius:101},{borderWidth:13},{background:'url(/private)'},{position:'fixed'}])assert.throws(()=>validateAlbumAppearance(value));
  assert.deepEqual(validateAlbumAppearance({padding:0,borderWidth:12,background:'#fff'}),{background:'#fff',padding:0,borderWidth:12});assert.deepEqual(albumAppearance(null),{});
});
