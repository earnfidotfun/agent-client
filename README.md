# `@earn-fi/agent-client`

Official TypeScript SDK and **`earnfi-agent`** CLI for the **EarnFi Agent API** (`ai-agent/v1`).

```bash
npm install @earn-fi/agent-client
```

## Quick start

```ts
import { Connection, Keypair } from '@solana/web3.js';
import { clientFromEnv, EarnFiAgentClient } from '@earn-fi/agent-client';

// Or explicit setup:
const client = new EarnFiAgentClient({
  agentToken: process.env.EARNFI_AGENT_TOKEN,
  connection: new Connection(process.env.SOLANA_RPC_URL!),
  wallet: myWallet, // required for paid creates
});

await client.register({
  agentName: 'my-agent',
  walletAddress: myWallet.publicKey.toBase58(),
  signMessage: async (msg) => signUtf8(msg),
});

const quote = await client.quoteSocialJob({
  taskType: 'follow',
  slots: 2,
  rewardPerUser: '0.03',
  contentUrl: 'https://x.com/joel_bulldev',
});

await client.preflightPayment(quote.paymentRequired?.accepts[0]);

const job = await client.createSocialJob({
  taskType: 'follow',
  slots: 2,
  rewardPerUser: '0.03',
  contentUrl: 'https://x.com/joel_bulldev',
});
// job.json → { job_id, secret, status_url }
```

**Environment variables:** `EARNFI_AGENT_API_BASE`, `EARNFI_AGENT_TOKEN`, `SOLANA_RPC_URL`, `SOLANA_SECRET_KEY_B58`

```ts
const client = clientFromEnv();
```

## x402 payments

- Sends **`Agent-Token`** (and `X-Agent-Token`) on **both** the 402 quote request and the payment retry.
- Built-in exact-SVM signer: 3-instruction USDC transfer (≤40k CU, ≤5 microLamports/CU).
- **Preflight:** checks USDC ATA + balance — if missing, fund the wallet with USDC (facilitator covers tx fees; do not create ATA inside payment tx).
- **`quoteSocialJob()`** — 402 only, no wallet. **`createSocialJob()`** — full pay flow.

## API coverage

| Area | Methods |
|------|---------|
| Discovery | `getCatalog`, `postCatalog`, `getX402Preview`, `register`, `registerIfNeeded` |
| Paid GET | `createSocialJob`, `createManualJob`, `createContestJob`, `createInterrupt` |
| Paid POST | `createSocialJobPost`, `createManualJobPost`, `createContestJobPost`, `createInterruptPost` |
| Polling | `getJob`, `listSubmissions`, `listCompletions`, `getInterruptStatus`, `waitForSubmissions`, `pollUntilComplete` |
| Creator | `pauseJob`, verifications, contest, detail/users/payments |

Registration helpers: `fetchRegisterChallenge`, `postRegister`, `normalizeEd25519Signature`.

## CLI

```bash
npx earnfi-agent init --wallet PUBKEY --name my-agent --secret-key-bs58 KEY
npx earnfi-agent preflight --secret-key-bs58 KEY
npx earnfi-agent create-social --task-type follow --slots 2 --reward 0.03 --content-url https://x.com/joel_bulldev
npx earnfi-agent poll-job --job-id EF123A --secret SECRET
```

## SDK vs MCP vs skill

| Surface | Use when |
|---------|----------|
| **This package** | Node/TS agents, Synapse plugins, automation |
| **Hosted MCP** `https://app.earnfi.fun/mcp` | Cursor / MCP-native agents |
| **skill.md** | Human-readable spec + curl examples |

See [EarnFi skill](https://app.earnfi.fun/skill.md) and [OpenAPI](https://app.earnfi.fun/openapi-x402.json).

## Links

- [Source & issues](https://github.com/earnfidotfun/agent-client)
- [npm](https://www.npmjs.com/package/@earn-fi/agent-client)
