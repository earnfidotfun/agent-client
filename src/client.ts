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
import { b64decodeJson, b64encodeJson, getPaymentRequiredHeader, signExactSvmPayment } from './x402.js';

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

/**
 * TypeScript client for the EarnFi Agent API (`ai-agent/v1`).
 * Covers discovery, x402 paid creates, polling, and creator actions per OpenAPI.
 */
export class EarnFiAgentClient {
    readonly baseUrl: string;
    readonly agentToken?: string;
    readonly wallet?: WalletLike;
    readonly connection?: Connection;
    private readonly fetchImpl: typeof fetch;
    private readonly preferAgentTokenHeader: boolean;

    constructor(opts: AgentClientOptions = {}) {
        this.baseUrl = (opts.baseUrl ?? EARNFI_DEFAULT_API_BASE).replace(/\/$/, '');
        this.agentToken = opts.agentToken;
        this.wallet = opts.wallet;
        this.connection = opts.connection;
        this.fetchImpl = opts.fetchImpl ?? fetch;
        this.preferAgentTokenHeader = opts.preferAgentTokenHeader !== false;
    }

    private resolveAgentToken(override?: string): string {
        const token = override ?? this.agentToken;
        if (!token) throw new Error('agent_token required — pass agentToken in constructor or per-call auth');
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

    private agentHeaders(token?: string): Record<string, string> {
        const t = token ?? this.agentToken;
        if (!t || !this.preferAgentTokenHeader) return {};
        return { 'Agent-Token': t };
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
        if (auth.secret) return {};
        const token = auth.agentToken ?? this.agentToken;
        if (!token) throw new Error('Job read requires secret or agent_token');
        return this.agentHeaders(token);
    }

    async fetchJson(input: string, init?: RequestInit): Promise<JsonResponse> {
        const r = await this.fetchImpl(input, init);
        const t = await r.text();
        let j: unknown = null;
        try {
            j = t ? JSON.parse(t) : null;
        } catch {
            j = { raw: t };
        }
        return { status: r.status, headers: r.headers, json: j };
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

    /** GET that returns 402 quote without signing or paying. */
    async quoteGet(path: string, params?: Record<string, string | undefined>): Promise<X402Response> {
        const parsed = await this.get(path, params);
        if (parsed.status !== 402) return parsed;

        const header = getPaymentRequiredHeader(parsed.headers);
        if (!header) return parsed;

        const challenge = b64decodeJson<X402Challenge>(header);
        return { ...parsed, paymentRequired: challenge };
    }

    /** GET with 402 → sign USDC tx → retry with PAYMENT-SIGNATURE. */
    async x402Get(path: string, params?: Record<string, string | undefined>): Promise<X402Response> {
        const url = this.buildUrl(path, params);
        const r1 = await this.fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } });
        if (r1.status !== 402) {
            const t = await r1.text();
            let j: unknown = null;
            try {
                j = t ? JSON.parse(t) : null;
            } catch {
                j = { raw: t };
            }
            return { status: r1.status, headers: r1.headers, json: j };
        }

        const header = getPaymentRequiredHeader(r1.headers);
        if (!header) {
            const t = await r1.text();
            throw new Error(`402 without PAYMENT-REQUIRED header: ${t}`);
        }

        const challenge = b64decodeJson<X402Challenge>(header);
        const accept = challenge.accepts?.[0];
        if (!accept) throw new Error('402 challenge missing accepts[0]');

        if (!this.wallet || !this.connection) {
            throw new Error(
                'Paid creates require wallet + connection in EarnFiAgentClient options. ' +
                    'Install @solana/web3.js and @solana/spl-token.'
            );
        }

        const paymentSig = await signExactSvmPayment(accept, {
            wallet: this.wallet,
            connection: this.connection,
        });
        const r2 = await this.fetchImpl(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'PAYMENT-SIGNATURE': b64encodeJson(paymentSig),
            },
        });
        const t2 = await r2.text();
        let j2: unknown = null;
        try {
            j2 = t2 ? JSON.parse(t2) : null;
        } catch {
            j2 = { raw: t2 };
        }
        return { status: r2.status, headers: r2.headers, json: j2, paymentRequired: challenge };
    }

    /** @deprecated Use {@link x402Get} — kept for backward compatibility */
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

    // ── Discovery ───────────────────────────────────────────────────────────

    getCatalog() {
        return this.get('/catalog');
    }

    getX402Preview() {
        return this.quoteGet('/x402');
    }

    // ── Paid creates (x402) ───────────────────────────────────────────────────

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
            this.withAgentQuery(
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
            )
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
            this.withAgentQuery(
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
            )
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
            this.withAgentQuery(
                paramsToRecord({
                    title: params.title,
                    instructions: params.instructions,
                    total_prize_pool: params.totalPrizePool,
                    token_gate: tokenGateParam(params.tokenGate),
                }),
                token
            )
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
            this.withAgentQuery(
                paramsToRecord({
                    question: params.question,
                    slots: params.slots,
                    reward_per_user: params.rewardPerUser,
                }),
                token
            )
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

    /** Alias for {@link listSubmissions} */
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
        return this.get(
            `/jobs/${encodeURIComponent(jobId)}/verifications`,
            this.withAgentQuery({}, token),
            this.agentHeaders(token)
        );
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
        return this.get(
            `/jobs/${encodeURIComponent(jobId)}/contest/submissions`,
            this.withAgentQuery({}, token),
            this.agentHeaders(token)
        );
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
        return this.get(
            `/jobs/${encodeURIComponent(jobId)}/detail`,
            this.withAgentQuery({}, token),
            this.agentHeaders(token)
        );
    }

    listJobParticipants(jobId: string, agentToken?: string) {
        const token = this.resolveAgentToken(agentToken);
        return this.get(
            `/jobs/${encodeURIComponent(jobId)}/users`,
            this.withAgentQuery({}, token),
            this.agentHeaders(token)
        );
    }

    listJobPayments(jobId: string, agentToken?: string) {
        const token = this.resolveAgentToken(agentToken);
        return this.get(
            `/jobs/${encodeURIComponent(jobId)}/payments`,
            this.withAgentQuery({}, token),
            this.agentHeaders(token)
        );
    }
}

/** @deprecated Use {@link EarnFiAgentClient} */
export { EarnFiAgentClient as EarnFiHttpClient };

export type EarnFiHttpClientConfig = AgentClientOptions;
export type EarnFiWalletLike = WalletLike;
