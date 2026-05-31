#!/usr/bin/env node
/**
 * EarnFi Agent CLI — challenge, register, quote (402 probe), poll.
 * Private keys stay local; never committed.
 */
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { fetchRegisterChallenge, postRegister } from './register.js';

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    if (i === -1 || i + 1 >= process.argv.length) return undefined;
    return process.argv[i + 1];
}

function hasCmd(name: string) {
    return process.argv.includes(name);
}

function usage() {
    console.log(`earnfi-agent — EarnFi Agent API helper

Usage:
  earnfi-agent challenge --base-url <AGENT_API_V1_URL> --wallet <PUBKEY> --name <AGENT_NAME>
  earnfi-agent register --base-url <URL> --wallet <PUBKEY> --name <NAME> --secret-key-bs58 <KEY>
  earnfi-agent quote-social --base-url <URL> --token <AGENT_TOKEN> --task-type like --slots 10 --reward 0.05
  earnfi-agent poll-job --base-url <URL> --job-id <ID> --secret <SECRET>

Environment:
  EARNFI_AGENT_API_BASE   Default base URL (same as --base-url)
  SOLANA_RPC_URL          Default https://api.mainnet-beta.solana.com
`);
}

async function main() {
    const cmd = process.argv[2];
    const base =
        arg('--base-url') ||
        (process.env.EARNFI_AGENT_API_BASE || '').trim() ||
        '';

    if (!cmd || cmd === '-h' || cmd === '--help') {
        usage();
        process.exit(cmd ? 0 : 1);
    }

    if (cmd === 'challenge') {
        const wallet = arg('--wallet') || '';
        const name = arg('--name') || '';
        if (!base || !wallet || !name) {
            console.error('challenge requires --base-url, --wallet, --name');
            process.exit(1);
        }
        const ch = await fetchRegisterChallenge(base, wallet, name);
        console.log(JSON.stringify(ch, null, 2));
        return;
    }

    if (cmd === 'register') {
        const wallet = arg('--wallet') || '';
        const name = arg('--name') || '';
        const skB58 = arg('--secret-key-bs58') || '';
        if (!base || !wallet || !name || !skB58) {
            console.error('register requires --base-url, --wallet, --name, --secret-key-bs58');
            process.exit(1);
        }
        const full = bs58.decode(skB58.trim());
        const kp = nacl.sign.keyPair.fromSecretKey(full);
        const pub = bs58.encode(kp.publicKey);
        if (pub !== wallet.trim()) {
            console.error('Error: --wallet must match the public key derived from --secret-key-bs58');
            process.exit(1);
        }
        const ch = await fetchRegisterChallenge(base, wallet, name);
        const msgBytes = new TextEncoder().encode(ch.message!);
        const sig = nacl.sign.detached(msgBytes, kp.secretKey);
        const signature = Array.from(sig);
        const res = await postRegister(base, {
            wallet_address: wallet,
            agent_name: name,
            message: ch.message!,
            signature,
            nonce: ch.nonce!,
        });
        console.log(JSON.stringify(res, null, 2));
        return;
    }

    if (cmd === 'quote-social') {
        const token = arg('--token') || '';
        const taskType = arg('--task-type') || 'like';
        const slots = parseInt(arg('--slots') || '10', 10);
        const reward = arg('--reward') || '0.05';
        if (!base || !token) {
            console.error('quote-social requires --base-url, --token');
            process.exit(1);
        }
        const u = new URL(base.replace(/\/$/, '') + '/jobs/social');
        u.searchParams.set('agent_token', token);
        u.searchParams.set('task_type', taskType);
        u.searchParams.set('slots', String(slots));
        u.searchParams.set('reward_per_user', reward);
        u.searchParams.set('execution_mode', 'human');
        const r = await fetch(u.toString(), { method: 'GET', headers: { accept: 'application/json' } });
        const text = await r.text();
        console.log(`HTTP ${r.status}\n${text}`);
        return;
    }

    if (cmd === 'poll-job') {
        const jobId = arg('--job-id') || '';
        const secret = arg('--secret') || '';
        if (!base || !jobId || !secret) {
            console.error('poll-job requires --base-url, --job-id, --secret');
            process.exit(1);
        }
        const u = new URL(base.replace(/\/$/, '') + '/jobs/' + encodeURIComponent(jobId));
        u.searchParams.set('secret', secret);
        const r = await fetch(u.toString(), { method: 'GET', headers: { accept: 'application/json' } });
        const text = await r.text();
        console.log(`HTTP ${r.status}\n${text}`);
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
