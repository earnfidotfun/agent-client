/**
 * Agent API registration helpers (challenge + POST /register).
 */
import bs58 from 'bs58';

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
    signature: number[] | string | Uint8Array;
    nonce?: string;
    capabilities?: string[];
};

/** Normalize Ed25519 signature to OpenAPI-accepted forms (array, base58, hex, base64). */
export function normalizeEd25519Signature(sig: Uint8Array | number[] | string): number[] | string {
    if (typeof sig === 'string') {
        const s = sig.trim();
        if (/^[0-9a-fA-F]{128}$/.test(s)) {
            const bytes = new Uint8Array(64);
            for (let i = 0; i < 64; i++) bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
            return Array.from(bytes);
        }
        if (s.startsWith('[')) {
            try {
                const arr = JSON.parse(s) as number[];
                if (Array.isArray(arr) && arr.length === 64) return arr;
            } catch {
                /* fall through */
            }
        }
        try {
            const decoded = bs58.decode(s);
            if (decoded.length === 64) return Array.from(decoded);
        } catch {
            /* fall through */
        }
        return s;
    }
    if (sig instanceof Uint8Array) return Array.from(sig);
    return sig;
}

export async function postRegister(baseUrl: string, body: RegisterPostBody): Promise<unknown> {
    const payload = {
        ...body,
        signature: normalizeEd25519Signature(body.signature as Uint8Array | number[] | string),
    };
    const r = await fetch(joinBase(baseUrl, '/register'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
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

export async function postRegisterChallenge(
    baseUrl: string,
    walletAddress: string,
    agentName: string
): Promise<RegisterChallengeResponse> {
    const r = await fetch(joinBase(baseUrl, '/register/challenge'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ wallet_address: walletAddress, agent_name: agentName }),
    });
    const j = (await r.json().catch(() => null)) as RegisterChallengeResponse | null;
    if (!r.ok || !j?.message || !j.nonce) {
        throw new Error(`register challenge POST failed: HTTP ${r.status}`);
    }
    return j;
}
