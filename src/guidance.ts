/**
 * Parse Agent Guidance Protocol envelopes from Work + Money API responses.
 * Mirrors Growl_Agent_Guidance envelopes (next_actions, hint, next_step).
 */
export type GuidanceAction = {
    id: string;
    label: string;
    method: string;
    path: string;
    requires: string[];
    optional: string[];
};

export type ParsedGuidance = {
    entity?: Record<string, unknown>;
    entityType?: 'agent_order' | 'agent_deal' | 'application';
    status?: string;
    viewerRole?: string;
    nextActions: GuidanceAction[];
    hint?: string;
    nextStep?: string;
};

function asRecord(v: unknown): Record<string, unknown> | undefined {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function parseAction(raw: unknown): GuidanceAction | null {
    const o = asRecord(raw);
    if (!o || typeof o.id !== 'string' || typeof o.path !== 'string') return null;
    return {
        id: o.id,
        label: typeof o.label === 'string' ? o.label : o.id,
        method: typeof o.method === 'string' ? o.method : 'POST',
        path: o.path,
        requires: Array.isArray(o.requires) ? o.requires.filter((x) => typeof x === 'string') : [],
        optional: Array.isArray(o.optional) ? o.optional.filter((x) => typeof x === 'string') : [],
    };
}

/**
 * Extract guidance metadata from an API JSON body (order/deal create, fund, deliver, etc.).
 * Returns null when the payload is not a guidance envelope.
 */
export function parseGuidance(json: unknown): ParsedGuidance | null {
    const root = asRecord(json);
    if (!root) return null;

    let entityType: ParsedGuidance['entityType'] | undefined;
    let entity: Record<string, unknown> | undefined;

    const order = asRecord(root.order);
    const deal = asRecord(root.deal);
    const application = asRecord(root.application);

    if (order) {
        entityType = 'agent_order';
        entity = order;
    } else if (deal) {
        entityType = 'agent_deal';
        entity = deal;
    } else if (application) {
        entityType = 'application';
        entity = application;
    }

    const hasGuidance =
        entity !== undefined ||
        Array.isArray(root.next_actions) ||
        typeof root.hint === 'string' ||
        typeof root.next_step === 'string' ||
        typeof root.viewer_role === 'string';

    if (!hasGuidance) return null;

    const nextActions = Array.isArray(root.next_actions)
        ? root.next_actions.map(parseAction).filter((a): a is GuidanceAction => a !== null)
        : [];

    return {
        entity,
        entityType,
        status: typeof root.status === 'string' ? root.status : undefined,
        viewerRole: typeof root.viewer_role === 'string' ? root.viewer_role : undefined,
        nextActions,
        hint: typeof root.hint === 'string' ? root.hint : undefined,
        nextStep: typeof root.next_step === 'string' ? root.next_step : undefined,
    };
}
