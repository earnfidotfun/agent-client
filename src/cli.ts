#!/usr/bin/env node
/**
 * EarnFi Agent CLI for registration, Human Actions, paid creates, polling, and preflight.
 */
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import {
    EarnFiAgentClient,
    EARNFI_DEFAULT_API_BASE,
    fetchRegisterChallenge,
    postRegister,
    preflightPayment,
} from './index.js';

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    if (i === -1 || i + 1 >= process.argv.length) return undefined;
    return process.argv[i + 1];
}

function usage() {
    console.log(`earnfi-agent — EarnFi Agent API (@earn-fi/agent-client)

Usage:
  earnfi-agent catalog [--base-url URL]
  earnfi-agent challenge --wallet PUBKEY --name AGENT_NAME [--base-url URL]
  earnfi-agent register --wallet PUBKEY --name NAME --secret-key-bs58 KEY [--base-url URL]
  earnfi-agent init --wallet PUBKEY --name NAME --secret-key-bs58 KEY [--base-url URL]
  earnfi-agent preflight --secret-key-bs58 KEY [--rpc URL]
  earnfi-agent quote-social --token TOKEN --task-type follow --slots 2 --reward 0.03 [--base-url URL]
  earnfi-agent create-social --token TOKEN --task-type follow --slots 2 --reward 0.03 --secret-key-bs58 KEY [--content-url URL] [--base-url URL]
  earnfi-agent quote-action --type review --prompt "Review this page" --slots 3 --reward 0.10
  earnfi-agent create-action --type review --prompt "Review this page" --slots 3 --reward 0.10 --secret-key-bs58 KEY
  earnfi-agent ask|review|vote|test|research|verify|moderate|feedback --prompt "..." --slots 3 --reward 0.10 --secret-key-bs58 KEY
  earnfi-agent poll-action --action-id ID --secret SECRET
  earnfi-agent poll-job --job-id ID --secret SECRET [--base-url URL]

Environment:
  EARNFI_AGENT_API_BASE   Agent API v1 base URL
  EARNFI_AGENT_TOKEN      agent_token from register
  SOLANA_RPC_URL          Solana RPC (default mainnet-beta)
  SOLANA_SECRET_KEY_B58   Wallet secret for paid creates
`);
}

function baseUrl() {
    return arg('--base-url') || (process.env.EARNFI_AGENT_API_BASE || '').trim() || EARNFI_DEFAULT_API_BASE;
}

function rpcUrl() {
    return arg('--rpc') || (process.env.SOLANA_RPC_URL || '').trim() || 'https://api.mainnet-beta.solana.com';
}

function walletFromSecret(skB58: string) {
    const kp = Keypair.fromSecretKey(bs58.decode(skB58.trim()));
    return {
        kp,
        wallet: {
            publicKey: kp.publicKey,
            signTransaction: async (tx: Transaction | VersionedTransaction) => {
                if (tx instanceof Transaction) tx.partialSign(kp);
                return tx;
            },
        },
    };
}

