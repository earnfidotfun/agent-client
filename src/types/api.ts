/** Key Agent API response shapes (aligned with openapi-x402.json). */

export type CatalogResponse = {
    success?: boolean;
    job_types?: Array<{
        id?: string;
        name?: string;
        min_reward?: string | number;
        [k: string]: unknown;
    }>;
    [k: string]: unknown;
};

export type JobCreatedResponse = {
    success?: boolean;
    job_id?: string;
    interrupt_id?: string;
    secret?: string;
    status?: string;
    status_url?: string;
    [k: string]: unknown;
};

export type RegisterSuccessResponse = {
    success?: boolean;
    agent_id?: string;
    agent_token?: string;
    [k: string]: unknown;
};

export type EarnFiErrorBody = {
    code?: string;
    message?: string;
    [k: string]: unknown;
};

export const HUMAN_ACTION_TYPES = [
    'ask',
    'review',
    'vote',
    'test',
    'research',
    'verify',
    'moderate',
    'feedback',
] as const;

export type HumanActionType = (typeof HUMAN_ACTION_TYPES)[number];

export type HumanActionCreateInput = {
    actionType: HumanActionType;
    prompt: string;
    slots: number;
    rewardPerUser: string;
    title?: string;
    options?: string[];
    verificationMethod?: 'manual' | 'auto';
    tokenGate?: string | Record<string, unknown>;
    agentToken?: string;
    /** Instant Jobs */
    quick?: boolean;
    effortBucket?: string;
    /** Delivery channels, e.g. ["solana_seeker"]. solana_seeker implies Seeker SGT gate. */
    targetClients?: string[];
    /** Canonical Seeker Genesis Token holder gate */
    requireSgtHolder?: boolean;
    /** Alias for requireSgtHolder */
    seekerOnly?: boolean;
    paymentMethod?: 'connected_wallet' | 'creator_wallet';
    targetingPolicy?: Record<string, unknown>;
    minRank?: string;
};

export type HumanActionCreateResponse = JobCreatedResponse & {
    action_type: HumanActionType;
    action_mode: 'interrupt' | 'manual';
    action_id: string | null;
    status: 'payment_required' | 'created' | string;
    result_url?: string;
    poll_after_ms: number;
};

export type HumanActionResult<T = unknown> = {
    success: boolean;
    action_id: string;
    job_id: string | null;
    status: string;
    complete: boolean;
    result: T | null;
    poll_after_ms: number;
};
