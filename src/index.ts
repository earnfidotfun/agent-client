export {
    fetchRegisterChallenge,
    postRegister,
    postRegisterChallenge,
    normalizeEd25519Signature,
} from './register.js';
export type { RegisterChallengeResponse, RegisterPostBody } from './register.js';

export {
    EarnFiAgentClient,
    EarnFiHttpClient,
    type EarnFiHttpClientConfig,
    type EarnFiWalletLike,
    type JobCreatedResponse,
    type RegisterSuccessResponse,
} from './client.js';

export {
    EARNFI_DEFAULT_API_BASE,
    X402_COMPUTE_UNIT_LIMIT,
    X402_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
    type AgentClientOptions,
    type JobAuth,
    type JsonResponse,
    type PaymentSignaturePayload,
    type TokenGateInput,
    type WalletLike,
    type X402Accept,
    type X402Challenge,
    type X402Response,
} from './types.js';

export type { CatalogResponse, EarnFiErrorBody } from './types/api.js';

export { b64decodeJson, b64encodeJson, getPaymentRequiredHeader, signExactSvmPayment } from './x402.js';

export { EarnFiApiError, EarnFiPreflightError } from './errors.js';

export { preflightPayment, assertPreflightPayment, USDC_MINT_MAINNET } from './preflight.js';
export type { PreflightPaymentResult, PreflightPaymentOptions } from './preflight.js';

export { pollUntil } from './poll.js';
export type { PollOptions } from './poll.js';

export { clientFromEnv, walletFromEnv } from './env.js';
export type { FromEnvOptions } from './env.js';

/** Alias: {@link clientFromEnv} */
export { clientFromEnv as earnFiClientFromEnv } from './env.js';
