export type TradeSide = 'give' | 'receive';
export interface TradeDraftCopy {
    id: string;
    version: number;
    tradable: boolean;
    lockedBy?: string;
    untradableReason?: string | null;
    definition?: {
        name?: string;
        [field: string]: unknown;
    };
    [field: string]: unknown;
}
export interface TradeOwner {
    id: string;
    name?: string;
}
export interface TradeInventory {
    items: TradeDraftCopy[];
    owner: TradeOwner | null;
    next?: string | null;
}
export interface TradeMoney {
    currencyId: string;
    amount: number;
}
export interface TradeSeed {
    toUserId?: string | null;
    give?: {
        copyIds?: string[];
        currencies?: TradeMoney[];
    };
    receive?: {
        copyIds?: string[];
        currencies?: TradeMoney[];
    };
    message?: string;
}
export interface TradeDraftOptions {
    client: {
        tradeInventory(userId: string, options: {
            limit: number;
            after?: string;
        }): Promise<TradeInventory>;
    };
    userId: string;
    catalog: {
        features: {
            cardTrading?: boolean;
            currencyTrading?: boolean;
        };
        currencies: {
            id: string;
            tradable?: boolean;
        }[];
    };
    storage?: {
        getItem(key: string): string | null | undefined;
        setItem(key: string, value: string): void;
        removeItem(key: string): void;
    };
    namespace?: string;
    initial?: TradeSeed;
    parentTradeId?: string | null;
}
export interface TradeDraftState {
    phase: 'idle' | 'loading' | 'ready' | 'error';
    recipientId: string | null;
    owner: TradeOwner | null;
    partner: TradeOwner | null;
    inventory: TradeDraftCopy[];
    partnerInventory: TradeDraftCopy[];
    give: string[];
    receive: string[];
    giveCurrencies: TradeMoney[];
    receiveCurrencies: TradeMoney[];
    message: string;
    reviewed: boolean;
    error: string | null;
    ownNext: string | null;
    partnerNext: string | null;
    selectedGive: TradeDraftCopy[];
    selectedReceive: TradeDraftCopy[];
}
export interface TradeDraftOffer {
    toUserId: string;
    give: {
        copyIds: string[];
        currencies: TradeMoney[];
    };
    receive: {
        copyIds: string[];
        currencies: TradeMoney[];
    };
    versions: Record<string, number>;
    message: string;
}
export interface TradeDraft {
    getState(): TradeDraftState;
    subscribe(listener: (state: TradeDraftState) => void): () => void;
    load(recipientId: string | null): Promise<void>;
    more(side: TradeSide): Promise<void>;
    add(side: TradeSide, copyId: string): void;
    remove(side: TradeSide, copyId: string): void;
    setCurrency(side: TradeSide, currencyId: string, amount: number): void;
    setMessage(message: string): void;
    review(value?: boolean): void;
    buildOffer(): TradeDraftOffer;
    clear(): void;
    dispose(): void;
}
/** Headless visual trade draft. State is presentation only; the server owns every transfer. */
export declare function createTradeDraft({ client, userId, catalog, storage, namespace, initial, parentTradeId }: TradeDraftOptions): TradeDraft;
