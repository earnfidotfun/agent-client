import type { Connection } from '@solana/web3.js';
import type {
    AgentClientOptions,
    JobAuth,
    JsonResponse,
    TokenGateInput,
    WalletLike,
    X402Challenge,
    X402Response,
} from './types.js';
import { EARNFI_DEFAULT_API_BASE } from './types.js';
import type { JobCreatedResponse, RegisterSuccessResponse } from './types/api.js';
import { b64decodeJson, b64encodeJson, getPaymentRequiredHeader, signExactSvmPayment } from './x402.js';
import { fetchRegisterChallenge, postRegister } from './register.js';
import { assertPreflightPayment, preflightPayment as runPreflightPayment } from './preflight.js';
import { pollUntil } from './poll.js';

function tokenGateParam(gate?: TokenGateInput): string | undefined {
    if (gate === undefined || gate === null) return undefined;
    return typeof gate === 'string' ? gate : JSON.stringify(gate);
}

function paramsToRecord(params?: Record<string, string | number | boolean | undefined>): Record<string, string | undefined> {
    if (!params) return {};
    const out: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '') continue;
        out[k] = String(v);
    }
    return out;
}

async function parseFetchResponse(r: Response): Promise<JsonResponse> {
    const t = await r.text();
    let j: unknown = null;
    try {
        j = t ? JSON.parse(t) : null;
    } catch {
        j = { raw: t };
    }
    return { status: r.status, headers: r.headers, json: j };
}

/**
 * TypeScript client for the EarnFi Agent API (`ai-agent/v1`).
 * Covers discovery, x402 paid creates, polling, and creator actions per OpenAPI.
 */
export class EarnFiAgentClient {
    readonly baseUrl: string;
    agentToken?: string;
    readonly wallet?: WalletLike;
    readonly connection?: Connection;
    private readonly fetchImpl: typeof fetch;
    private readonly preferAgentTokenHeader: boolean;
    /** Skip USDC preflight before signing (default false) */
    readonly skipPaymentPreflight: boolean;

    constructor(opts: AgentClientOptions = {}) {
        this.baseUrl = (opts.baseUrl ?? EARNFI_DEFAULT_API_BASE).replace(/\/$/, '');
        this.agentToken = opts.agentToken;
        this.wallet = opts.wallet;
        this.connection = opts.connection;
        this.fetchImpl = opts.fetchImpl ?? fetch;
        this.preferAgentTokenHeader = opts.preferAgentTokenHeader !== false;
        this.skipPaymentPreflight = opts.skipPaymentPreflight === true;
    }

    private resolveAgentToken(override?: string): string {
        const token = override ?? this.agentToken;
        if (!token) throw new Error('agent_token required — pass agentToken in constructor, register(), or per-call auth');
        return token;
    }

