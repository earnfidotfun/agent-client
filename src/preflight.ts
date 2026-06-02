import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import type { Connection } from '@solana/web3.js';
import type { WalletLike, X402Accept } from './types.js';
import { EarnFiPreflightError } from './errors.js';

/** Mainnet USDC mint */
export const USDC_MINT_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export type PreflightPaymentResult = {
    ready: boolean;
    senderAtaExists: boolean;
    usdcBalanceAtomic: bigint;
    quotedAmountAtomic?: bigint;
    walletAddress: string;
    senderAta?: string;
    errors: string[];
};

export type PreflightPaymentOptions = {
    wallet: WalletLike;
    connection: Connection;
    /** From 402 accepts[0]; when set, checks balance >= amount */
    requirements?: X402Accept;
    usdcMint?: PublicKey;
};

/**
 * Check wallet can pay x402 USDC (ATA + balance). Does not create ATAs — fund the wallet with USDC instead.
 * Transaction fees are typically covered by the x402 facilitator fee payer, not your wallet.
 */
export async function preflightPayment(opts: PreflightPaymentOptions): Promise<PreflightPaymentResult> {
    const mint = opts.usdcMint ?? new PublicKey(USDC_MINT_MAINNET);
    const owner = opts.wallet.publicKey;
    const walletAddress = owner.toBase58();
    const errors: string[] = [];
    const ata = getAssociatedTokenAddressSync(mint, owner, true);

    let senderAtaExists = false;
    let usdcBalanceAtomic = 0n;

    const accountInfo = await opts.connection.getAccountInfo(ata, 'finalized');
    if (!accountInfo) {
        errors.push(
            `No USDC token account for this wallet. Fund ${walletAddress} with USDC on Solana — ` +
                `a USDC associated token account is created on first inbound USDC transfer. ` +
                `Do not create the ATA inside the x402 payment transaction.`
        );
    } else {
        senderAtaExists = true;
        try {
            const bal = await opts.connection.getTokenAccountBalance(ata, 'finalized');
            usdcBalanceAtomic = BigInt(bal.value.amount);
        } catch {
            errors.push('Could not read USDC balance for sender ATA.');
        }
    }

    let quotedAmountAtomic: bigint | undefined;
    if (opts.requirements?.amount) {
        quotedAmountAtomic = BigInt(String(opts.requirements.amount));
        if (senderAtaExists && usdcBalanceAtomic < quotedAmountAtomic) {
            const decimals =
                opts.requirements.extra && typeof opts.requirements.extra.tokenDecimals === 'number'
                    ? opts.requirements.extra.tokenDecimals
                    : 6;
            const human = Number(quotedAmountAtomic) / 10 ** decimals;
            errors.push(
                `Insufficient USDC: need at least ${human} USDC (atomic ${quotedAmountAtomic}) in ${walletAddress}.`
            );
        }
    }

    return {
        ready: errors.length === 0,
        senderAtaExists,
        usdcBalanceAtomic,
        quotedAmountAtomic,
        walletAddress,
        senderAta: ata.toBase58(),
        errors,
    };
}

/** Run preflight and throw {@link EarnFiPreflightError} when not ready. */
export async function assertPreflightPayment(opts: PreflightPaymentOptions): Promise<PreflightPaymentResult> {
    const result = await preflightPayment(opts);
    if (!result.ready) {
        throw new EarnFiPreflightError(result.errors.join(' '), result.errors);
    }
    return result;
}
