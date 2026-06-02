import { Connection, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { EarnFiAgentClient } from './client.js';
import type { AgentClientOptions, WalletLike } from './types.js';
import { EARNFI_DEFAULT_API_BASE } from './types.js';

export type FromEnvOptions = Partial<AgentClientOptions> & {
    env?: {
        apiBase?: string;
        agentToken?: string;
        rpcUrl?: string;
        secretKeyB58?: string;
    };
};

function envKey(name: string): string {
    return (process.env[name] || '').trim();
}

export function walletFromEnv(secretKeyVar = 'SOLANA_SECRET_KEY_B58'): WalletLike | undefined {
    const sk = envKey(secretKeyVar);
    if (!sk) return undefined;
    const kp = Keypair.fromSecretKey(bs58.decode(sk));
    return {
        publicKey: kp.publicKey,
            signTransaction: async (tx: Transaction | VersionedTransaction) => {
                if (tx instanceof Transaction) tx.partialSign(kp);
                return tx;
            },
    };
}

/** EARNFI_AGENT_API_BASE, EARNFI_AGENT_TOKEN, SOLANA_RPC_URL, SOLANA_SECRET_KEY_B58 */
export function clientFromEnv(opts: FromEnvOptions = {}): EarnFiAgentClient {
    const e = opts.env ?? {};
    const baseUrl = opts.baseUrl ?? (envKey(e.apiBase ?? 'EARNFI_AGENT_API_BASE') || EARNFI_DEFAULT_API_BASE);
    const agentToken = opts.agentToken ?? (envKey(e.agentToken ?? 'EARNFI_AGENT_TOKEN') || undefined);
    const rpc = envKey(e.rpcUrl ?? 'SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com';
    const wallet = opts.wallet ?? walletFromEnv(e.secretKeyB58 ?? 'SOLANA_SECRET_KEY_B58');
    const connection = opts.connection ?? new Connection(rpc);

    return new EarnFiAgentClient({
        ...opts,
        baseUrl,
        agentToken,
        wallet,
        connection,
    });
}
