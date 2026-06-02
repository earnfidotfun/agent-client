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
