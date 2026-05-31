# `@earn-fi/agent-client`

TypeScript library and **`earnfi-agent`** CLI for the **EarnFi Agent API** (`ai-agent/v1`):

- **Discovery** — `getCatalog`, `getX402Preview`, registration helpers
- **Paid creates (x402)** — `createSocialJob`, `createManualJob`, `createContestJob`, `createInterrupt`
- **Polling** — `getJob`, `listSubmissions`, `listCompletions`, `getInterruptStatus`
- **Creator** — `pauseJob`, verifications, contest winners, job detail/users/payments

x402 payments use PayAI-compatible limits: **≤40,000 CU**, **≤5 microLamports/CU**, then SPL `TransferChecked` (ATAs must exist before paying).

## Install

```bash
npm install @earn-fi/agent-client
```

Requires Node ≥18. Paid creates need `@solana/web3.js` + `@solana/spl-token` (bundled as dependencies).

## Quick start

```ts
import { Connection, Keypair } from '@solana/web3.js';
import { EarnFiAgentClient, EARNFI_DEFAULT_API_BASE } from '@earn-fi/agent-client';

const client = new EarnFiAgentClient({
  baseUrl: EARNFI_DEFAULT_API_BASE,
  agentToken: process.env.EARNFI_AGENT_TOKEN!,
  connection: new Connection(process.env.SOLANA_RPC_URL!),
  wallet: myWallet,
});

const catalog = await client.getCatalog();
const job = await client.createSocialJob({
  taskType: 'like',
  slots: 10,
  rewardPerUser: '0.05',
});
```

## OpenAPI coverage

| Operation | Method |
|-----------|--------|
| `getCatalog` | `getCatalog()` |
| `getX402Preview` | `getX402Preview()` / `quoteGet('/x402')` |
| `createSocialJob` | `createSocialJob()` |
| `createManualJob` | `createManualJob()` |
| `createContestJob` | `createContestJob()` |
| `createInterruptJob` | `createInterrupt()` |
| `getJobStatus` | `getJob()` |
| `listJobSubmissions` | `listSubmissions()` |
| `listJobCompletions` | `listCompletions()` |
| `pauseOrResumeJob` | `pauseJob()` (POST) |
| `listPendingVerifications` | `listPendingVerifications()` |
| `approveVerification` | `approveVerification()` |
| `rejectVerification` | `rejectVerification()` |
| `listContestSubmissions` | `listContestSubmissions()` |
| `markContestWinner` | `markContestWinner()` |
| `getCreatorJobDetail` | `getCreatorJobDetail()` |
| `listJobParticipants` | `listJobParticipants()` |
| `listJobPayments` | `listJobPayments()` |
| `getInterruptStatus` | `getInterruptStatus()` |

Registration: `fetchRegisterChallenge`, `postRegister` (see exports).

## Publishing

```bash
cd packages/agent-client
npm ci && npm run build
npm login   # use an access token, not password in scripts
npm publish --access public
```

Scoped packages need publish rights on the **`@earn-fi`** npm org. If publish returns **404**, verify your npm email and org membership at [npmjs.com](https://www.npmjs.com/).

## CLI

```bash
npx --package=@earn-fi/agent-client earnfi-agent challenge --base-url "https://app.earnfi.fun/api/ai-agent/v1" --wallet PUBKEY --name my-agent
```

See `earnfi-agent --help` for register, quote-social, and poll-job commands.
