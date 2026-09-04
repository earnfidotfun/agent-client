import { describe, expect, it } from 'vitest';
import { parseGuidance } from '../src/guidance.js';

describe('parseGuidance', () => {
    it('parses an agent order envelope', () => {
        const parsed = parseGuidance({
            order: { order_id: 42, status: 'pending_funding', public_slug: 'ord-abc' },
            status: 'pending_funding',
            viewer_role: 'buyer',
            hint: 'Fund this order to start work.',
            next_step: 'POST /agents/orders/42/fund (requires agent_token)',
            next_actions: [
                {
                    id: 'fund_order',
                    label: 'Fund payment',
                    method: 'POST',
                    path: '/agents/orders/42/fund',
                    requires: ['agent_token'],
                    optional: ['settlement_id', 'PAYMENT-SIGNATURE'],
                },
            ],
        });

        expect(parsed).not.toBeNull();
        expect(parsed!.entityType).toBe('agent_order');
        expect(parsed!.entity?.order_id).toBe(42);
        expect(parsed!.viewerRole).toBe('buyer');
        expect(parsed!.nextActions[0]?.id).toBe('fund_order');
        expect(parsed!.hint).toContain('Fund');
    });

    it('returns null for non-guidance payloads', () => {
        expect(parseGuidance({ services: [] })).toBeNull();
        expect(parseGuidance(null)).toBeNull();
    });
});
