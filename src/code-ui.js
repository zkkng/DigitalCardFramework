import { el, button, section, field } from './ui-kit.js';
import {localizeDiagnostic,createLocalization,localizationKeys} from './localization.js';

/** Keeps retry identity in memory; never stores the returned secret in Web Storage. */
export function createCodeRevealController({ codeId, reveal, key = () => crypto.randomUUID() }) {
  let state = { phase: 'covered', code: null, error: null }, pending, requestKey, disposed = false;
  const listeners = new Set();
  const publish = next => { if (!disposed) { state = next; for (const listener of listeners) listener({ ...state }); } };
  return {
    getState: () => ({ ...state }),
    subscribe(fn) { listeners.add(fn); fn({ ...state }); return () => listeners.delete(fn); },
    open() {
      if (disposed) return Promise.resolve();
      if (pending) return pending;
      if (state.phase === 'revealed') return Promise.resolve(state.code);
      requestKey ??= key(); publish({ phase: 'loading', code: null, error: null });
      pending = Promise.resolve().then(() => reveal({ codeId, key: requestKey })).then(result => {
        if (typeof result?.code !== 'string') throw new Error('The server did not return a code.');
        publish({ phase: 'revealed', code: result.code, error: null }); return disposed ? undefined : result.code;
      }).catch(error => { publish({ phase: 'error', code: null, error: error.message, diagnostic: {code:error.code,message:error.message,name:error.name} }); }).finally(() => { pending = null; });
      return pending;
    },
    dispose() { disposed = true; state = { phase: 'disposed', code: null, error: null }; listeners.clear(); },
  };
}

