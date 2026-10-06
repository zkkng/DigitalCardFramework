const copy = value => structuredClone(value);
const errors = error => ({code:error.code ?? 'NETWORK_ERROR',message:error.message ?? 'Unable to reach the server.',status:error.status});
const commands = new Set(['configureAdmin','administerCards']);

/** A replaceable operator workflow. Namespace identifies the authenticated operator. */
export function createAdminController({client,storage,namespace} = {}) {
  if (!client || !namespace) throw new Error('An admin client and an operator namespace are required.');
  const storageKey = 'digital-card.admin-command.v1:' + namespace;
  let pending = null, disposed = false, generation = 0, usersGeneration = 0, personGeneration = 0, historyGeneration = 0, publication = 0, active = null;
  const storageError = () => Object.assign(new Error('Safe command storage is unavailable. Restore storage before retrying this change.'),{code:'COMMAND_STORAGE_UNAVAILABLE',status:503});
  function readPending() {
    try {
      if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw storageError();
      const raw = storage.getItem(storageKey);
      if (raw === null) return null;
      if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > 1024*1024) throw storageError();
      const saved = JSON.parse(raw);
      if (!saved || !commands.has(saved.command) || typeof saved.input?.key !== 'string' || !saved.input.key || saved.input.key.length > 128 || !saved.review || saved.review.command !== saved.command || !saved.review.input || !Array.isArray(saved.review.changes)) throw storageError();
      return saved;
    } catch { throw storageError(); }
  }
  try { pending = readPending(); } catch {}
  let state = {phase:'idle',overview:null,users:{items:[],next:null,total:0},person:null,history:{items:[],next:null,total:0},review:pending?.review ?? null,pending:!!pending,error:null,message:pending ? 'A previous save needs confirmation. Retry the same change to recover its result safely.' : '',loadingUsers:false,loadingPerson:false,loadingHistory:false};
  const listeners = new Set();
  const publish = patch => { if (disposed) return; state = {...state,...patch}; const version=++publication,snapshot=copy(state);for(const listener of listeners){if(disposed||version!==publication)break;listener(copy(snapshot));} };
  const persist = clearKey => {
    if (pending) {
      try {
        const value = JSON.stringify(pending);
        if (new TextEncoder().encode(value).byteLength > 1024*1024) throw storageError();
        storage.setItem(storageKey,value);
        if (storage.getItem(storageKey) !== value) throw storageError();
      } catch { throw storageError(); }
    } else {
      // A failed cleanup keeps the original identity available for safe replay.
      try { if (readPending()?.input.key === clearKey) storage.removeItem(storageKey); } catch {}
    }
  };
  async function load({keepReview = true} = {}) {
    if (disposed || active) return;
    const current = ++generation; publish({phase:'loading',error:null,...(!keepReview && !pending ? {review:null} : {})});
    if(disposed||current!==generation)return;
    try { const overview = await client.adminOverview(); if (disposed || current !== generation) return; publish({phase:'ready',overview}); }
    catch (error) { if (current === generation) publish({phase:'error',error:errors(error)}); }
  }
  async function users({search = '',after,limit = 30} = {}) {
    if (disposed) return;
    const current = ++usersGeneration; publish({loadingUsers:true,error:null});
    if(disposed||current!==usersGeneration)return;
    try { const result = await client.adminUsers({search,after,limit}); if (disposed || current !== usersGeneration) return; publish({loadingUsers:false,users:after ? {...result,items:[...state.users.items,...result.items]} : result}); }
    catch (error) { if (current === usersGeneration) publish({loadingUsers:false,error:errors(error)}); }
  }
  async function person(userId,{after,limit = 50} = {}) {
    if (disposed) return;
    const current = ++personGeneration; publish({loadingPerson:true,error:null,...(!after ? {person:null} : {})});
    if(disposed||current!==personGeneration)return;
    try { const result = await client.adminUser({userId,after,limit}); if (disposed || current !== personGeneration) return; if (after && state.person?.user.id === result.user.id) result.inventory.items = [...state.person.inventory.items,...result.inventory.items]; publish({loadingPerson:false,person:result}); }
    catch (error) { if (current === personGeneration) publish({loadingPerson:false,error:errors(error)}); }
  }
  async function history({search = '',after,limit = 30} = {}) {
    if (disposed) return;
    const current = ++historyGeneration; publish({loadingHistory:true,error:null});
    if(disposed||current!==historyGeneration)return;
    try { const result = await client.adminHistory({search,after,limit}); if (disposed || current !== historyGeneration) return; publish({loadingHistory:false,history:after ? {...result,items:[...state.history.items,...result.items]} : result}); }
    catch (error) { if (current === historyGeneration) publish({loadingHistory:false,error:errors(error)}); }
  }
  function stage({command = 'configureAdmin',input,title,changes,description = ''}) {
    if (disposed || active || pending) return false;
    if (!commands.has(command)) throw new Error('Unsupported admin command.');
    if (!state.overview) throw new Error('Load current settings before reviewing a change.');
    if (!Array.isArray(changes) || !changes.length) throw new Error('Make a change before reviewing it.');
    publish({review:{command,input:copy({...input,expectedRevision:state.overview.revision}),title,changes:copy(changes),description},error:null,message:''}); return true;
  }
  function cancel() { if (active || pending || disposed) return false; publish({review:null,error:null,message:'Draft discarded. Saved settings are unchanged.'}); return true; }
  function confirm() {
    if (active) return active;
    if (disposed || !state.review) return Promise.resolve(null);
    const priorAttempt=!!pending;
    try {
      const saved = readPending();
      if (saved && saved.input.key !== pending?.input.key) {pending=saved;publish({pending:true,review:copy(saved.review),message:'Another save needs confirmation. Retry that original change before making a new one.'});return Promise.resolve(null);}
      if (!pending) pending = {command:state.review.command,input:{...copy(state.review.input),key:client.requestKey()},review:copy(state.review)};
      persist();
    } catch (error) {publish({phase:'error',pending:!!pending,error:errors(error),message:'Restore command storage before saving or retrying this change.'});return Promise.resolve(null);}
    const operation = pending,current=++generation;
    active = Promise.resolve().then(async () => {
      if(disposed||current!==generation)return null;
      let receipt;
      try { receipt = await client[operation.command](copy(operation.input)); if(disposed||current!==generation)return receipt; pending = null; persist(operation.input.key); publish({phase:'ready',pending:false,review:null,error:null,message:'Changes saved. They apply to new actions immediately.'}); }
      catch (error) { if(disposed||current!==generation)return null; const definite = !priorAttempt && Number.isInteger(error.status) && error.status >= 400 && error.status < 500; if (definite) { pending = null; persist(operation.input.key); } publish({phase:'error',pending:!!pending,error:errors(error),message:definite ? '' : 'The result is not confirmed. Retry this same change; it will not run twice.'}); return null; }
      finally { active = null; }
      if (!disposed) { const selected = state.person?.user.id; await load({keepReview:false}); if (state.error) publish({message:'Your changes were saved, but current settings could not be refreshed. Reload before making another change.'}); if (!disposed && selected) await person(selected); }
      return receipt;
    }); publish({phase:'saving',pending:true,error:null,message:''});return active;
  }
  return {getState:() => copy(state),subscribe(listener) { if (disposed) return () => {}; listeners.add(listener); listener(copy(state)); return () => listeners.delete(listener); },load,users,person,history,stage,cancel,confirm,dispose() {disposed = true;generation++;usersGeneration++;personGeneration++;historyGeneration++;listeners.clear();}};
}
