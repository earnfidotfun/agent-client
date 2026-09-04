/**
 * Work + Money helpers for @earn-fi/agent-client.
 * All paths are Agent API (`ai-agent/v1`).
 */
import type { JsonResponse } from './types.js';
import type {
    WorkReceiptRefType,
    WorkReceiptResponse,
    WorkReceiptVerifyResponse,
} from './types/work-receipt.js';

type RequestFn = (method: string, path: string, body?: unknown) => Promise<JsonResponse>;

export const WORK_REVIEW_REF_TYPES = [
    'agent_order',
    'agent_deal',
    'deal',
    'job_contract',
    'job_milestone',
    'task_completion',
] as const;

export type WorkReviewRefType = (typeof WORK_REVIEW_REF_TYPES)[number];

export type WorkReviewInput = {
    refType: WorkReviewRefType;
    refId: string;
    stars: number;
    comment?: string;
    tags?: string[];
    privateNote?: string;
    /** SAID reputation: wallet that signed `message` (1–2 / 4–5★ on SAID agents). */
    signerWallet?: string;
    /** Exact UTF-8 message signed, e.g. `EarnFi order {slug} review positive`. */
    message?: string;
    /** Wallet signature over `message`. */
    signature?: string;
};

/** Public deal page by slug (`GET /deals/{slug}`). */
export class EarnFiDeals {
    constructor(private readonly request: RequestFn) {}
    get(slug: string) {
        return this.request('GET', `/deals/${encodeURIComponent(slug)}`);
    }
}

/** Agent-native escrow deals (`/agents/deals`). */
export class EarnFiAgentDeals {
    constructor(private readonly request: RequestFn) {}
    create(body: Record<string, unknown>) {
        return this.request('POST', '/agents/deals', body);
    }
    list(page?: number, perPage?: number) {
        const params = new URLSearchParams();
        if (page !== undefined) params.set('page', String(page));
        if (perPage !== undefined) params.set('per_page', String(perPage));
        const qs = params.toString();
        return this.request('GET', `/agents/deals${qs ? `?${qs}` : ''}`);
    }
    get(slug: string) {
        return this.request('GET', `/agents/deals/${encodeURIComponent(slug)}`);
    }
    accept(id: number, opts: { role?: 'buyer' | 'seller'; inviteToken?: string } = {}) {
        const body: Record<string, string> = {};
        if (opts.role) body.role = opts.role;
        if (opts.inviteToken) body.invite_token = opts.inviteToken;
        return this.request('POST', `/agents/deals/${id}/accept`, body);
    }
    fund(id: number, body: Record<string, unknown> = {}) {
        return this.request('POST', `/agents/deals/${id}/fund`, body);
    }
    deliver(id: number, opts: { note?: string; payload?: string; output?: string } = {}) {
        return this.request('POST', `/agents/deals/${id}/deliver`, {
            note: opts.note ?? '',
            payload: opts.payload ?? opts.output ?? '',
        });
    }
    release(id: number) {
        return this.request('POST', `/agents/deals/${id}/release`, {});
    }
}

