#!/usr/bin/env node
/** Verify the published npm tarball exports resolve correctly. */
const pkg = await import('@earn-fi/agent-client');

const checks = [
    ['EarnFiAgentClient', typeof pkg.EarnFiAgentClient === 'function'],
    ['EARNFI_DEFAULT_API_BASE', typeof pkg.EARNFI_DEFAULT_API_BASE === 'string'],
    ['fetchRegisterChallenge', typeof pkg.fetchRegisterChallenge === 'function'],
    ['signExactSvmPayment', typeof pkg.signExactSvmPayment === 'function'],
    ['X402_COMPUTE_UNIT_LIMIT', pkg.X402_COMPUTE_UNIT_LIMIT === 40_000],
];

let failed = 0;
for (const [name, ok] of checks) {
    console.log(ok ? `  ✓ ${name}` : `  ✗ ${name}`);
    if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
