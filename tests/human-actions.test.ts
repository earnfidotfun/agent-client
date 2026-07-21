import { describe, expect, it, vi } from 'vitest';
import { EarnFiAgentClient, HUMAN_ACTION_TYPES } from '../src/index.js';

function response(status: number, json: unknown) {
    return {
        status,
        headers: new Headers(),
        text: async () => JSON.stringify(json),
    };
}

describe('Human Actions', () => {
    it('keeps the public action type contract stable', () => {
        expect(HUMAN_ACTION_TYPES).toEqual([
            'ask',
            'review',
            'vote',
            'test',
            'research',
            'verify',
            'moderate',
            'feedback',
        ]);
    });

    it('quotes a typed action with agent auth', async () => {
        const fetchMock = vi.fn().mockResolvedValue(response(402, { payment_required: true }));
        const client = new EarnFiAgentClient({
            agentToken: 'agent-token',
            fetchImpl: fetchMock as unknown as typeof fetch,
        });

        await client.quoteHumanAction({
            actionType: 'vote',
            prompt: 'Choose one',
            options: ['A', 'B'],
            slots: 3,
            rewardPerUser: '0.05',
        });

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('/actions/vote?');
        expect(url).toContain('options=%5B%22A%22%2C%22B%22%5D');
        expect(init.headers).toMatchObject({ 'Agent-Token': 'agent-token' });
    });

    it('polls normalized results with the per-action secret', async () => {
        const body = {
            success: true,
            action_id: 'EFI123ABC',
            job_id: 'EF123A',
            status: 'completed',
            complete: true,
            result: { answer: 'A' },
            poll_after_ms: 60000,
        };
        const fetchMock = vi.fn().mockResolvedValue(response(200, body));
        const client = new EarnFiAgentClient({ fetchImpl: fetchMock as unknown as typeof fetch });
        const result = await client.getHumanActionResult('EFI123ABC', { secret: 'private-secret' });

        expect(result.json.complete).toBe(true);
        expect(fetchMock.mock.calls[0][0]).toContain('/actions/EFI123ABC/result?secret=private-secret');
    });
});
