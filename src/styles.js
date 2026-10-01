export const defaultCSS = `
.dc-root{--dc-bg:#10121b;--dc-panel:#191d2b;--dc-text:#f3f1fb;--dc-muted:#a6abc3;--dc-accent:#baa1ff;--dc-border:#303548;--dc-radius:16px;--dc-card-ratio:5/7;--dc-font:system-ui,sans-serif;font-family:var(--dc-font);color:var(--dc-text);background:var(--dc-bg);padding:28px;border:1px solid var(--dc-border);border-radius:var(--dc-radius);font-size:14px;line-height:1.5;color-scheme:dark}
.dc-root *{box-sizing:border-box}
.dc-root h2{font-size:clamp(22px,3vw,30px);font-weight:650;letter-spacing:-.035em;margin:0 0 8px}
.dc-root h3{font-size:18px;font-weight:600;letter-spacing:-.02em;margin:0 0 8px}
.dc-root p{line-height:1.65;margin:8px 0 18px}
.dc-root small{font-size:12px}
.dc-root .dc-muted,.dc-root .dc-section-intro{color:var(--dc-muted)}
.dc-root .dc-section-intro{max-width:740px;margin:0 0 26px;font-size:15px}
.dc-root .dc-section{padding:24px;background:var(--dc-panel);border:1px solid var(--dc-border);border-radius:var(--dc-radius);margin-bottom:18px}
.dc-root.dc-with-nav .dc-section{padding:28px 0 0;background:transparent;border:0;margin:0}
.dc-root .dc-dashboard:empty,.dc-root .dc-nav:empty,.dc-root .dc-status:empty{display:none}
.dc-root .dc-dashboard{display:flex;align-items:center;gap:28px;padding:0 0 24px}
.dc-root .dc-dashboard-heading{min-width:140px}
.dc-root .dc-dashboard-heading strong{display:block;font-size:22px;margin-top:4px}
.dc-root .dc-eyebrow{font-size:10px;font-weight:700;letter-spacing:.15em;color:var(--dc-muted);text-transform:uppercase}
.dc-root .dc-wallet-strip{display:flex;gap:36px;margin-left:auto}
.dc-root .dc-wallet-strip strong{font-size:22px;display:block;font-variant-numeric:tabular-nums}
.dc-root .dc-wallet-strip span{font-size:12px}
.dc-root .dc-account-stats{border-left:1px solid var(--dc-border);padding-left:24px;display:grid;gap:5px;color:var(--dc-muted);font-size:12px}
.dc-root .dc-nav{display:flex;gap:4px;border-top:1px solid var(--dc-border);border-bottom:1px solid var(--dc-border);padding:8px 0;overflow-x:auto}
.dc-root .dc-nav-item{background:transparent;color:var(--dc-muted);border:0;white-space:nowrap;border-radius:8px;font:inherit;font-weight:550;padding:11px 18px;cursor:pointer;display:flex;align-items:center;gap:8px}
.dc-root .dc-nav-item[aria-current=page]{background:var(--dc-panel);color:var(--dc-text);box-shadow:inset 0 -2px var(--dc-accent)}
.dc-root .dc-nav-item:hover{color:var(--dc-text);background:var(--dc-panel)}
.dc-root .dc-nav-count{border-radius:5px;padding:0 5px;background:var(--dc-accent);color:#211736;font-size:11px}
.dc-root .dc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:22px;max-width:1100px}
.dc-root .dc-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dc-root .dc-button{font:inherit;font-size:13px;font-weight:650;background:var(--dc-accent);color:#211736;border:1px solid transparent;border-radius:8px;padding:11px 16px;cursor:pointer;transition:filter .15s,transform .15s}
.dc-root .dc-button:hover{filter:brightness(1.1);transform:translateY(-1px)}
.dc-root .dc-button:disabled{opacity:.4;cursor:default;transform:none}
.dc-root :is(button,input,select,summary):focus-visible{outline:3px solid var(--dc-accent);outline-offset:4px}
.dc-root input,.dc-root select,.dc-root textarea{font:inherit;color:var(--dc-text);background:var(--dc-bg);border:1px solid var(--dc-border);border-radius:8px;padding:10px 12px;max-width:100%;min-width:0;min-height:42px}
.dc-root select{cursor:pointer}
.dc-root label{display:grid;gap:8px;margin:8px 0}
.dc-root .dc-field>span{color:var(--dc-muted);font-size:12px;font-weight:550}
.dc-root .dc-form-row{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:14px}
.dc-root .dc-form-row .dc-field{flex:1;min-width:130px;max-width:340px}
.dc-root .dc-form-panel{padding:22px;background:var(--dc-panel);border:1px solid var(--dc-border);border-radius:12px;margin:24px 0}
.dc-root .dc-form-panel>summary{font-size:16px;font-weight:600;cursor:pointer}
.dc-root .dc-form-panel[open]>summary{margin-bottom:18px}
.dc-root .dc-error{color:#ffb2a7;white-space:pre-wrap}
.dc-root .dc-status{padding:12px 16px;margin-top:16px;background:var(--dc-panel);border-left:3px solid var(--dc-accent);border-radius:6px;font-size:13px}
.dc-root .dc-status.is-success{border-color:#88dbb5;color:#a8eccd}
.dc-root .dc-status.dc-error{border-color:#ffb2a7}
.dc-root .dc-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin:0 0 30px;padding:22px;border:1px solid var(--dc-border);border-radius:12px;background:linear-gradient(110deg,#baa1ff0b,transparent)}
.dc-root .dc-steps>div{display:grid;grid-template-columns:30px 1fr;align-items:center;column-gap:10px}
.dc-root .dc-step-number{grid-row:span 2;color:var(--dc-accent);font-size:12px;font-weight:700}
.dc-root .dc-steps strong{font-size:13px}.dc-root .dc-steps small{margin-top:4px;font-size:11px}
.dc-root .dc-shop-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}
.dc-root .dc-product{background:var(--dc-panel);border:1px solid var(--dc-border);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.dc-root .dc-pack-art{height:218px;position:relative;display:flex;align-items:center;justify-content:center;flex-direction:column;overflow:hidden;background:radial-gradient(ellipse at 50% 60%,#74609345,transparent 65%),linear-gradient(145deg,#25243c,#151b2b);border-bottom:1px solid var(--dc-border)}
.dc-root .dc-pack-art:before{content:'';position:absolute;width:108px;height:160px;border:1px solid #dbcdffaa;border-top:7px solid #9387b0;border-bottom:7px solid #9387b0;border-radius:4px;transform:rotate(-9deg);background:linear-gradient(155deg,#b794e244,#252640);box-shadow:12px 12px 40px #0005}
.dc-root .dc-pack-art[data-line=garden]{background:radial-gradient(ellipse at 50% 60%,#72978030,transparent 65%),linear-gradient(145deg,#26362f,#182428)}
.dc-root .dc-pack-art[data-line=garden]:before{border-color:#9ac1ac;background:linear-gradient(155deg,#91b89744,#243631)}
.dc-root .dc-pack-symbol{font-size:44px;z-index:1;color:#ead9ff;margin:0 0 10px;transform:rotate(-9deg)}
.dc-root .dc-pack-word{font-size:12px;color:#f4e5ff;z-index:1;font-weight:650;transform:rotate(-9deg)}
.dc-root .dc-pack-art>small{font-size:6px;letter-spacing:.2em;z-index:1;margin-top:5px;transform:rotate(-9deg);color:#c3b5d3}
.dc-root .dc-pack-orbit{position:absolute;border:1px solid #baa1ff22;width:260px;height:260px;border-radius:50%;transform:scaleX(1.5) rotate(-30deg)}
.dc-root .dc-product-info{padding:22px;display:flex;flex-direction:column;flex:1}
.dc-root .dc-product-info h3{font-size:24px;margin:6px 0}
.dc-root .dc-product-info>p{font-size:12px;margin:0 0 16px}
.dc-root .dc-rates{font-size:12px;margin-bottom:20px;flex:1}
.dc-root .dc-rates summary{color:var(--dc-accent);cursor:pointer;padding:8px 0}
.dc-root .dc-rates p{font-size:11px}
.dc-root .dc-rate-row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--dc-border)}
.dc-root .dc-purchase-row{display:flex;gap:12px;align-items:flex-end;border-top:1px solid var(--dc-border);padding-top:14px}
.dc-root .dc-purchase-row .dc-field{width:64px;margin:0;flex-shrink:0}
.dc-root .dc-purchase-row input{width:100%;padding:10px 8px}.dc-root .dc-purchase-row .dc-button{flex:1;min-height:42px;padding:10px 8px}
.dc-root .dc-pack-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.dc-root .dc-owned-pack{display:flex;align-items:center;gap:16px;padding:14px;background:var(--dc-panel);border:1px solid var(--dc-border);border-radius:12px}
.dc-root .dc-owned-pack h3{font-size:14px;margin:5px 0}.dc-root .dc-owned-pack small{font-size:10px}.dc-root .dc-owned-pack .dc-button{margin-left:auto;white-space:nowrap}
.dc-root .dc-pack-art-small{height:82px;width:62px;border:0;border-radius:6px;flex-shrink:0}
.dc-root .dc-pack-art-small:before{width:38px;height:60px;border-top-width:3px;border-bottom-width:3px}.dc-root .dc-pack-art-small .dc-pack-symbol{font-size:22px;margin:0}.dc-root .dc-pack-art-small .dc-pack-word,.dc-root .dc-pack-art-small>small{display:none}
.dc-root .dc-badge{font-size:10px;text-transform:uppercase;letter-spacing:.08em;border:1px solid var(--dc-border);padding:3px 7px;border-radius:5px;color:var(--dc-muted)}
.dc-root .dc-badge.is-sealed{color:#cab3ff;border-color:#baa1ff66;background:#baa1ff11}
.dc-root .dc-empty{padding:38px 20px;text-align:center;border:1px dashed var(--dc-border);border-radius:12px;grid-column:1/-1}
.dc-root .dc-empty-symbol{font-size:36px;color:var(--dc-accent);display:block;margin-bottom:14px}.dc-root .dc-empty h3{font-size:18px}.dc-root .dc-empty p{max-width:440px;margin:0 auto 20px}
.dc-root .dc-card{width:100%;aspect-ratio:var(--dc-card-ratio);position:relative;perspective:1000px;cursor:pointer;border:0;background:none;color:#f3f1fb;padding:0;--dc-x:0;--dc-y:0;--dc-flip:0deg;text-align:left}
.dc-root .dc-card-inner{display:block;width:100%;height:100%;position:relative;transform-style:preserve-3d;transform:rotateY(calc(var(--dc-flip) + var(--dc-x)*10deg)) rotateX(calc(var(--dc-y)*-8deg));transition:transform .12s ease;will-change:transform}
.dc-root .dc-front,.dc-root .dc-back{position:absolute;inset:0;border:1px solid #c2daca77;border-radius:12px;backface-visibility:hidden;overflow:hidden;box-shadow:0 8px 20px #0003}
.dc-root .dc-card[data-rarity=rare] .dc-front{border-color:#bf9aff}.dc-root .dc-card[data-rarity=unique] .dc-front{border-color:#f3cf83}
.dc-root .dc-front{background:linear-gradient(145deg,#53776c,#202a4a 70%,#8e735d)}
.dc-root .dc-back{transform:rotateY(180deg);display:grid;place-items:center;background:repeating-linear-gradient(45deg,#273047 0 8px,#2f3955 8px 16px)}
.dc-root .dc-back-mark{border:1px solid #bdd6cd88;border-radius:50%;padding:25px;font-size:2rem;letter-spacing:.12em}
.dc-root .dc-layer{position:absolute;inset:-8%;width:116%;height:116%;object-fit:cover;transform:translate(calc(var(--dc-x)*var(--dc-depth)*1px),calc(var(--dc-y)*var(--dc-depth)*1px));pointer-events:none}
.dc-root .dc-card-motif{position:absolute;inset:0;overflow:hidden;opacity:.8}
.dc-root .dc-orb{position:absolute;width:36%;aspect-ratio:1;border-radius:50%;top:23%;left:32%;background:linear-gradient(145deg,#ffffffbb,#f9e5c111);box-shadow:0 0 35px #fffa;transform:translate(calc(var(--dc-x)*8px),calc(var(--dc-y)*8px))}
.dc-root .dc-orbit{position:absolute;width:72%;height:42%;left:14%;top:20%;border:1px solid #fff5;border-radius:50%;transform:rotate(-35deg)}
.dc-root .dc-horizon{position:absolute;width:150%;height:50%;left:-20%;bottom:0;border-radius:50% 50% 0 0;background:#12192b55;transform:rotate(-15deg)}
.dc-root .dc-card-title{position:absolute;bottom:0;left:0;right:0;padding:16px;background:linear-gradient(transparent,#101822f2);z-index:5}
.dc-root .dc-card-title strong{display:block;font-size:1rem;margin:14px 0 5px}.dc-root .dc-card-title small{color:#d1e0dc;text-transform:capitalize;font-size:11px}
.dc-root .dc-gloss{position:absolute;inset:0;pointer-events:none;background:linear-gradient(calc(115deg + var(--dc-x)*30deg),transparent 20%,#fff4 43%,transparent 65%);mix-blend-mode:screen;opacity:.5;z-index:4}
.dc-root .dc-holo{background:linear-gradient(calc(100deg + var(--dc-x)*60deg),#f478ad33,#8affce66,#849cf833,#fbdb6544);mix-blend-mode:color-dodge}
.dc-root .dc-emissive{filter:drop-shadow(0 0 8px #a2ffe5);animation:dc-glow 3s ease-in-out infinite alternate}
.dc-root .dc-inspector-dialog{width:min(850px,calc(100% - 32px));max-height:90dvh;color:var(--dc-text);background:var(--dc-panel);border:1px solid var(--dc-border);border-radius:18px;padding:28px;overscroll-behavior:contain}
.dc-root .dc-inspector-dialog::backdrop{background:#060913cc;backdrop-filter:blur(6px)}
.dc-root .dc-inspector-grid{display:grid;grid-template-columns:minmax(200px,320px) 1fr;gap:32px}.dc-root .dc-inspector-grid>.dc-card{align-self:start}
.dc-root .dc-inspector dt{color:var(--dc-muted);font-size:11px;margin-top:12px;text-transform:uppercase;letter-spacing:.06em}.dc-root .dc-inspector dd{margin:4px 0;overflow-wrap:anywhere;font-size:13px}
.dc-root .dc-inspector dl{border-top:1px solid var(--dc-border);padding-top:8px}
.dc-root .dc-album{display:grid;grid-template-columns:repeat(var(--dc-album-columns,3),minmax(0,1fr));gap:var(--dc-album-gap,18px);max-width:900px}
.dc-root .dc-album-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
.dc-root .dc-album-tile{background:var(--dc-panel);border:1px solid var(--dc-border);border-radius:12px;padding:20px}.dc-root .dc-album-tile .dc-row{margin-top:20px}.dc-root .dc-album-tile .dc-button{font-size:11px;padding:8px 12px}
.dc-root .dc-album-icon{font-size:28px;color:var(--dc-accent);display:block;margin-bottom:12px}.dc-root .dc-album-display:not(:empty){padding-top:30px}.dc-root .dc-album-display h3{margin-bottom:20px}
.dc-root .dc-public-list{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}
.dc-root .dc-opener{margin:28px 0 0;padding:24px;background:var(--dc-panel);border:1px solid var(--dc-border);border-radius:12px}.dc-root .dc-opener .dc-grid{margin-top:24px;grid-template-columns:repeat(auto-fill,minmax(160px,200px))}
.dc-root .dc-sealed-card{aspect-ratio:var(--dc-card-ratio);border:1px solid #baa1ff44;border-radius:12px;background:repeating-linear-gradient(45deg,#242b40 0 8px,#293149 8px 16px);display:flex;align-items:center;justify-content:center;flex-direction:column;color:#b2a6d2;gap:12px}.dc-root .dc-sealed-card>span{font-size:40px}
.dc-root .dc-collection-cell>small{display:block;margin:10px 2px;text-transform:capitalize}
.dc-root .dc-result-label{display:block;margin:12px 2px;color:var(--dc-accent);font-size:11px}
.dc-root .dc-copy-choices{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
.dc-root label.dc-copy-choice{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--dc-border);border-radius:8px;background:var(--dc-bg);margin:0 0 8px;cursor:pointer}.dc-root .dc-copy-choice input{min-height:0;accent-color:var(--dc-accent)}.dc-root .dc-copy-choice small{margin-left:auto;font-size:10px}.dc-root .dc-copy-choice:has(:checked){border-color:var(--dc-accent)}
.dc-root .dc-trade-columns{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px}.dc-root .dc-trade-columns>div{min-width:0;padding:18px;border:1px solid var(--dc-border);border-radius:10px}.dc-root .dc-trade{padding:22px;background:var(--dc-panel);border:1px solid var(--dc-border);border-radius:12px;margin-top:16px}.dc-root .dc-trade h3{margin-top:14px}
.dc-root .dc-wallet-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px}.dc-root .dc-balance{padding:24px;background:var(--dc-panel);border:1px solid var(--dc-border);border-radius:12px;display:grid;gap:8px}.dc-root .dc-balance strong{font-size:36px;letter-spacing:-.03em}.dc-root .dc-conversion-preview{font-size:20px;color:var(--dc-accent)}
@keyframes dc-glow{to{filter:drop-shadow(0 0 14px #a2ffe5)}}
@media(max-width:1000px){.dc-root .dc-shop-grid{gap:14px}.dc-root .dc-product-info{padding:16px}.dc-root .dc-dashboard{gap:18px}.dc-root .dc-wallet-strip{gap:22px}.dc-root .dc-account-stats{display:none}}
@media(max-width:760px){.dc-root{padding:18px}.dc-root .dc-shop-grid{grid-template-columns:1fr}.dc-root .dc-product{display:grid;grid-template-columns:140px 1fr}.dc-root .dc-pack-art{height:100%;min-height:220px;border-bottom:0;border-right:1px solid var(--dc-border)}.dc-root .dc-steps{padding:16px;gap:16px;grid-template-columns:1fr}.dc-root .dc-nav-item{padding:10px 12px}.dc-root .dc-inspector-grid{grid-template-columns:1fr}.dc-root .dc-inspector-grid>.dc-card{max-width:280px;justify-self:center}.dc-root .dc-inspector-dialog{padding:20px}.dc-root .dc-trade-columns{grid-template-columns:1fr}.dc-root .dc-album{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:460px){.dc-root{padding:14px}.dc-root .dc-dashboard-heading{min-width:0}.dc-root .dc-dashboard-heading strong{font-size:17px}.dc-root .dc-wallet-strip{gap:14px}.dc-root .dc-wallet-strip strong{font-size:17px}.dc-root .dc-wallet-strip span{font-size:10px}.dc-root .dc-dashboard{gap:12px}.dc-root .dc-product{grid-template-columns:100px 1fr}.dc-root .dc-pack-art:before{width:72px;height:130px}.dc-root .dc-pack-word{font-size:9px}.dc-root .dc-pack-symbol{font-size:32px}.dc-root .dc-product-info h3{font-size:20px}.dc-root .dc-product-info{padding:14px}.dc-root .dc-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.dc-root .dc-card-title{padding:12px}.dc-root .dc-card-title strong{font-size:13px}.dc-root .dc-pack-list{grid-template-columns:1fr}.dc-root .dc-owned-pack{gap:12px}.dc-root .dc-owned-pack .dc-button{padding:8px}.dc-root .dc-opener{padding:16px}.dc-root .dc-opener .dc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(prefers-reduced-motion:reduce){.dc-root .dc-card-inner{transition:none;transform:none}.dc-root .dc-layer,.dc-root .dc-orb{transform:none}.dc-root .dc-emissive{animation:none}.dc-root .dc-button{transition:none}.dc-root .dc-card[data-flipped=true] .dc-front{visibility:hidden}.dc-root .dc-card[data-flipped=true] .dc-back{transform:none}}
`;
