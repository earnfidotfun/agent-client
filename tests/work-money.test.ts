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

    it('createAndFundOrder creates then funds (MCP parity)', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(response(200, { order_id: 99, public_slug: 'abc12345', order: { order_id: 99 } }))
            .mockResolvedValueOnce(response(200, { success: true, status: 'funded' }));
        const client = new EarnFiAgentClient({
            agentToken: 'tok',
            fetchImpl: fetchMock as unknown as typeof fetch,
            skipPaymentPreflight: true,
        });

        const res = await client.createAndFundOrder(42, { input: { prompt: 'audit' } });

        expect(fetchMock.mock.calls[0][0]).toContain('/agents/orders');
        expect(fetchMock.mock.calls[0][1]?.body).toContain('"service_id":42');
        expect(fetchMock.mock.calls[1][0]).toContain('/agents/orders/99/fund');
        expect(res.status).toBe(200);
        expect((res.json as { order_id: number }).order_id).toBe(99);
        expect((res.json as { public_slug: string }).public_slug).toBe('abc12345');
        expect((res.json as { created_order: unknown }).created_order).toBeTruthy();
    });

    it('reads balance, withdraws, and lists disputes', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(response(200, { balance: { available_display: '1.00', wallet_address: 'Abc' } }))
            .mockResolvedValueOnce(response(200, { withdraw: { ok: true, transaction_hash: 'sig' } }))
            .mockResolvedValueOnce(response(200, { disputes: [] }));
        const client = new EarnFiAgentClient({
            agentToken: 'tok',
            fetchImpl: fetchMock as unknown as typeof fetch,
        });

        await client.agents.getBalance();
        expect(fetchMock.mock.calls[0][0]).toContain('/agents/me/balance');

        await client.agents.withdraw({ amount: 1.5 }, 'idem-1');
        expect(fetchMock.mock.calls[1][0]).toContain('/agents/me/withdraw');
        expect(fetchMock.mock.calls[1][1]?.body).toContain('"amount":1.5');
        expect(fetchMock.mock.calls[1][1]?.body).toContain('"idempotency_key":"idem-1"');

        await client.agents.listDisputes(1, 10);
        expect(fetchMock.mock.calls[2][0]).toContain('/agents/disputes?');
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

    it('updates owned job metadata with PATCH and exact body', async () => {
        const fetchMock = vi.fn().mockResolvedValue(response(200, { success: true }));
        const client = new EarnFiAgentClient({
            agentToken: 'tok',
            fetchImpl: fetchMock as unknown as typeof fetch,
        });

        await client.updateJobMetadata('ABC123', {
            title: 'Updated title',
            lock_duration_hours: 48,
        });

        expect(fetchMock.mock.calls[0][0]).toContain('/jobs/ABC123/metadata');
        expect(fetchMock.mock.calls[0][1]?.method).toBe('PATCH');
        expect(fetchMock.mock.calls[0][1]?.body).toBe(
            JSON.stringify({ title: 'Updated title', lock_duration_hours: 48 })
        );
    });

    it('creates and updates hire listings on agent routes', async () => {
        const fetchMock = vi.fn().mockResolvedValue(response(200, { success: true }));
        const client = new EarnFiAgentClient({
            agentToken: 'tok',
            fetchImpl: fetchMock as unknown as typeof fetch,
        });

        await client.hireListings.create({ title: 'Hire an auditor', amount: '25' });
        await client.hireListings.update(17, {
            expected_updated_at: '2026-09-21 20:00:00',
            positions: 2,
        });

        expect(fetchMock.mock.calls[0][0]).toContain('/hire-listings');
        expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
        expect(fetchMock.mock.calls[1][0]).toContain('/hire-listings/17');
        expect(fetchMock.mock.calls[1][1]?.method).toBe('PATCH');
        expect(fetchMock.mock.calls[1][1]?.body).toBe(
            JSON.stringify({ expected_updated_at: '2026-09-21 20:00:00', positions: 2 })
        );
    });
});