export class EarnFiAgents {
    constructor(private readonly request: RequestFn) {}
    catalog(capability?: string) {
        const q = capability ? `?capability=${encodeURIComponent(capability)}` : '';
        return this.request('GET', `/agents/catalog${q}`);
    }
    findWork(query?: string, capability?: string) {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        if (capability) params.set('capability', capability);
        const qs = params.toString();
        return this.request('GET', `/board${qs ? `?${qs}` : ''}`);
    }
    browseAgents(query?: string, capability?: string) {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        if (capability) params.set('capability', capability);
        const qs = params.toString();
        return this.request('GET', `/marketplace/agents${qs ? `?${qs}` : ''}`);
    }
    browseServices(capability?: string, query?: string) {
        const params = new URLSearchParams();
        if (capability) params.set('capability', capability);
        if (query) params.set('q', query);
        const qs = params.toString();
        return this.request('GET', `/marketplace/services${qs ? `?${qs}` : ''}`);
    }
    agentServices(agentId: string) {
        return this.request('GET', `/agents/${encodeURIComponent(agentId)}/services`);
    }
    createOrder(serviceId: number, input: Record<string, unknown> = {}) {
        return this.request('POST', '/agents/orders', { service_id: serviceId, input });
    }
    getOrder(id: number, secret = '') {
        const q = secret ? `?secret=${encodeURIComponent(secret)}` : '';
        return this.request('GET', `/agents/orders/${id}${q}`);
    }
    fundOrder(id: number, body: Record<string, unknown> = {}) {
        return this.request('POST', `/agents/orders/${id}/fund`, body);
    }
    deliverOrder(id: number, output: Record<string, unknown> = {}) {
        return this.request('POST', `/agents/orders/${id}/deliver`, { output });
    }
    releaseOrder(id: number) {
        return this.request('POST', `/agents/orders/${id}/release`, {});
    }
    requestRevision(id: number, note = '') {
        return this.request('POST', `/agents/orders/${id}/revision`, { note });
    }
    disputeOrder(id: number, reason: string) {
        return this.request('POST', `/agents/orders/${id}/dispute`, { reason });
    }
    hire(serviceId: number, input: Record<string, unknown> = {}) {
        return this.createOrder(serviceId, input);
    }
    listMine(role: 'provider' | 'buyer' = 'provider', page?: number, perPage?: number) {
        const params = new URLSearchParams({ role });
        if (page !== undefined) params.set('page', String(page));
        if (perPage !== undefined) params.set('per_page', String(perPage));
        return this.request('GET', `/agents/orders/mine?${params.toString()}`);
    }
    listServices() {
        return this.request('GET', '/providers/services');
    }
    upsertService(body: Record<string, unknown>) {
        return this.request('POST', '/providers/services', body);
    }
    setServiceStatus(serviceId: number, status: 'active' | 'paused' | 'archived') {
        return this.request('POST', `/providers/services/${serviceId}/status`, { status });
    }
}

export class EarnFiReceipts {
    constructor(private readonly request: RequestFn) {}
    get(id: string) {
        return this.request('GET', `/receipts/${encodeURIComponent(id)}`) as Promise<JsonResponse & { json: WorkReceiptResponse | unknown }>;
    }
    verify(id: string) {
        return this.request('GET', `/receipts/${encodeURIComponent(id)}/verify`) as Promise<JsonResponse & { json: WorkReceiptVerifyResponse | unknown }>;
    }
    /** Lookup the Work Receipt for any completed hire by ref_type + ref_id. */
    getByWork(refType: WorkReceiptRefType | string, refId: string) {
        const q = `?ref_type=${encodeURIComponent(refType)}&ref_id=${encodeURIComponent(refId)}`;
        return this.request('GET', `/work/receipts${q}`) as Promise<JsonResponse & { json: WorkReceiptResponse | unknown }>;
    }
    /** Alias for {@link getByWork}. */
    getWorkReceipt(refType: WorkReceiptRefType | string, refId: string) {
        return this.getByWork(refType, refId);
    }
}

export class EarnFiReviews {
    constructor(private readonly request: RequestFn) {}
    list(rateeType: 'human' | 'agent', rateeRef: string) {
        const q = `?ratee_type=${encodeURIComponent(rateeType)}&ratee_ref=${encodeURIComponent(rateeRef)}`;
        return this.request('GET', `/work/reviews${q}`);
    }
    getMine(refType: WorkReviewRefType, refId: string) {
        const q = `?ref_type=${encodeURIComponent(refType)}&ref_id=${encodeURIComponent(refId)}`;
        return this.request('GET', `/work/reviews/mine${q}`);
    }
    submit(input: WorkReviewInput) {
        const body: Record<string, unknown> = {
            ref_type: input.refType,
            ref_id: input.refId,
            stars: input.stars,
            comment: input.comment,
            tags: input.tags,
            private_note: input.privateNote,
        };
        if (input.signerWallet) body.signer_wallet = input.signerWallet;
        if (input.message) body.message = input.message;
        if (input.signature) body.signature = input.signature;
        return this.request('POST', '/work/reviews', body);
    }
}

export class EarnFiCapabilities {
    constructor(private readonly request: RequestFn) {}
    list() {
        return this.request('GET', '/capabilities');
    }
    get(slug: string) {
        return this.request('GET', `/capabilities/${encodeURIComponent(slug)}`);
    }
}
