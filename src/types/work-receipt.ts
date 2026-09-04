/** Unified Work Receipt V1 — same shape for every completed hire on EarnFi. */
export const WORK_RECEIPT_REF_TYPES = [
    'agent_order',
    'agent_deal',
    'deal',
    'human_action',
    'job_contract',
    'job_milestone',
    'open_work_submission',
    'work_order',
    'task_completion',
] as const;

export type WorkReceiptRefType = (typeof WORK_RECEIPT_REF_TYPES)[number];

export type WorkReceiptParty = {
    type: 'human' | 'agent' | 'hybrid';
    ref: string;
};

export type WorkReceiptWorkSpec = {
    prompt?: string;
    input?: unknown;
    scope?: string;
    deliverables?: unknown;
    output_schema?: unknown;
    delivery_type?: string;
    kind?: string;
    work_mode?: string;
    ref_type?: string;
    ref_id?: string;
    payload?: unknown;
    [key: string]: unknown;
};

export type WorkReceiptAcceptance = {
    mode?: string;
    criteria?: string;
    verified_by?: string;
};

export type WorkReceiptEvidence = {
    hash?: string | null;
    url?: string | null;
    urls?: string[];
    output?: unknown;
    note?: string;
    payload?: unknown;
};

export type WorkReceiptDispute = {
    window_seconds?: number | null;
    auto_release_at?: string | null;
    disputed?: boolean;
};

export type WorkReceiptV1 = {
    schema_version: '1';
    receipt_id: string;
    ref_type: WorkReceiptRefType | string;
    ref_id: string;
    status: string;
    completed_at: string;
    work: {
        kind?: string;
        title?: string;
        spec?: WorkReceiptWorkSpec;
        acceptance?: WorkReceiptAcceptance;
        evidence?: WorkReceiptEvidence;
        dispute?: WorkReceiptDispute;
    };
    parties: {
        payer: WorkReceiptParty;
        payee: WorkReceiptParty;
        worker: WorkReceiptParty;
    };
    payment: {
        amount_micro: string;
        fee_micro: string;
        net_micro: string;
        currency: 'USDC';
        protocol: 'x402' | 'balance';
        settlement_id?: number | null;
        tx_hash?: string | null;
    };
    links: {
        self: string;
        verify: string;
        lookup?: string;
    };
    verified?: boolean;
};

export type WorkReceiptResponse = {
    work_receipt: WorkReceiptV1;
};

export type WorkReceiptVerifyResponse = {
    work_receipt: WorkReceiptV1;
    verified: boolean;
};