/** Replaceable cosmetic interaction. The code is fetched only after reveal is requested. */
export function renderCodeReveal({ codeId, mode = 'scratch' }, { reveal, key, threshold = 0.45,locale='en',messages={},localization=createLocalization({locale,messages}),isCurrent=()=>true } = {}) {
  if (!['open', 'scratch', 'peel'].includes(mode) || !Number.isFinite(threshold) || threshold <= 0 || threshold > 1)
    throw new Error('Invalid code reveal options');
  const t=localization.text,controller = createCodeRevealController({ codeId, reveal:async input=>{const result=await reveal(input);if(typeof result?.code!=='string')throw new Error(t('codes.invalidResponse'));return result;}, key });
  const node = el('div', 'dc-code-reveal'), surface = el('div', 'dc-code-surface'), cover = el('div', 'dc-code-cover'),
    output = el('output', 'dc-code-value'), status = el('p', 'dc-muted'), revealButton = button(t('codes.reveal'), () => controller.open(), 'dc-quiet');
  node.setAttribute('lang',localization.locale);node.setAttribute('dir',localization.dir);
  output.setAttribute('aria-label',t('codes.redemptionCode')); status.setAttribute('role', 'status');
  surface.style.cssText = 'position:relative;min-height:100px;border:1px solid currentColor;border-radius:12px;overflow:hidden;touch-action:none;display:grid;place-items:center';
  cover.style.cssText = 'position:absolute;inset:0;display:grid;grid-template-columns:repeat(16,1fr);grid-template-rows:repeat(6,1fr)';
  cover.setAttribute('aria-hidden', 'true');
  output.style.cssText = 'padding:18px;overflow-wrap:anywhere;font:600 1.15rem monospace';
  output.textContent = t('codes.private');
  const cells = Array.from({ length: 96 }, () => { const cell = el('span'); cell.style.background = 'linear-gradient(135deg,#b4afc4,#716980)'; cover.append(cell); return cell; });
  let dragging = false, startX = 0, previous = null, completed = false, disposed=false, retryFocus=null;
  const scratched = new Set();
  function progress(e) {
    if (!dragging || completed) return;
    const rect = surface.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    if (mode === 'peel') {
      const fraction = Math.max(0, Math.min(1, (e.clientX - startX) / rect.width));
      cover.style.transform = `translateX(${fraction * 100}%) rotate(${fraction * 5}deg)`;
      if (fraction >= threshold) { completed = true; controller.open(); }
    } else if (mode === 'scratch') {
      const point = { x: (e.clientX - rect.left) / rect.width * 16, y: (e.clientY - rect.top) / rect.height * 6 };
      const from = previous ?? point, steps = Math.max(1, Math.ceil(Math.hypot(point.x - from.x, point.y - from.y) * 2));
      for (let n = 0; n <= steps; n++) {
        const x = Math.floor(from.x + (point.x - from.x) * n / steps), y = Math.floor(from.y + (point.y - from.y) * n / steps);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (x+dx>=0 && x+dx<16 && y+dy>=0 && y+dy<6) {
          const index = (y+dy)*16+x+dx; scratched.add(index); cells[index].style.opacity = '0';
        }
      }
      previous = point;
      if (scratched.size / cells.length >= threshold) { completed = true; controller.open(); }
    }
  }
  surface.addEventListener('pointerdown', e => { dragging = true; startX = e.clientX; previous = null; surface.setPointerCapture(e.pointerId); progress(e); });
  surface.addEventListener('pointermove', progress);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) surface.addEventListener(type, () => { dragging = false; previous = null; });
  const unsubscribe = controller.subscribe(state => {
    if(state.phase==='loading'){
      retryFocus?.abort.abort();retryFocus=null;
      if(document.activeElement===revealButton){const attempt={abort:new AbortController(),moved:false};retryFocus=attempt;
        document.addEventListener('focusin',event=>{if(![revealButton,document.body,document.documentElement].includes(event.target))attempt.moved=true;},{capture:true,signal:attempt.abort.signal});
        document.addEventListener('pointerdown',()=>{attempt.moved=true;},{capture:true,signal:attempt.abort.signal});
      }
    }
    node.dataset.state = state.phase;
    revealButton.disabled = state.phase === 'loading' || state.phase === 'revealed';
    output.textContent = state.code ?? t('codes.private');
    cover.hidden = state.phase === 'revealed' || mode === 'open';
    if (cover.hidden) cover.style.display = 'none';
    status.textContent = (state.error ? localizeDiagnostic(localization,state.diagnostic) : null) ?? t(state.phase==='loading'?'codes.loading':state.phase==='revealed'?'codes.revealed':mode==='peel'?'codes.peelHint':mode==='scratch'?'codes.scratchHint':'codes.openLoading');
    if(state.phase!=='loading'){const attempt=retryFocus;retryFocus=null;attempt?.abort.abort();if(state.phase==='error'&&attempt&&!attempt.moved&&!disposed&&node.isConnected&&revealButton.isConnected&&!revealButton.disabled&&isCurrent()&&document.hasFocus()&&[document.body,document.documentElement,revealButton].includes(document.activeElement))revealButton.focus();}
  });
  surface.append(output, cover); node.append(surface, status, revealButton);
  if (mode === 'open') queueMicrotask(() => controller.open());
  return { node, controller, dispose() { disposed=true;retryFocus?.abort.abort();retryFocus=null;unsubscribe(); controller.dispose(); output.textContent = ''; node.replaceChildren(); } };
}