    private buildUrl(path: string, params?: Record<string, string | undefined>): string {
        const normalized = path.startsWith('/') ? path.slice(1) : path;
        const u = new URL(normalized, this.baseUrl + '/');
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined && v !== '') u.searchParams.set(k, v);
            }
        }
        return u.toString();
    }

    /** Auth for agent_token routes: always send headers; optionally also query. */
    private mergeAuth(
        token: string,
        params: Record<string, string | undefined> = {}
    ): { headers: Record<string, string>; params: Record<string, string | undefined> } {
        const headers: Record<string, string> = {
            Accept: 'application/json',
            'Agent-Token': token,
            'X-Agent-Token': token,
        };
        const merged = { ...params };
        if (!this.preferAgentTokenHeader) {
            merged.agent_token = token;
        }
        return { headers, params: merged };
    }

    private agentHeaders(token?: string): Record<string, string> {
        const t = token ?? this.agentToken;
        if (!t) return { Accept: 'application/json' };
        return { Accept: 'application/json', 'Agent-Token': t, 'X-Agent-Token': t };
    }

    private withAgentQuery(
        params: Record<string, string | undefined> = {},
        token?: string
    ): Record<string, string | undefined> {
        const t = token ?? this.agentToken;
        if (!t || this.preferAgentTokenHeader) return params;
        return { ...params, agent_token: t };
    }

    private jobAuthParams(auth: JobAuth = {}): Record<string, string | undefined> {
        if (auth.secret) return { secret: auth.secret };
        const token = auth.agentToken ?? this.agentToken;
        if (!token) throw new Error('Job read requires secret or agent_token');
        return this.withAgentQuery({}, token);
    }

    private jobAuthHeaders(auth: JobAuth = {}): Record<string, string> {
        if (auth.secret) return { Accept: 'application/json' };
        const token = auth.agentToken ?? this.agentToken;
        if (!token) throw new Error('Job read requires secret or agent_token');
        return this.agentHeaders(token);
    }

    async fetchJson(input: string, init?: RequestInit): Promise<JsonResponse> {
        const r = await this.fetchImpl(input, init);
        return parseFetchResponse(r);
    }

    async get(path: string, params?: Record<string, string | undefined>, headers?: Record<string, string>) {
        return this.fetchJson(this.buildUrl(path, params), {
            method: 'GET',
            headers: { Accept: 'application/json', ...headers },
        });
    }

    async post(
        path: string,
        body?: unknown,
        params?: Record<string, string | undefined>,
        headers?: Record<string, string>
    ) {
        return this.fetchJson(this.buildUrl(path, params), {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...headers,
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    }

    /** GET quote only (402, no wallet). */
    async quoteGet(path: string, params: Record<string, string | undefined> = {}, token?: string): Promise<X402Response> {
        const t = token ?? this.agentToken;
        const auth = t ? this.mergeAuth(t, params) : { headers: { Accept: 'application/json' }, params };
        const r = await this.fetchImpl(this.buildUrl(path, auth.params), {
            method: 'GET',
            headers: auth.headers,
        });
        const parsed = await parseFetchResponse(r);
        if (parsed.status !== 402) return parsed;
        const header = getPaymentRequiredHeader(parsed.headers);
        if (!header) return parsed;
        const challenge = b64decodeJson<X402Challenge>(header);
        return { ...parsed, paymentRequired: challenge };
    }

    /** GET with 402 → preflight → sign → retry with PAYMENT-SIGNATURE (+ auth on both hops). */
    async x402Get(path: string, params: Record<string, string | undefined> = {}, token?: string): Promise<X402Response> {
        const t = this.resolveAgentToken(token);
        const auth = this.mergeAuth(t, params);
        const url = this.buildUrl(path, auth.params);

        const r1 = await this.fetchImpl(url, { method: 'GET', headers: auth.headers });
        const parsed1 = await parseFetchResponse(r1);
        if (parsed1.status !== 402) return parsed1;

        const header = getPaymentRequiredHeader(parsed1.headers);
        if (!header) throw new Error(`402 without PAYMENT-REQUIRED header`);

        const challenge = b64decodeJson<X402Challenge>(header);
        const accept = challenge.accepts?.[0];
        if (!accept) throw new Error('402 challenge missing accepts[0]');

        if (!this.wallet || !this.connection) {
            throw new Error(
                'Paid creates require wallet + connection. Install @solana/web3.js and @solana/spl-token.'
            );
        }

        if (!this.skipPaymentPreflight) {
            await assertPreflightPayment({
                wallet: this.wallet,
                connection: this.connection,
                requirements: accept,
            });
        }

        const paymentSig = await signExactSvmPayment(accept, {
            wallet: this.wallet,
            connection: this.connection,
        });

        const r2 = await this.fetchImpl(url, {
            method: 'GET',
            headers: {
                ...auth.headers,
                'PAYMENT-SIGNATURE': b64encodeJson(paymentSig),
            },
        });
        const parsed2 = await parseFetchResponse(r2);
        return { ...parsed2, paymentRequired: challenge };
    }

    /** POST with 402 → preflight → sign → retry (same JSON body + auth on both hops). */
    async x402Post(path: string, body: Record<string, unknown>, token?: string): Promise<X402Response> {
        const t = this.resolveAgentToken(token);
        const bodyWithToken = { ...body, agent_token: t };
        const authHeaders = this.agentHeaders(t);
        const url = this.buildUrl(path);

        const r1 = await this.fetchImpl(url, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyWithToken),
        });
        const parsed1 = await parseFetchResponse(r1);
        if (parsed1.status !== 402) return parsed1;

        const header = getPaymentRequiredHeader(parsed1.headers);
        if (!header) throw new Error(`402 without PAYMENT-REQUIRED header`);

        const challenge = b64decodeJson<X402Challenge>(header);
        const accept = challenge.accepts?.[0];
        if (!accept) throw new Error('402 challenge missing accepts[0]');

        if (!this.wallet || !this.connection) {
            throw new Error('Paid creates require wallet + connection.');
        }

        if (!this.skipPaymentPreflight) {
            await assertPreflightPayment({
                wallet: this.wallet,
                connection: this.connection,
                requirements: accept,
            });
        }

        const paymentSig = await signExactSvmPayment(accept, {
            wallet: this.wallet,
            connection: this.connection,
        });

        const r2 = await this.fetchImpl(url, {
            method: 'POST',
            headers: {
                ...authHeaders,
                'Content-Type': 'application/json',
                'PAYMENT-SIGNATURE': b64encodeJson(paymentSig),
            },
            body: JSON.stringify(bodyWithToken),
        });
        const parsed2 = await parseFetchResponse(r2);
        return { ...parsed2, paymentRequired: challenge };
    }

    /** @deprecated Use {@link x402Get} */
    async x402Fetch(url: string): Promise<X402Response> {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            const u = new URL(url);
            const path = u.pathname.replace(/^\/api\/ai-agent\/v1\/?/, '/');
            const params: Record<string, string> = {};
            u.searchParams.forEach((v, k) => {
                params[k] = v;
            });
            return this.x402Get(path.startsWith('/') ? path : '/' + path, params);
        }
        return this.x402Get(url);
    }

    // ── Registration ────────────────────────────────────────────────────────

    async register(opts: {
        agentName: string;
        walletAddress: string;
        signMessage: (message: string) => Promise<Uint8Array | number[] | string>;
    }): Promise<{ agentId: string; agentToken: string }> {
        const ch = await fetchRegisterChallenge(this.baseUrl, opts.walletAddress, opts.agentName);
        const sig = await opts.signMessage(ch.message!);
        const res = (await postRegister(this.baseUrl, {
            wallet_address: opts.walletAddress,
            agent_name: opts.agentName,
            message: ch.message!,
            signature: sig,
            nonce: ch.nonce,
        })) as RegisterSuccessResponse;

        const agentToken = res.agent_token;
        const agentId = res.agent_id;
        if (!agentToken || !agentId) {
            throw new Error('Register response missing agent_token or agent_id');
        }
        this.agentToken = agentToken;
        return { agentId, agentToken };
    }

    /** Use existing agentToken or register when missing. */
    async registerIfNeeded(opts: {
        agentName: string;
        walletAddress: string;
        signMessage: (message: string) => Promise<Uint8Array | number[] | string>;
    }): Promise<{ agentId: string; agentToken: string; registered: boolean }> {
        if (this.agentToken) {
            return { agentId: '', agentToken: this.agentToken, registered: false };
        }
        const out = await this.register(opts);
        return { ...out, registered: true };
    }

    /** Check USDC readiness without signing. Facilitator covers tx fees; fund wallet with USDC if ATA missing. */
    preflightPayment(requirements?: import('./types.js').X402Accept) {
        if (!this.wallet || !this.connection) {
            throw new Error('preflightPayment requires wallet + connection');
        }
        return runPreflightPayment({
            wallet: this.wallet,
            connection: this.connection,
            requirements,
        });
    }

    // ── Discovery ───────────────────────────────────────────────────────────

    getCatalog() {
        return this.get('/catalog');
    }

    postCatalog() {
        return this.post('/catalog', {});
    }

    getX402Preview(agentToken?: string) {
        const t = agentToken ?? this.agentToken;
        if (t) return this.quoteGet('/x402', {}, t);
        return this.quoteGet('/x402');
    }

    // ── Paid creates (x402 GET) ─────────────────────────────────────────────

    quoteSocialJob(params: {
        taskType: string;
        slots: number;
        rewardPerUser: string;
        executionMode?: 'human';
        contentUrl?: string;
        title?: string;
        agentToken?: string;
    }) {
        const token = this.resolveAgentToken(params.agentToken);
        return this.quoteGet(
            '/jobs/social',
            paramsToRecord({
                task_type: params.taskType,
                slots: params.slots,
                reward_per_user: params.rewardPerUser,
                execution_mode: params.executionMode ?? 'human',
                content_url: params.contentUrl,
                title: params.title,
            }),
            token
        );
    }

    createSocialJob(params: {
        taskType: string;
        slots: number;
        rewardPerUser: string;
        executionMode?: 'human';
        quick?: boolean;
        contentUrl?: string;
        title?: string;
        tokenGate?: TokenGateInput;
        xAccountRequirement?: 'all' | 'verified_only' | 'verified';
        requiresVerifiedX?: boolean;
        agentToken?: string;
    }) {
        const token = this.resolveAgentToken(params.agentToken);
        return this.x402Get(
            '/jobs/social',
            paramsToRecord({
                task_type: params.taskType,
                slots: params.slots,
                reward_per_user: params.rewardPerUser,
                execution_mode: params.executionMode ?? 'human',
                quick: params.quick ? 'true' : undefined,
                content_url: params.contentUrl,
                title: params.title,
                token_gate: tokenGateParam(params.tokenGate),
                x_account_requirement: params.xAccountRequirement,
                requires_verified_x: params.requiresVerifiedX,
            }),
            token
        );
    }

    createSocialJobPost(params: {
        taskType: string;
        slots: number;
        rewardPerUser: string;
        executionMode?: 'human';
        contentUrl?: string;
        title?: string;
        tokenGate?: TokenGateInput;
        agentToken?: string;
    }) {
        const token = this.resolveAgentToken(params.agentToken);
        return this.x402Post(
            '/jobs/social',
            {
                task_type: params.taskType,
                slots: params.slots,
                reward_per_user: params.rewardPerUser,
                execution_mode: params.executionMode ?? 'human',
                content_url: params.contentUrl,
                title: params.title,
                token_gate: tokenGateParam(params.tokenGate),
            },
            token
        );
    }

    createManualJob(params: {
        title: string;
        instructions: string;
        slots: number;
        rewardPerUser: string;
        verificationMethod?: 'manual' | 'auto';
        executionMode?: 'human';
        tokenGate?: TokenGateInput;
        agentToken?: string;
    }) {
        const token = this.resolveAgentToken(params.agentToken);
        return this.x402Get(
            '/jobs/manual',
            paramsToRecord({
                title: params.title,
                instructions: params.instructions,
                slots: params.slots,
                reward_per_user: params.rewardPerUser,
                verification_method: params.verificationMethod ?? 'manual',
                execution_mode: params.executionMode ?? 'human',
                token_gate: tokenGateParam(params.tokenGate),
            }),
            token
        );
    }

    createManualJobPost(params: {
        title: string;
        instructions: string;
        slots: number;
        rewardPerUser: string;
        verificationMethod?: 'manual' | 'auto';
        tokenGate?: TokenGateInput;
        agentToken?: string;
    }) {
        const token = this.resolveAgentToken(params.agentToken);
        return this.x402Post(
            '/jobs/manual',
            {
                title: params.title,
                instructions: params.instructions,
                slots: params.slots,
                reward_per_user: params.rewardPerUser,
                verification_method: params.verificationMethod ?? 'manual',
                token_gate: tokenGateParam(params.tokenGate),
            },
            token
        );
    }

    createContestJob(params: {
        title: string;
        instructions: string;
        totalPrizePool: string;
        tokenGate?: TokenGateInput;
        agentToken?: string;
    }) {
        const token = this.resolveAgentToken(params.agentToken);
        return this.x402Get(
            '/jobs/contest',
            paramsToRecord({
                title: params.title,
                instructions: params.instructions,
                total_prize_pool: params.totalPrizePool,
                token_gate: tokenGateParam(params.tokenGate),
            }),
            token
        );
    }

    createContestJobPost(params: {
        title: string;
        instructions: string;
        totalPrizePool: string;
        tokenGate?: TokenGateInput;
        agentToken?: string;
    }) {
        const token = this.resolveAgentToken(params.agentToken);
        return this.x402Post(
            '/jobs/contest',
            {
                title: params.title,
                instructions: params.instructions,
                total_prize_pool: params.totalPrizePool,
                token_gate: tokenGateParam(params.tokenGate),
            },
            token
        );
    }

    createInterrupt(params: {
        question: string;
        slots: number;
        rewardPerUser: string;
        agentToken?: string;
    }) {
        const token = this.resolveAgentToken(params.agentToken);
        return this.x402Get(
            '/interrupt',
            paramsToRecord({
                question: params.question,
                slots: params.slots,
                reward_per_user: params.rewardPerUser,
            }),
            token
        );
    }

    createInterruptPost(params: {
        question: string;
        slots: number;
        rewardPerUser: string;
        agentToken?: string;
    }) {
        const token = this.resolveAgentToken(params.agentToken);
        return this.x402Post(
            '/interrupt',
            {
                question: params.question,
                slots: params.slots,
                reward_per_user: params.rewardPerUser,
            },
            token
        );
    }

    // ── Polling ─────────────────────────────────────────────────────────────

    getJob(jobId: string, auth: JobAuth = {}) {
        return this.get(
            `/jobs/${encodeURIComponent(jobId)}`,
            this.jobAuthParams(auth),
            this.jobAuthHeaders(auth)
        );
    }

    listSubmissions(jobId: string, auth: JobAuth = {}) {
        return this.get(
            `/jobs/${encodeURIComponent(jobId)}/submissions`,
            this.jobAuthParams(auth),
            this.jobAuthHeaders(auth)
        );
    }

    listJobSubmissions(jobId: string, auth: JobAuth = {}) {
        return this.listSubmissions(jobId, auth);
    }

    listCompletions(jobId: string, auth: JobAuth = {}) {
        return this.get(
            `/jobs/${encodeURIComponent(jobId)}/completions`,
            this.jobAuthParams(auth),
            this.jobAuthHeaders(auth)
        );
    }

    getInterruptStatus(interruptId: string, auth: JobAuth = {}) {
        return this.get(
            `/interrupt/${encodeURIComponent(interruptId)}`,
            this.jobAuthParams(auth),
            this.jobAuthHeaders(auth)
        );
    }

    waitForSubmissions(
        jobId: string,
        auth: JobAuth = {},
        opts?: { intervalMs?: number; timeoutMs?: number; minCount?: number }
    ) {
        const min = opts?.minCount ?? 1;
        return pollUntil(() => this.listSubmissions(jobId, auth), {
            intervalMs: opts?.intervalMs,
            timeoutMs: opts?.timeoutMs,
            until: (r) => {
                if (r.status !== 200) return false;
                const j = r.json as { submissions?: unknown[]; data?: unknown[] } | null;
                const list = j?.submissions ?? j?.data;
                return Array.isArray(list) && list.length >= min;
            },
        });
    }

    pollUntilComplete(jobId: string, auth: JobAuth = {}, opts?: { intervalMs?: number; timeoutMs?: number }) {
        return pollUntil(() => this.getJob(jobId, auth), {
            intervalMs: opts?.intervalMs,
            timeoutMs: opts?.timeoutMs,
            until: (r) => {
                if (r.status !== 200) return false;
                const j = r.json as { status?: string } | null;
                const s = (j?.status || '').toLowerCase();
                return s === 'completed' || s === 'complete' || s === 'closed' || s === 'expired';
            },
        });
    }

    // ── Creator actions ─────────────────────────────────────────────────────

    pauseJob(jobId: string, agentToken?: string) {
        const token = this.resolveAgentToken(agentToken);
        return this.post(
            `/jobs/${encodeURIComponent(jobId)}/pause`,
            { agent_token: token },
            undefined,
            this.agentHeaders(token)
        );
    }

    listPendingVerifications(jobId: string, agentToken?: string) {
        const token = this.resolveAgentToken(agentToken);
        const auth = this.mergeAuth(token, {});
        return this.get(`/jobs/${encodeURIComponent(jobId)}/verifications`, auth.params, auth.headers);
    }

    approveVerification(verificationId: string, agentToken?: string) {
        const token = this.resolveAgentToken(agentToken);
        return this.post(
            `/verifications/${encodeURIComponent(verificationId)}/approve`,
            { agent_token: token },
            undefined,
            this.agentHeaders(token)
        );
    }

    rejectVerification(verificationId: string, opts: { reason?: string; agentToken?: string } = {}) {
        const token = this.resolveAgentToken(opts.agentToken);
        return this.post(
            `/verifications/${encodeURIComponent(verificationId)}/reject`,
            { agent_token: token, ...(opts.reason ? { reason: opts.reason } : {}) },
            undefined,
            this.agentHeaders(token)
        );
    }

    listContestSubmissions(jobId: string, agentToken?: string) {
        const token = this.resolveAgentToken(agentToken);
        const auth = this.mergeAuth(token, {});
        return this.get(`/jobs/${encodeURIComponent(jobId)}/contest/submissions`, auth.params, auth.headers);
    }

    markContestWinner(
        jobId: string,
        params: { submissionId: string; rankPosition?: number; agentToken?: string }
    ) {
        const token = this.resolveAgentToken(params.agentToken);
        return this.post(
            `/jobs/${encodeURIComponent(jobId)}/contest/mark-winner`,
            {
                agent_token: token,
                submission_id: params.submissionId,
                ...(params.rankPosition !== undefined ? { rank_position: params.rankPosition } : {}),
            },
            undefined,
            this.agentHeaders(token)
        );
    }

    getCreatorJobDetail(jobId: string, agentToken?: string) {
        const token = this.resolveAgentToken(agentToken);
        const auth = this.mergeAuth(token, {});
        return this.get(`/jobs/${encodeURIComponent(jobId)}/detail`, auth.params, auth.headers);
    }

    listJobParticipants(jobId: string, agentToken?: string) {
        const token = this.resolveAgentToken(agentToken);
        const auth = this.mergeAuth(token, {});
        return this.get(`/jobs/${encodeURIComponent(jobId)}/users`, auth.params, auth.headers);
    }

    listJobPayments(jobId: string, agentToken?: string) {
        const token = this.resolveAgentToken(agentToken);
        const auth = this.mergeAuth(token, {});
        return this.get(`/jobs/${encodeURIComponent(jobId)}/payments`, auth.params, auth.headers);
    }
}

/** @deprecated Use {@link EarnFiAgentClient} */
export { EarnFiAgentClient as EarnFiHttpClient };

export type EarnFiHttpClientConfig = AgentClientOptions;
export type EarnFiWalletLike = WalletLike;

export type { JobCreatedResponse, RegisterSuccessResponse };