async function main() {
    const cmd = process.argv[2];
    if (!cmd || cmd === '-h' || cmd === '--help') {
        usage();
        process.exit(cmd ? 0 : 1);
    }

    const base = baseUrl();

    if (cmd === 'catalog') {
        const client = new EarnFiAgentClient({ baseUrl: base });
        const res = await client.getCatalog();
        console.log(JSON.stringify(res.json, null, 2));
        return;
    }

    if (cmd === 'challenge') {
        const wallet = arg('--wallet') || '';
        const name = arg('--name') || '';
        if (!wallet || !name) {
            console.error('challenge requires --wallet, --name');
            process.exit(1);
        }
        const ch = await fetchRegisterChallenge(base, wallet, name);
        console.log(JSON.stringify(ch, null, 2));
        return;
    }

    if (cmd === 'register' || cmd === 'init') {
        const wallet = arg('--wallet') || '';
        const name = arg('--name') || '';
        const skB58 = arg('--secret-key-bs58') || process.env.SOLANA_SECRET_KEY_B58 || '';
        if (!wallet || !name || !skB58) {
            console.error(`${cmd} requires --wallet, --name, --secret-key-bs58 (or SOLANA_SECRET_KEY_B58)`);
            process.exit(1);
        }
        const { kp } = walletFromSecret(skB58);
        const pub = kp.publicKey.toBase58();
        if (pub !== wallet.trim()) {
            console.error('Error: --wallet must match secret key');
            process.exit(1);
        }
        const client = new EarnFiAgentClient({
            baseUrl: base,
            connection: new Connection(rpcUrl()),
            wallet: walletFromSecret(skB58).wallet,
        });
        const out = await client.register({
            agentName: name,
            walletAddress: wallet,
            signMessage: async (msg) => nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey),
        });
        console.log(JSON.stringify(out, null, 2));
        if (cmd === 'init') {
            console.log('\n# Save these environment variables:');
            console.log(`export EARNFI_AGENT_API_BASE="${base}"`);
            console.log(`export EARNFI_AGENT_TOKEN="${out.agentToken}"`);
            console.log(`export SOLANA_RPC_URL="${rpcUrl()}"`);
            console.log('export SOLANA_SECRET_KEY_B58="..." # keep secret');
        }
        return;
    }

    if (cmd === 'preflight') {
        const skB58 = arg('--secret-key-bs58') || process.env.SOLANA_SECRET_KEY_B58 || '';
        if (!skB58) {
            console.error('preflight requires --secret-key-bs58 or SOLANA_SECRET_KEY_B58');
            process.exit(1);
        }
        const { wallet } = walletFromSecret(skB58);
        const result = await preflightPayment({
            wallet,
            connection: new Connection(rpcUrl()),
        });
        console.log(JSON.stringify(result, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
        process.exit(result.ready ? 0 : 1);
    }

    if (cmd === 'quote-social') {
        const token = arg('--token') || process.env.EARNFI_AGENT_TOKEN || '';
        const taskType = arg('--task-type') || 'follow';
        const slots = parseInt(arg('--slots') || '10', 10);
        const reward = arg('--reward') || '0.05';
        const contentUrl = arg('--content-url');
        if (!token) {
            console.error('quote-social requires --token or EARNFI_AGENT_TOKEN');
            process.exit(1);
        }
        const client = new EarnFiAgentClient({ baseUrl: base, agentToken: token });
        const res = await client.quoteSocialJob({
            taskType,
            slots,
            rewardPerUser: reward,
            contentUrl,
        });
        console.log(`HTTP ${res.status}\n${JSON.stringify(res.json, null, 2)}`);
        if (res.paymentRequired) {
            console.log('\nPayment required:', JSON.stringify(res.paymentRequired.accepts?.[0], null, 2));
        }
        return;
    }

    if (cmd === 'create-social') {
        const token = arg('--token') || process.env.EARNFI_AGENT_TOKEN || '';
        const skB58 = arg('--secret-key-bs58') || process.env.SOLANA_SECRET_KEY_B58 || '';
        const taskType = arg('--task-type') || 'follow';
        const slots = parseInt(arg('--slots') || '10', 10);
        const reward = arg('--reward') || '0.05';
        const contentUrl = arg('--content-url');
        if (!token || !skB58) {
            console.error('create-social requires --token (or EARNFI_AGENT_TOKEN) and --secret-key-bs58');
            process.exit(1);
        }
        const { wallet } = walletFromSecret(skB58);
        const client = new EarnFiAgentClient({
            baseUrl: base,
            agentToken: token,
            wallet,
            connection: new Connection(rpcUrl()),
        });
        const res = await client.createSocialJob({
            taskType,
            slots,
            rewardPerUser: reward,
            contentUrl,
        });
        console.log(`HTTP ${res.status}\n${JSON.stringify(res.json, null, 2)}`);
        process.exit(res.status === 200 ? 0 : 1);
    }

    const actionAliases = ['ask', 'review', 'vote', 'test', 'research', 'verify', 'moderate', 'feedback'] as const;
    if (cmd === 'quote-action' || cmd === 'create-action' || actionAliases.includes(cmd as (typeof actionAliases)[number])) {
        const token = arg('--token') || process.env.EARNFI_AGENT_TOKEN || '';
        const type = actionAliases.includes(cmd as (typeof actionAliases)[number])
            ? (cmd as (typeof actionAliases)[number])
            : (arg('--type') as (typeof actionAliases)[number] | undefined);
        const prompt = arg('--prompt') || '';
        const slots = parseInt(arg('--slots') || '3', 10);
        const reward = arg('--reward') || '0.05';
        const options = (arg('--options') || '').split('|').map((v) => v.trim()).filter(Boolean);
        if (!token || !type || !actionAliases.includes(type) || !prompt) {
            console.error(`${cmd} requires --type when applicable, --prompt, and --token or EARNFI_AGENT_TOKEN`);
            process.exit(1);
        }
        if (cmd === 'quote-action') {
            const client = new EarnFiAgentClient({ baseUrl: base, agentToken: token });
            const res = await client.quoteHumanAction({
                actionType: type,
                prompt,
                slots,
                rewardPerUser: reward,
                options: options.length ? options : undefined,
            });
            console.log(`HTTP ${res.status}\n${JSON.stringify(res.json, null, 2)}`);
            return;
        }
        const skB58 = arg('--secret-key-bs58') || process.env.SOLANA_SECRET_KEY_B58 || '';
        if (!skB58) {
            console.error(`${cmd} requires --secret-key-bs58 or SOLANA_SECRET_KEY_B58`);
            process.exit(1);
        }
        const { wallet } = walletFromSecret(skB58);
        const client = new EarnFiAgentClient({
            baseUrl: base,
            agentToken: token,
            wallet,
            connection: new Connection(rpcUrl()),
        });
        const res = await client.createHumanAction({
            actionType: type,
            prompt,
            slots,
            rewardPerUser: reward,
            options: options.length ? options : undefined,
        });
        console.log(`HTTP ${res.status}\n${JSON.stringify(res.json, null, 2)}`);
        process.exit(res.status === 200 ? 0 : 1);
    }

    if (cmd === 'poll-action') {
        const actionId = arg('--action-id') || '';
        const secret = arg('--secret') || '';
        const token = arg('--token') || process.env.EARNFI_AGENT_TOKEN || '';
        if (!actionId || (!secret && !token)) {
            console.error('poll-action requires --action-id and either --secret or --token');
            process.exit(1);
        }
        const client = new EarnFiAgentClient({ baseUrl: base, agentToken: token || undefined });
        const res = await client.getHumanActionResult(actionId, secret ? { secret } : { agentToken: token });
        console.log(`HTTP ${res.status}\n${JSON.stringify(res.json, null, 2)}`);
        return;
    }

    if (cmd === 'poll-job') {
        const jobId = arg('--job-id') || '';
        const secret = arg('--secret') || '';
        if (!jobId || !secret) {
            console.error('poll-job requires --job-id, --secret');
            process.exit(1);
        }
        const client = new EarnFiAgentClient({ baseUrl: base });
        const res = await client.getJob(jobId, { secret });
        console.log(`HTTP ${res.status}\n${JSON.stringify(res.json, null, 2)}`);
        return;
    }

    console.error('Unknown command:', cmd);
    usage();
    process.exit(1);
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
