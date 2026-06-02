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

    const x402 = await client.getX402Preview();
    ok('getX402Preview returns 402', x402.status === 402, `HTTP ${x402.status}`);
    ok('x402 has paymentRequired', Boolean(x402.paymentRequired?.accepts?.length));
    const accept = x402.paymentRequired?.accepts?.[0];
    ok('x402 accept scheme exact', accept?.scheme === 'exact');

    // Smoke: ensure quoteSocialJob does NOT fail with missing_agent_token (auth header must be attached).
    const quoteClient = new EarnFiAgentClient({
        baseUrl: BASE,
        agentToken: 'smoke-invalid-token',
    });
    const quoteAuth = await quoteClient.quoteSocialJob({
        taskType: 'like',
        slots: 1,
        rewardPerUser: '0.05',
    });
    const code = quoteAuth.json && typeof quoteAuth.json === 'object' ? quoteAuth.json.code : undefined;
    ok('quoteSocialJob sends auth (not missing_agent_token)', code !== 'missing_agent_token', `HTTP ${quoteAuth.status}`);

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