export function renderCodeHistory(model, { client, codeRevealRenderer = renderCodeReveal,getPrincipal,isCurrentModel,locale='en',messages={},localization=createLocalization({locale,messages}) } = {}) {
  const t=localization.text,enumLabel=value=>Object.hasOwn(localizationKeys,'codes.status.'+value)?t('codes.status.'+value):value;
  const node = section(t('codes.title'),t('codes.description')),
    search = field(node,t('codes.search'), { placeholder:t('codes.searchPlaceholder') }),
    list = el('div', 'dc-code-history'), status = el('p', 'dc-muted'), next = button(t('codes.more'), () => load(false), 'dc-quiet');
  node.setAttribute('lang',localization.locale);node.setAttribute('dir',localization.dir);
  status.setAttribute('role', 'status'); node.append(list, status, next);
  let disposed = false, generation = 0, cursor = null, loading = false;
  const principal=client.principal?.()??getPrincipal?.()??model?.me?.userId,revealCurrent=()=>!disposed&&(typeof getPrincipal!=='function'||getPrincipal()===principal)&&(typeof client.principal!=='function'||client.principal()===principal)&&(isCurrentModel?.(model)??true)!==false;
  const revealViews = [];
  async function load(reset) {
    if (loading && !reset) return;
    const current = ++generation; loading = true; next.disabled = true;
    if (reset) { cursor = null; revealViews.splice(0).forEach(view => view.dispose?.()); list.replaceChildren(); }
    try {
      const result = await client.codeHistory({ limit: 24, after: cursor, search: search.value.slice(0,100) });
      if (disposed || current !== generation) return;
      for (const row of result.items) {
        const card = el('article', 'dc-form-panel'), note = el('p', 'dc-muted');
        const describe = () => { note.textContent = t('codes.summary',{status:enumLabel(row.status),marker:t(row.reportedUsed?'codes.usedMarker':'codes.noUsedMarker'),provider:row.providerId}); };
        describe(); card.append(el('h3', '', row.name), el('p', '', row.title), note);
        if (row.canReveal) {
          const reveal = codeRevealRenderer({ codeId: row.id, mode: row.reveal }, { reveal: input => client.revealCode(input), key: client.requestKey,localization,isCurrent:revealCurrent });
          revealViews.push(reveal); card.append(reveal.node ?? reveal);
          const report = button(t(row.reportedUsed?'codes.clearMarker':'codes.markUsed'), async () => {
            report.disabled = true;
            try { const updated = await client.reportCodeUsage({ codeId: row.id, used: !row.reportedUsed, key: client.requestKey() }); if(disposed)return;row.reportedUsed = updated.reportedUsed; describe(); report.textContent = t(row.reportedUsed?'codes.clearMarker':'codes.markUsed'); }
            catch (error) { if(!disposed)status.textContent = localizeDiagnostic(localization,error); } finally { report.disabled = false; }
          }, 'dc-quiet'); card.append(report);
          if(client.reconcileCode)card.append(button(t('codes.checkProvider'), async () => {
            try { const result=await client.reconcileCode({codeId:row.id});if(disposed)return;status.textContent=result.status==='unverified'?t('codes.providerUnverified'):t('codes.providerConfirmed',{status:enumLabel(result.status)});if(result.status!=='unverified'){row.status=result.status;describe();} }
            catch(error){if(!disposed)status.textContent=localizeDiagnostic(localization,error);}
          },'dc-quiet'));
          if (row.redeemUrl) { let url; try { url = new URL(row.redeemUrl); } catch {} if(url?.protocol==='https:'&&!url.username&&!url.password) { const link = el('a', 'dc-quiet',t('codes.redeemWebsite')); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); } }
        } else card.append(el('p', 'dc-muted', row.revealUnavailableReason ?? t('codes.unavailable')));
        if(row.instructions)card.append(el('p','',row.instructions));
        if(row.provenance){const details=el('details'),pre=el('pre','',JSON.stringify({provenance:row.provenance,history:row.history,metadata:row.metadata},null,2));pre.style.whiteSpace='pre-wrap';details.append(el('summary','',t('codes.origin')),pre);card.append(details);}
        list.append(card);
      }
      cursor = result.next; next.hidden = !cursor; status.textContent = result.total ? t('codes.total',{count:result.total}) : t('codes.empty');
    } catch (error) { if (!disposed && current === generation) status.textContent = localizeDiagnostic(localization,error); }
    finally { if(current===generation){loading=false;next.disabled=false;} }
  }
  const find=button(t('codes.searchButton'),()=>load(true),'dc-quiet');node.insertBefore(find,list);
  search.addEventListener('keydown',e=>{if(e.key==='Enter')load(true);});
  const ready = load(true);
  return { node, ready, dispose() { disposed = true; generation++; revealViews.splice(0).forEach(view => view.dispose?.()); list.replaceChildren(); } };
}
