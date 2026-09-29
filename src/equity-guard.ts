/**
 * Equity Guard — tokenized equity safety (Agent API `ai-agent/v1/equity/*`).
 */
import type { JsonResponse } from './types.js';

type RequestFn = (method: string, path: string, body?: unknown) => Promise<JsonResponse>;

export type EquityTradeDecision = 'ALLOW' | 'WARN' | 'BLOCK';

export type EquityTradeEvaluation = {
    decision: EquityTradeDecision;
    risk?: string;
    score?: number;
    mode?: 'preview' | 'authorization';
    persisted?: boolean;
    environment?: 'production' | 'demo' | 'lab';
    receipt_id?: string | null;
    expires_at?: string | null;
    reason_codes?: string[];
    checks?: Record<string, string>;
    quote_fingerprint?: string;
    latency_ms?: number;
};

export type EquityExecutionConfirmResult = {
    success: boolean;
    receipt_id: string;
    signature: string;
    idempotent?: boolean;
};

export type EquityCheckTradeInput = {
    asset_mint: string;
    side: 'buy' | 'sell';
    amount_usd: number;
    wallet?: string;
    policy_id?: number;
};

export type EquityProtectInput = {
    wallet: string;
    min_position_usd?: number;
    max_check_usd?: number;
};

/** Fields on asset search/detail payloads (trust layer for Markets + agents). */
export type EquityAssetMarketFields = {
    display_price_usd?: number | null;
    onchain_price_usd?: number | null;
    onchain_price_raw_usd?: number | null;
    onchain_price_trusted?: boolean;
    reference_price_usd?: number | null;
    guard_signal?: string;
    guard_signal_detail?: string;
    price_confidence?: string;
    price_confidence_reasons?: string[];
    gap_pct?: number | null;
    difference_usd?: number | null;
    price_integrity?: {
        listed_usd?: number | null;
        onchain_usd?: number | null;
        onchain_raw_usd?: number | null;
        onchain_trusted?: boolean;
        pyth_usd?: number | null;
        difference_usd?: number | null;
        difference_pct?: number | null;
        freshness_sec?: number | null;
        sources?: string[];
        confidence?: string;
        confidence_reasons?: string[];
    };
    triangulation?: {
        listed_price?: number | null;
        onchain_price?: number | null;
        onchain_price_raw?: number | null;
        onchain_trusted?: boolean;
        pyth_price?: number | null;
        difference_usd?: number | null;
        difference_pct?: number | null;
        sources?: string[];
        confidence?: string;
        confidence_reasons?: string[];
    };
};

/** Equity Guard facade — separate section on {@link EarnFiAgentClient}. */
export class EarnFiEquityGuard {
    constructor(private readonly request: RequestFn) {}

    searchAssets(opts: { q?: string; tier?: string; page?: number; perPage?: number } = {}) {
        const params = new URLSearchParams();
        if (opts.q) params.set('q', opts.q);
        if (opts.tier) params.set('tier', opts.tier);
        if (opts.page !== undefined) params.set('page', String(opts.page));
        if (opts.perPage !== undefined) params.set('per_page', String(opts.perPage));
        const qs = params.toString();
        return this.request('GET', `/equity/assets/search${qs ? `?${qs}` : ''}`);
    }

    getAsset(mint: string) {
        return this.request('GET', `/equity/assets/${encodeURIComponent(mint)}`);
    }

    getPassport(mint: string) {
        return this.request('GET', `/equity/assets/${encodeURIComponent(mint)}/passport`);
    }

    getLiquidity(mint: string, amountUsd = 100) {
        const params = new URLSearchParams({ amount_usd: String(amountUsd) });
        return this.request('GET', `/equity/assets/${encodeURIComponent(mint)}/liquidity?${params}`);
    }

    getMarketState() {
        return this.request('GET', '/equity/market/state');
    }

    getPublicStats() {
        return this.request('GET', '/equity/stats/public');
    }

    previewTrade(body: Pick<EquityCheckTradeInput, 'asset_mint' | 'side' | 'amount_usd' | 'wallet' | 'policy_id'>) {
        return this.request('POST', '/equity/trades/preview', body);
    }

    authorizeTrade(body: EquityCheckTradeInput) {
        return this.request('POST', '/equity/trades/check', body);
    }

    /** @deprecated Use authorizeTrade — persists a receipt. */
    checkTrade(body: EquityCheckTradeInput) {
        return this.authorizeTrade(body);
    }

    simulateTrade(body: Pick<EquityCheckTradeInput, 'asset_mint' | 'side' | 'amount_usd'>) {
        return this.request('POST', '/equity/trades/simulate', body);
    }

    prepareExecution(body: {
        receipt_id: string;
        asset_mint: string;
        side: 'buy' | 'sell';
        amount_usd: number;
        wallet: string;
        slippage_bps?: number;
    }) {
        return this.request('POST', '/equity/trades/prepare-execute', {
            ...body,
            userPublicKey: body.wallet,
        });
    }

    confirmExecution(body: { receipt_id: string; signature: string; wallet: string }) {
        return this.request('POST', '/equity/trades/confirm-execute', {
            ...body,
            userPublicKey: body.wallet,
        });
    }

    verifyReceipt(receiptId: string) {
        return this.getReceipt(receiptId);
    }

    getReceipt(receiptId: string) {
        return this.request('GET', `/equity/receipts/${encodeURIComponent(receiptId)}`);
    }

    getCircuitBreaker(mint: string) {
        return this.request('GET', `/equity/circuit-breaker/${encodeURIComponent(mint)}`);
    }

    getPortfolio(wallet: string) {
        const params = new URLSearchParams({ wallet });
        return this.request('GET', `/equity/portfolio?${params}`);
    }

    protectPortfolio(body: EquityProtectInput) {
        return this.request('POST', '/equity/portfolio/protect', body);
    }

    listCorporateActions(opts: { underlyingId?: number; ticker?: string } = {}) {
        const params = new URLSearchParams();
        if (opts.underlyingId !== undefined) params.set('underlying_id', String(opts.underlyingId));
        if (opts.ticker) params.set('ticker', opts.ticker);
        const qs = params.toString();
        return this.request('GET', `/equity/corporate-actions${qs ? `?${qs}` : ''}`);
    }
}
