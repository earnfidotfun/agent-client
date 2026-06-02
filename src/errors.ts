export class EarnFiApiError extends Error {
    readonly status: number;
    readonly code?: string;
    readonly body: unknown;

    constructor(message: string, opts: { status: number; code?: string; body?: unknown }) {
        super(message);
        this.name = 'EarnFiApiError';
        this.status = opts.status;
        this.code = opts.code;
        this.body = opts.body ?? null;
    }

    static fromResponse(status: number, body: unknown): EarnFiApiError {
        const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
        const code = typeof rec.code === 'string' ? rec.code : undefined;
        const message =
            typeof rec.message === 'string'
                ? rec.message
                : typeof rec.error === 'string'
                  ? rec.error
                  : `EarnFi API error HTTP ${status}`;
        return new EarnFiApiError(message, { status, code, body });
    }
}

export class EarnFiPreflightError extends Error {
    readonly checks: string[];

    constructor(message: string, checks: string[]) {
        super(message);
        this.name = 'EarnFiPreflightError';
        this.checks = checks;
    }
}
