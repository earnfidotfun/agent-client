import type { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

export const EARNFI_DEFAULT_API_BASE = 'https://app.earnfi.fun/api/ai-agent/v1';

/** PayAI facilitator limits per EarnFi skill.md */
export const X402_COMPUTE_UNIT_LIMIT = 40_000;
export const X402_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 5n;

export type WalletLike = {
    publicKey: PublicKey;
    signTransaction: (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
};

export type X402Accept = {
    scheme: 'exact';
    network: string;
    amount: string;
    payTo: string;
    asset: string;
    extra?: {
        feePayer?: string;
        tokenDecimals?: number;
    };
    [k: string]: unknown;
};

export type X402Challenge = {
    x402Version: number;
    resource: { url: string; description?: string; mimeType?: string };
    accepts: X402Accept[];
};

export type PaymentSignaturePayload = {
    signed_tx: string;
    requirements: X402Accept;
};

export type JsonResponse = { status: number; headers: Headers; json: unknown };

export type X402Response = JsonResponse & { paymentRequired?: X402Challenge };

export type JobAuth = {
    secret?: string;
    /** Override client agentToken for this request */
    agentToken?: string;
};

export type AgentClientOptions = {
    /** Defaults to {@link EARNFI_DEFAULT_API_BASE} */
    baseUrl?: string;
    agentToken?: string;
    /** Required for paid x402 creates */
    wallet?: WalletLike;
    /** Required for paid x402 creates */
    connection?: Connection;
    fetchImpl?: typeof fetch;
    /** Send Agent-Token header instead of query param when possible (default true) */
    preferAgentTokenHeader?: boolean;
};

export type TokenGateInput = string | Record<string, unknown>;
