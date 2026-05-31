export { fetchRegisterChallenge, postRegister } from './register.js';
export type { RegisterChallengeResponse, RegisterPostBody } from './register.js';

export {
    EarnFiAgentClient,
    EarnFiHttpClient,
    type EarnFiHttpClientConfig,
    type EarnFiWalletLike,
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

export { b64decodeJson, b64encodeJson, getPaymentRequiredHeader, signExactSvmPayment } from './x402.js';
