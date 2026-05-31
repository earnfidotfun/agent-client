#!/usr/bin/env node
/**
 * Live smoke tests against EarnFi production Agent API (free endpoints + 402 quotes).
 * Run after build: node scripts/smoke-live.mjs
 */
import { EarnFiAgentClient, EARNFI_DEFAULT_API_BASE, fetchRegisterChallenge } from '../dist/index.js';
import { X402_COMPUTE_UNIT_LIMIT, X402_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS } from '../dist/types.js';

const BASE = process.env.EARNFI_AGENT_API_BASE || EARNFI_DEFAULT_API_BASE;
let passed = 0;
let failed = 0;

function ok(name, cond, detail = '') {
    if (cond) {
        console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
        passed++;
    } else {
        console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
        failed++;
    }
}

async function main() {
    console.log(`EarnFi agent-client smoke @ ${BASE}\n`);
    const client = new EarnFiAgentClient({ baseUrl: BASE });

    const catalog = await client.getCatalog();
    ok('getCatalog', catalog.status === 200, `HTTP ${catalog.status}`);
    ok('catalog has job_types or success', Boolean(catalog.json && (catalog.json.job_types || catalog.json.success !== false)));

    const x402 = await client.getX402Preview();
    ok('getX402Preview returns 402', x402.status === 402, `HTTP ${x402.status}`);
    ok('x402 has paymentRequired', Boolean(x402.paymentRequired?.accepts?.length));
    const accept = x402.paymentRequired?.accepts?.[0];
    ok('x402 accept scheme exact', accept?.scheme === 'exact');

    const quote = await client.quoteGet('/jobs/social', {
        agent_token: 'smoke-test-token',
        task_type: 'like',
        slots: '1',
        reward_per_user: '0.05',
        execution_mode: 'human',
    });
    ok('social quote returns 402 or auth error', quote.status === 402 || quote.status === 401 || quote.status === 403, `HTTP ${quote.status}`);
    if (quote.status === 402) {
        ok('social quote has accepts', Boolean(quote.paymentRequired?.accepts?.length));
    }

    try {
        const ch = await fetchRegisterChallenge(BASE, '11111111111111111111111111111112', 'smoke-agent');
        ok('register challenge', ch && typeof ch.message === 'string', 'message present');
    } catch (e) {
        ok('register challenge', false, e instanceof Error ? e.message : String(e));
    }

    ok('X402 CU limit constant', X402_COMPUTE_UNIT_LIMIT === 40_000);
    ok('X402 CU price constant', X402_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS === 5n);

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
