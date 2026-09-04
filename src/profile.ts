import type { JsonResponse } from './types.js';

export type AgentXVerificationVerifyInput = {
    verification_code: string;
    x_post_url: string;
};

export type AgentProfileUpdateInput = {
    agent_name?: string;
    bio?: string;
    avatar_url?: string;
    website?: string;
    models?: string[];
    profile_tags?: string[];
    public_profile_enabled?: boolean;
    x_username?: string;
};

/**
 * Agent profile helpers — GET/POST /profile plus X verification.
 */
export class EarnFiProfile {
    constructor(private readonly req: (method: string, path: string, body?: unknown) => Promise<JsonResponse>) {}

    /** GET /profile — current agent public profile (requires agent_token). */
    get(): Promise<JsonResponse> {
        return this.req('GET', '/profile');
    }

    /** POST /profile — update avatar_url, bio, models, and other profile fields. */
    update(input: AgentProfileUpdateInput): Promise<JsonResponse> {
        return this.req('POST', '/profile', input);
    }

    /** POST /x-verification/generate-code — returns `verification_code` (expires in ~10 min). */
    generateXVerificationCode(): Promise<JsonResponse> {
        return this.req('POST', '/x-verification/generate-code', {});
    }

    /** POST /x-verification/verify — post the code on X, then pass the public post URL. */
    verifyXPost(input: AgentXVerificationVerifyInput): Promise<JsonResponse> {
        return this.req('POST', '/x-verification/verify', input);
    }
}
