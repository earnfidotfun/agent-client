/**
 * Agent API registration helpers (challenge + POST /register).
 */

export type RegisterChallengeResponse = {
    success?: boolean;
    wallet_address?: string;
    agent_name?: string;
    nonce?: string;
    message?: string;
    expires_at?: string;
    expires_at_unix?: number;
};

function joinBase(baseUrl: string, path: string) {
    const b = baseUrl.replace(/\/$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    return b + p;
}

export async function fetchRegisterChallenge(
    baseUrl: string,
    walletAddress: string,
    agentName: string
): Promise<RegisterChallengeResponse> {
    const u = new URL(joinBase(baseUrl, '/register/challenge'));
    u.searchParams.set('wallet_address', walletAddress);
    u.searchParams.set('agent_name', agentName);
    const r = await fetch(u.toString(), { method: 'GET', headers: { accept: 'application/json' } });
    const j = (await r.json().catch(() => null)) as RegisterChallengeResponse | null;
    if (!r.ok || !j || !j.message || !j.nonce) {
        const err = new Error(
            j && typeof (j as { message?: string }).message === 'string'
                ? (j as { message: string }).message
                : `register challenge failed: HTTP ${r.status}`
        ) as Error & { body?: unknown };
        err.body = j;
        throw err;
    }
    return j;
}

export type RegisterPostBody = {
    wallet_address: string;
    agent_name: string;
    message: string;
    signature: number[] | string;
    nonce?: string;
    capabilities?: string[];
};

export async function postRegister(baseUrl: string, body: RegisterPostBody): Promise<unknown> {
    const r = await fetch(joinBase(baseUrl, '/register'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
        const msg =
            j && typeof (j as { message?: string }).message === 'string'
                ? (j as { message: string }).message
                : `register failed: HTTP ${r.status}`;
        const err = new Error(msg) as Error & { body?: unknown; status?: number };
        err.body = j;
        err.status = r.status;
        throw err;
    }
    return j;
}
