import { describe, expect, it, vi } from 'vitest';
import { EarnFiAgentClient, WORK_REVIEW_REF_TYPES } from '../src/index.js';

function response(status: number, json: unknown) {
    return {
        status,
        headers: new Headers(),
        text: async () => JSON.stringify(json),
    };
}

describe('Work + Money', () => {
    it('lists marketplace services', async () => {
        const fetchMock = vi.fn().mockResolvedValue(response(200, { services: [] }));
        const client = new EarnFiAgentClient({
            agentToken: 'tok',
            fetchImpl: fetchMock as unknown as typeof fetch,
        });

        await client.agents.browseServices('coding', 'audit');

        expect(fetchMock.mock.calls[0][0]).toContain('/marketplace/services?');
        expect(fetchMock.mock.calls[0][0]).toContain('capability=coding');
        expect(fetchMock.mock.calls[0][0]).toContain('q=audit');
    });

    it('creates and lists agent orders', async () => {
        const fetchMock = vi.fn().mockResolvedValue(response(200, { orders: [] }));
        const client = new EarnFiAgentClient({
            agentToken: 'tok',
            fetchImpl: fetchMock as unknown as typeof fetch,
        });

        await client.agents.createOrder(42, { prompt: 'hello' });
        expect(fetchMock.mock.calls[0][1]?.body).toContain('"service_id":42');

        await client.agents.listMine('buyer', 2, 10);
        expect(fetchMock.mock.calls[1][0]).toContain('/agents/orders/mine?role=buyer&page=2&per_page=10');
    });

    it('runs agent deal lifecycle endpoints', async () => {
        const fetchMock = vi.fn().mockResolvedValue(response(200, { deal: { id: 1 } }));
        const client = new EarnFiAgentClient({
            agentToken: 'tok',
            fetchImpl: fetchMock as unknown as typeof fetch,
        });

        await client.agentDeals.create({ title: 'Custom scope', amount: 10 });
        await client.agentDeals.accept(7, { role: 'seller', inviteToken: 'abc' });
        await client.agentDeals.deliver(7, { note: 'done', output: '{"ok":true}' });

        expect(fetchMock.mock.calls[0][1]?.body).toContain('"title":"Custom scope"');
        expect(fetchMock.mock.calls[1][0]).toContain('/agents/deals/7/accept');
        expect(fetchMock.mock.calls[2][1]?.body).toContain('"payload":"{\\"ok\\":true}"');
    });

    it('submits work reviews with typed ref', async () => {
        const fetchMock = vi.fn().mockResolvedValue(response(200, { success: true }));
        const client = new EarnFiAgentClient({
            agentToken: 'tok',
            fetchImpl: fetchMock as unknown as typeof fetch,
        });

        await client.reviews.submit({
            refType: 'agent_order',
            refId: 'ord-123',
            stars: 5,
            comment: 'Great',
        });

        const body = fetchMock.mock.calls[0][1]?.body as string;
        expect(body).toContain('"ref_type":"agent_order"');
        expect(body).toContain('"stars":5');
        expect(WORK_REVIEW_REF_TYPES).toContain('agent_deal');
    });
});
