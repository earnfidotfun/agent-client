import {
    ComputeBudgetProgram,
    Connection,
    PublicKey,
    Transaction,
    VersionedTransaction,
} from '@solana/web3.js';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import type { PaymentSignaturePayload, WalletLike, X402Accept } from './types.js';
import { X402_COMPUTE_UNIT_LIMIT, X402_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS } from './types.js';

export function b64encodeJson(obj: unknown): string {
    const json = JSON.stringify(obj);
    if (typeof Buffer !== 'undefined') return Buffer.from(json, 'utf8').toString('base64');
    return btoa(unescape(encodeURIComponent(json)));
}

export function b64decodeJson<T = unknown>(b64: string): T {
    if (typeof Buffer !== 'undefined') {
        return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as T;
    }
    return JSON.parse(decodeURIComponent(escape(atob(b64)))) as T;
}

export function getPaymentRequiredHeader(headers: Headers): string | null {
    return headers.get('payment-required') || headers.get('PAYMENT-REQUIRED');
}

/**
 * x402 facilitators expect exactly three instructions in order: SetComputeUnitLimit,
 * SetComputeUnitPrice, TransferChecked. Do not bundle ATA creation into the payment tx.
 */
async function requireExistingAta(connection: Connection, mint: PublicKey, owner: PublicKey, label: string) {
    const ata = getAssociatedTokenAddressSync(mint, owner, true);
    const info = await connection.getAccountInfo(ata, 'finalized');
    if (!info) {
        throw new Error(
            `Missing ${label} USDC ATA (${ata.toBase58()}). Create or fund it in a separate transaction before paying; ` +
                'x402 facilitators reject payment txs that include Associated Token Program create instructions.'
        );
    }
    return ata;
}

export type SignExactSvmPaymentOptions = {
    wallet: WalletLike;
    connection: Connection;
    computeUnitLimit?: number;
    computeUnitPriceMicroLamports?: bigint;
};

/**
 * Build an exact SVM payment signature for x402 retry headers (facilitator-compatible).
 */
export async function signExactSvmPayment(
    requirements: X402Accept,
    opts: SignExactSvmPaymentOptions
): Promise<PaymentSignaturePayload> {
    const { wallet, connection } = opts;
    const cuLimit = opts.computeUnitLimit ?? X402_COMPUTE_UNIT_LIMIT;
    const cuPrice = opts.computeUnitPriceMicroLamports ?? X402_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS;

    const mint = new PublicKey(requirements.asset);
    const payTo = new PublicKey(requirements.payTo);
    const feePayerStr =
        requirements.extra && typeof requirements.extra === 'object'
            ? (requirements.extra as { feePayer?: string }).feePayer
            : null;
    const feePayer = feePayerStr ? new PublicKey(String(feePayerStr)) : wallet.publicKey;

    const decimalsRaw =
        requirements.extra && typeof requirements.extra === 'object'
            ? (requirements.extra as { tokenDecimals?: number }).tokenDecimals
            : null;
    const decimals = typeof decimalsRaw === 'number' ? decimalsRaw : 6;
    const amountAtomic = BigInt(String(requirements.amount));

    const fromOwner = wallet.publicKey;
    const fromAta = await requireExistingAta(connection, mint, fromOwner, 'sender');
    const toAta = await requireExistingAta(connection, mint, payTo, 'recipient (payTo)');

    const tx = new Transaction();
    tx.feePayer = feePayer;
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    tx.recentBlockhash = blockhash;

    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice }));
    tx.add(createTransferCheckedInstruction(fromAta, mint, toAta, fromOwner, amountAtomic, decimals));

    const signed = await wallet.signTransaction(tx);
    const legacy = signed as Transaction;
    const signedBytes = legacy.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
    });
    const signedB64 = Buffer.from(signedBytes).toString('base64');

    return { signed_tx: signedB64, requirements };
}
