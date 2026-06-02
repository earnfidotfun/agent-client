import { describe, it, expect, vi, afterEach } from 'vitest';
import { EarnFiAgentClient } from '../src/client.js';

describe('x402 auth', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('createSocialJob sends Agent-Token on first request (default options)', async () => {
        const challenge = {
            x402Version: 2,
            resource: { url: 'https://app.earnfi.fun/api/ai-agent/v1/jobs/social' },
            accepts: [{ scheme: 'exact', network: 'solana:x', amount: '1000', payTo: 'x', asset: 'USDC' }],
        };
        const b64 = Buffer.from(JSON.stringify(challenge)).toString('base64');

        const fetchMock = vi.fn().mockResolvedValue({
            status: 402,
            headers: new Headers({ 'payment-required': b64 }),
            text: async () => JSON.stringify({ payment_required: true }),
        });

        const client = new EarnFiAgentClient({
            agentToken: 'test-token-abc',
            fetchImpl: fetchMock as unknown as typeof fetch,
        });

        await expect(client.createSocialJob({ taskType: 'follow', slots: 2, rewardPerUser: '0.03' })).rejects.toThrow(
            /wallet \+ connection/
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.headers).toMatchObject({
            'Agent-Token': 'test-token-abc',
            'X-Agent-Token': 'test-token-abc',
        });
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).not.toContain('agent_token=');
    });

    it('quoteGet sends Agent-Token when agentToken set', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            status: 401,
            headers: new Headers(),
            text: async () => '{}',
        });

        const client = new EarnFiAgentClient({
            agentToken: 'hdr-tok',
            fetchImpl: fetchMock as unknown as typeof fetch,
        });

        await client.getX402Preview();
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.headers).toMatchObject({ 'Agent-Token': 'hdr-tok' });
    });

    it('preferAgentTokenHeader false uses query param', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            status: 401,
            headers: new Headers(),
            text: async () => '{}',
        });

        const client = new EarnFiAgentClient({
            agentToken: 'q-tok',
            preferAgentTokenHeader: false,
            fetchImpl: fetchMock as unknown as typeof fetch,
        });

        await client.quoteSocialJob({ taskType: 'follow', slots: 1, rewardPerUser: '0.03' });
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('agent_token=q-tok');
    });
});
