const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const message = (error) => error instanceof Error ? error.message : 'Unable to load trade inventory';
function seed(value) {
    if (!record(value))
        return null;
    if (value.toUserId !== undefined && value.toUserId !== null && typeof value.toUserId !== 'string')
        return null;
    if (value.message !== undefined && (typeof value.message !== 'string' || value.message.length > 500))
        return null;
    const sides = {};
    for (const side of ['give', 'receive']) {
        const offer = value[side];
        if (offer === undefined)
            continue;
        if (!record(offer))
            return null;
        if (offer.copyIds === null || offer.currencies === null)
            return null;
        const ids = offer.copyIds ?? [], moneyRows = offer.currencies ?? [];
        if (!Array.isArray(ids) || ids.length > 1000 || !ids.every(id => typeof id === 'string') || !Array.isArray(moneyRows) || moneyRows.length > 100)
            return null;
        const currencies = [];
        for (const money of moneyRows) {
            if (!record(money) || typeof money.currencyId !== 'string' || typeof money.amount !== 'number' || !Number.isSafeInteger(money.amount) || money.amount <= 0)
                return null;
            currencies.push({ currencyId: money.currencyId, amount: money.amount });
        }
        sides[side] = { copyIds: [...ids], currencies };
    }
    return { toUserId: typeof value.toUserId === 'string' ? value.toUserId : null, ...sides, message: typeof value.message === 'string' ? value.message : '' };
}
function inventory(value) {
    if (!record(value) || !Array.isArray(value.items) || value.items.length > 200)
        throw new Error('Invalid trade inventory response');
    const items = [];
    for (const copy of value.items) {
        if (!record(copy) || typeof copy.id !== 'string' || !copy.id || typeof copy.version !== 'number' || !Number.isSafeInteger(copy.version) || copy.version < 1 || typeof copy.tradable !== 'boolean' || copy.lockedBy !== undefined && typeof copy.lockedBy !== 'string' || copy.untradableReason !== undefined && copy.untradableReason !== null && typeof copy.untradableReason !== 'string')
            throw new Error('Invalid trade copy response');
        if (copy.definition !== undefined && (!record(copy.definition) || copy.definition.name !== undefined && typeof copy.definition.name !== 'string'))
            throw new Error('Invalid trade copy definition');
        const definition = record(copy.definition) ? { ...copy.definition, ...(typeof copy.definition.name === 'string' ? { name: copy.definition.name } : {}) } : undefined;
        items.push({ ...copy, id: copy.id, version: copy.version, tradable: copy.tradable, ...(definition ? { definition } : {}), ...(typeof copy.lockedBy === 'string' ? { lockedBy: copy.lockedBy } : {}), ...(copy.untradableReason === null || typeof copy.untradableReason === 'string' ? { untradableReason: copy.untradableReason } : {}) });
    }
    let owner = null;
    if (value.owner !== null) {
        if (!record(value.owner) || typeof value.owner.id !== 'string' || value.owner.name !== undefined && typeof value.owner.name !== 'string')
            throw new Error('Invalid trade inventory owner');
        owner = { id: value.owner.id, ...(typeof value.owner.name === 'string' ? { name: value.owner.name } : {}) };
    }
    if (value.next !== undefined && value.next !== null && typeof value.next !== 'string')
        throw new Error('Invalid trade inventory cursor');
    return { items, owner, next: typeof value.next === 'string' ? value.next : null };
}
/** Headless visual trade draft. State is presentation only; the server owns every transfer. */
export function createTradeDraft({ client, userId, catalog, storage, namespace = userId, initial, parentTradeId = null }) {
    const listeners = new Set(), storageKey = 'digital-card.trade-draft.v1:' + namespace;
    let generation = 0, publication = 0, disposed = false;
    let restored = seed(initial);
    try {
        if (!restored) {
            const raw = storage?.getItem(storageKey);
            if (typeof raw === 'string' && raw.length <= 1048576)
                restored = seed(JSON.parse(raw));
        }
    }
    catch { }
    let state = { phase: 'idle', recipientId: restored?.toUserId ?? null, owner: null, partner: null, inventory: [], partnerInventory: [], give: [], receive: [], giveCurrencies: [], receiveCurrencies: [], message: '', reviewed: false, error: null, ownNext: null, partnerNext: null };
    const copyMaps = { give: new Map(), receive: new Map() };
    const selected = (side) => state[side].flatMap(id => { const copy = copyMaps[side].get(id); return copy ? [copy] : []; });
    const publicState = () => structuredClone({ ...state, selectedGive: selected('give'), selectedReceive: selected('receive') });
    function publish(change, edit = false) {
        if (disposed)
            return;
        state = { ...state, ...change, ...(edit ? { reviewed: false } : {}) };
        if (edit)
            try {
                storage?.setItem(storageKey, JSON.stringify({ toUserId: state.recipientId, give: { copyIds: state.give, currencies: state.giveCurrencies }, receive: { copyIds: state.receive, currencies: state.receiveCurrencies }, message: state.message, parentTradeId }));
            }
            catch { }
        const version = ++publication, snapshot = publicState();
        for (const listener of listeners) {
            if (disposed || version !== publication)
                break;
            listener(structuredClone(snapshot));
        }
    }
    function eligible(copy) { return !!(catalog.features.cardTrading && (copy?.tradable || parentTradeId && copy?.lockedBy === parentTradeId)); }
    function sideFields(side) { if (!['give', 'receive'].includes(side))
        throw new Error('Invalid trade side'); return side === 'give' ? { list: 'inventory', cursor: 'ownNext', owner: userId } : { list: 'partnerInventory', cursor: 'partnerNext', owner: state.recipientId }; }
    function select(side, copyId) { if (disposed)
        return; sideFields(side); const copy = copyMaps[side].get(copyId); if (!eligible(copy))
        throw new Error(copy?.untradableReason ?? 'Card is not available'); if (state[side].includes(copyId))
        return; if (state[side].length >= 100)
        throw new Error('An offer can contain at most 100 cards per side'); publish({ [side]: [...state[side], copyId] }, true); }
    async function load(recipientId) {
        if (disposed)
            return;
        const current = ++generation;
        publish({ phase: 'loading', recipientId, reviewed: false, error: null });
        if (disposed || generation !== current)
            return;
        try {
            const ownRead = client.tradeInventory(userId, { limit: 200 });
            if (disposed || generation !== current) {
                Promise.resolve(ownRead).catch(() => { });
                return;
            }
            const partnerRead = recipientId ? client.tradeInventory(recipientId, { limit: 200 }) : Promise.resolve({ items: [], owner: null, next: null });
            const values = await Promise.all([ownRead, partnerRead]);
            if (disposed || generation !== current)
                return;
            const own = inventory(values[0]), partner = inventory(values[1]);
            for (const side of ['give', 'receive'])
                copyMaps[side].clear();
            own.items.forEach(copy => copyMaps.give.set(copy.id, copy));
            partner.items.forEach(copy => copyMaps.receive.set(copy.id, copy));
            const restore = restored?.toUserId === recipientId ? restored : null;
            restored = null;
            publish({ phase: 'ready', owner: own.owner, partner: partner.owner, inventory: own.items, partnerInventory: partner.items, ownNext: own.next ?? null, partnerNext: partner.next ?? null, give: (restore?.give?.copyIds ?? []).filter(id => eligible(copyMaps.give.get(id))), receive: (restore?.receive?.copyIds ?? []).filter(id => eligible(copyMaps.receive.get(id))), giveCurrencies: restore?.give?.currencies ?? [], receiveCurrencies: restore?.receive?.currencies ?? [], message: restore?.message ?? '' }, true);
        }
        catch (error) {
            if (generation === current)
                publish({ phase: 'error', error: message(error), inventory: [], partnerInventory: [], give: [], receive: [] });
        }
    }
    return {
        getState: publicState, subscribe(listener) { if (disposed)
            return () => { }; listeners.add(listener); listener(publicState()); return () => { listeners.delete(listener); }; }, load,
        async more(side) { if (disposed)
            return; const fields = sideFields(side), after = state[fields.cursor], current = generation; if (!after || !fields.owner)
            return; const value = await client.tradeInventory(fields.owner, { limit: 200, after }); if (disposed || generation !== current)
            return; const result = inventory(value); result.items.forEach(copy => copyMaps[side].set(copy.id, copy)); publish({ [fields.list]: [...state[fields.list], ...result.items], [fields.cursor]: result.next ?? null }); },
        add: select, remove(side, copyId) { if (disposed)
            return; sideFields(side); publish({ [side]: state[side].filter(id => id !== copyId) }, true); },
        setCurrency(side, currencyId, amount) { if (disposed)
            return; sideFields(side); if (!catalog.features.currencyTrading)
            throw new Error('Currency trading is disabled'); if (!catalog.currencies.some(currency => currency.id === currencyId && currency.tradable))
            throw new Error('Currency is not tradable'); if (!Number.isSafeInteger(amount) || amount < 0)
            throw new Error('Use a nonnegative whole amount'); const key = side === 'give' ? 'giveCurrencies' : 'receiveCurrencies', currencies = state[key].filter(currency => currency.currencyId !== currencyId); if (amount)
            currencies.push({ currencyId, amount }); publish({ [key]: currencies }, true); },
        setMessage(value) { if (disposed)
            return; if (typeof value !== 'string' || value.length > 500)
            throw new Error('Message is too long'); publish({ message: value }, true); },
        review(value = true) { if (disposed)
            return; if (state.phase !== 'ready')
            throw new Error('Load both inventories first'); publish({ reviewed: !!value }); },
        buildOffer() {
            if (disposed)
                throw new Error('Trade draft is disposed');
            if (!state.reviewed)
                throw new Error('Review and confirm the offer contents');
            if (!state.recipientId)
                throw new Error('Choose a recipient');
            if (!state.give.length && !state.receive.length && !state.giveCurrencies.length && !state.receiveCurrencies.length)
                throw new Error('Add cards or currency');
            const versions = [];
            for (const side of ['give', 'receive'])
                for (const id of state[side]) {
                    const copy = copyMaps[side].get(id);
                    if (!copy)
                        throw new Error('Reload the selected inventory');
                    versions.push([id, copy.version]);
                }
            return { toUserId: state.recipientId, give: { copyIds: [...state.give], currencies: structuredClone(state.giveCurrencies) }, receive: { copyIds: [...state.receive], currencies: structuredClone(state.receiveCurrencies) }, versions: Object.fromEntries(versions), message: state.message };
        },
        clear() { if (disposed)
            return; try {
            storage?.removeItem(storageKey);
        }
        catch { } publish({ give: [], receive: [], giveCurrencies: [], receiveCurrencies: [], message: '', reviewed: false }); },
        dispose() { disposed = true; generation++; listeners.clear(); }
    };
}
