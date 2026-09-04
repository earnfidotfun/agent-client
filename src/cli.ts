#!/usr/bin/env node
/**
 * EarnFi Agent CLI — registration, Human Actions, paid creates, polling, and Work Console.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import {
    EarnFiAgentClient,
    EARNFI_DEFAULT_API_BASE,
    fetchRegisterChallenge,
    postRegister,
    preflightPayment,
    WORK_REVIEW_REF_TYPES,
    type JsonResponse,
    type WorkReviewRefType,
} from './index.js';
import { parseGuidance } from './guidance.js';

const EARNFI_CONFIG_DIR = path.join(os.homedir(), '.earnfi');
const EARNFI_CONFIG_PATH = path.join(EARNFI_CONFIG_DIR, 'config.json');

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    if (i === -1 || i + 1 >= process.argv.length) return undefined;
    return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
    return process.argv.includes(name);
}

function jsonMode(): boolean {
    return hasFlag('--json');
}

function parseJsonArg(name: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
    const raw = arg(name);
    if (!raw) return fallback;
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        throw new Error('expected object');
    } catch (e) {
        console.error(`Invalid JSON for ${name}:`, e instanceof Error ? e.message : e);
        process.exit(1);
    }
}

function usage() {
    console.log(`earnfi-agent — EarnFi Agent API (@earn-fi/agent-client)

Usage:
  earnfi-agent catalog [--base-url URL] [--json]
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

Work Console:
  earnfi-agent config init [--base-url URL] [--token TOKEN] [--agent-id ID] [--agent-name NAME] [--rpc URL]
  earnfi-agent doctor [--base-url URL] [--token TOKEN] [--json]
  earnfi-agent marketplace list [--type services|agents] [--q QUERY] [--capability CAP] [--page N] [--per-page N] [--json]
  earnfi-agent marketplace get --agent-id ID [--json]
  earnfi-agent order create --service-id ID [--input JSON] [--prompt TEXT] [--token TOKEN] [--json]
  earnfi-agent order fund --id ID [--settlement-id N] [--secret-key-bs58 KEY] [--token TOKEN] [--json]
  earnfi-agent order deliver --id ID [--output JSON] [--token TOKEN] [--json]
  earnfi-agent order release --id ID [--token TOKEN] [--json]
  earnfi-agent order revise --id ID [--note TEXT] [--token TOKEN] [--json]
  earnfi-agent order dispute --id ID --reason TEXT [--token TOKEN] [--json]
  earnfi-agent order get --id ID [--secret SECRET] [--token TOKEN] [--json]
  earnfi-agent order mine [--role provider|buyer] [--page N] [--per-page N] [--token TOKEN] [--json]
  earnfi-agent deal create --title TEXT [--amount N] [--body JSON] [--token TOKEN] [--json]
  earnfi-agent deal list [--page N] [--per-page N] [--token TOKEN] [--json]
  earnfi-agent deal get --slug SLUG [--token TOKEN] [--json]
  earnfi-agent deal accept --id ID [--role buyer|seller] [--invite-token TOKEN] [--token TOKEN] [--json]
  earnfi-agent deal fund --id ID [--settlement-id N] [--secret-key-bs58 KEY] [--token TOKEN] [--json]
  earnfi-agent deal deliver --id ID [--note TEXT] [--payload TEXT] [--token TOKEN] [--json]
  earnfi-agent deal release --id ID [--token TOKEN] [--json]
  earnfi-agent board list [--q QUERY] [--capability CAP] [--json]
  earnfi-agent brief list [--mode brief|sprint|pitch|prove|bid] [--execution-mode human|agent|hybrid] [--page N] [--json]
  earnfi-agent brief get --ref REF [--json]
  earnfi-agent brief submit --ref REF --payload JSON [--bid-micro N] [--json]
  earnfi-agent sprint join --ref REF [--json]
  earnfi-agent review submit --ref-type TYPE --ref-id ID --stars N [--comment TEXT] [--tags a,b] [--token TOKEN] [--json]
  earnfi-agent stats [--agent-id ID] [--token TOKEN] [--json]

Environment:
  EARNFI_AGENT_API_BASE   Agent API v1 base URL
  EARNFI_AGENT_TOKEN      agent_token from register
  SOLANA_RPC_URL          Solana RPC (default mainnet-beta)
  SOLANA_SECRET_KEY_B58   Wallet secret for paid creates

Config file: ~/.earnfi/config.json (written by config init)
`);
}

type EarnFiConfig = {
    api_base?: string;
    agent_token?: string;
    agent_id?: string;
    agent_name?: string;
    wallet_pubkey?: string;
    rpc_url?: string;
    secret_key_b58?: string;
};

function readConfig(): EarnFiConfig {
    try {
        if (!fs.existsSync(EARNFI_CONFIG_PATH)) return {};
        const raw = fs.readFileSync(EARNFI_CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as EarnFiConfig;
        }
    } catch {
        /* ignore invalid config */
    }
    return {};
}

function writeConfig(cfg: EarnFiConfig) {
    fs.mkdirSync(EARNFI_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(EARNFI_CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

function baseUrl() {
    const cfg = readConfig();
    return (
        arg('--base-url') ||
        (process.env.EARNFI_AGENT_API_BASE || '').trim() ||
        cfg.api_base ||
        EARNFI_DEFAULT_API_BASE
    );
}

function rpcUrl() {
    const cfg = readConfig();
    return arg('--rpc') || (process.env.SOLANA_RPC_URL || '').trim() || cfg.rpc_url || 'https://api.mainnet-beta.solana.com';
}

function agentToken(): string | undefined {
    const cfg = readConfig();
    return (arg('--token') || process.env.EARNFI_AGENT_TOKEN || cfg.agent_token || '').trim() || undefined;
}

function secretKeyB58(): string | undefined {
    const cfg = readConfig();
    return (arg('--secret-key-bs58') || process.env.SOLANA_SECRET_KEY_B58 || cfg.secret_key_b58 || '').trim() || undefined;
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

function printJson(data: unknown) {
    console.log(JSON.stringify(data, null, 2));
}

function printResponse(res: JsonResponse, exitOnError = false) {
    if (jsonMode()) {
        printJson({ status: res.status, json: res.json });
    } else {
        console.log(`HTTP ${res.status}`);
        console.log(JSON.stringify(res.json, null, 2));
        const guidance = parseGuidance(res.json);
        if (guidance) {
            if (guidance.hint) console.log(`\nHint: ${guidance.hint}`);
            if (guidance.nextStep) console.log(`Next: ${guidance.nextStep}`);
        }
    }
    if (exitOnError && (res.status < 200 || res.status >= 300)) {
        process.exit(1);
    }
}

function workClient(opts: { wallet?: boolean; tokenOptional?: boolean } = {}) {
    const base = baseUrl();
    const token = agentToken();
    if (!opts.tokenOptional && !token) {
        console.error('agent_token required — pass --token, EARNFI_AGENT_TOKEN, or run config init');
        process.exit(1);
    }
    const sk = secretKeyB58();
    const wallet = opts.wallet && sk ? walletFromSecret(sk).wallet : undefined;
    if (opts.wallet && !wallet) {
        console.error('wallet required — pass --secret-key-bs58, SOLANA_SECRET_KEY_B58, or config init');
        process.exit(1);
    }
    return new EarnFiAgentClient({
        baseUrl: base,
        agentToken: token,
        wallet,
        connection: wallet ? new Connection(rpcUrl()) : undefined,
    });
}

async function cmdConfigInit() {
    const existing = readConfig();
    const sk = secretKeyB58();
    let walletPub = existing.wallet_pubkey || '';
    if (sk) {
        walletPub = walletFromSecret(sk).kp.publicKey.toBase58();
    }
    const cfg: EarnFiConfig = {
        ...existing,
        api_base: baseUrl(),
        agent_token: agentToken() || existing.agent_token,
        agent_id: arg('--agent-id') || existing.agent_id,
        agent_name: arg('--agent-name') || existing.agent_name,
        rpc_url: rpcUrl(),
        wallet_pubkey: walletPub || existing.wallet_pubkey,
        secret_key_b58: sk || existing.secret_key_b58,
    };
    writeConfig(cfg);
    if (jsonMode()) {
        printJson({ path: EARNFI_CONFIG_PATH, config: { ...cfg, secret_key_b58: cfg.secret_key_b58 ? '[redacted]' : undefined } });
    } else {
        console.log(`Wrote ${EARNFI_CONFIG_PATH}`);
        console.log(JSON.stringify({ ...cfg, secret_key_b58: cfg.secret_key_b58 ? '[redacted]' : undefined }, null, 2));
    }
}

async function cmdDoctor() {
    const client = workClient({ tokenOptional: true });
    const token = agentToken();
    const [catalogRes, railsRes] = await Promise.all([client.getCatalog(), client.get('/rails')]);
    let tokenRes: JsonResponse | null = null;
    if (token) {
        tokenRes = await client.agents.listMine('buyer', 1, 1);
    }
    const report = {
        ok:
            catalogRes.status === 200 &&
            railsRes.status >= 200 &&
            railsRes.status < 300 &&
            (token ? tokenRes?.status === 200 : true),
        catalog: { ok: catalogRes.status === 200, status: catalogRes.status },
        rails: { ok: railsRes.status >= 200 && railsRes.status < 300, status: railsRes.status, json: railsRes.json },
        token: token
            ? {
                  configured: true,
                  ok: tokenRes?.status === 200,
                  status: tokenRes?.status,
              }
            : { configured: false, ok: false, note: 'No agent_token — optional for pay-first flows' },
        base_url: baseUrl(),
    };
    printJson(report);
    process.exit(report.ok ? 0 : 1);
}

async function cmdMarketplaceList() {
    const client = workClient({ tokenOptional: true });
    const type = (arg('--type') || 'services').toLowerCase();
    const q = arg('--q');
    const capability = arg('--capability');
    const page = arg('--page') ? parseInt(arg('--page')!, 10) : undefined;
    const perPage = arg('--per-page') ? parseInt(arg('--per-page')!, 10) : undefined;
    const res =
        type === 'agents'
            ? await client.agents.browseAgents(q, capability)
            : await client.agents.browseServices(capability, q);
    printResponse(res);
}

async function cmdMarketplaceGet() {
    const agentId = arg('--agent-id') || '';
    if (!agentId) {
        console.error('marketplace get requires --agent-id');
        process.exit(1);
    }
    const client = workClient({ tokenOptional: true });
    const res = await client.agents.agentServices(agentId);
    printResponse(res);
}

async function cmdOrderCreate() {
    const serviceId = parseInt(arg('--service-id') || '0', 10);
    if (!serviceId) {
        console.error('order create requires --service-id');
        process.exit(1);
    }
    const input = parseJsonArg('--input');
    const prompt = arg('--prompt');
    if (prompt) input.prompt = prompt;
    const client = workClient();
    const res = await client.agents.createOrder(serviceId, input);
    printResponse(res, true);
}

async function cmdOrderFund() {
    const id = parseInt(arg('--id') || '0', 10);
    if (!id) {
        console.error('order fund requires --id');
        process.exit(1);
    }
    const settlementId = arg('--settlement-id') ? parseInt(arg('--settlement-id')!, 10) : undefined;
    const client = workClient({ wallet: true });
    const res = await client.fundAgentOrder(id, { settlementId });
    printResponse(res, true);
}

async function cmdOrderDeliver() {
    const id = parseInt(arg('--id') || '0', 10);
    if (!id) {
        console.error('order deliver requires --id');
        process.exit(1);
    }
    const output = parseJsonArg('--output');
    const prompt = arg('--prompt');
    if (prompt) output.prompt = prompt;
    const client = workClient();
    const res = await client.agents.deliverOrder(id, output);
    printResponse(res, true);
}

async function cmdOrderRelease() {
    const id = parseInt(arg('--id') || '0', 10);
    if (!id) {
        console.error('order release requires --id');
        process.exit(1);
    }
    const client = workClient();
    const res = await client.agents.releaseOrder(id);
    printResponse(res, true);
}

async function cmdOrderRevise() {
    const id = parseInt(arg('--id') || '0', 10);
    if (!id) {
        console.error('order revise requires --id');
        process.exit(1);
    }
    const client = workClient();
    const res = await client.agents.requestRevision(id, arg('--note') || '');
    printResponse(res, true);
}

async function cmdOrderDispute() {
    const id = parseInt(arg('--id') || '0', 10);
    const reason = arg('--reason') || '';
    if (!id || !reason) {
        console.error('order dispute requires --id and --reason');
        process.exit(1);
    }
    const client = workClient();
    const res = await client.agents.disputeOrder(id, reason);
    printResponse(res, true);
}

async function cmdOrderGet() {
    const id = parseInt(arg('--id') || '0', 10);
    if (!id) {
        console.error('order get requires --id');
        process.exit(1);
    }
    const client = workClient({ tokenOptional: true });
    const res = await client.agents.getOrder(id, arg('--secret') || '');
    printResponse(res);
}

async function cmdOrderMine() {
    const role = (arg('--role') || 'provider') as 'provider' | 'buyer';
    const page = arg('--page') ? parseInt(arg('--page')!, 10) : undefined;
    const perPage = arg('--per-page') ? parseInt(arg('--per-page')!, 10) : undefined;
    const client = workClient();
    const res = await client.agents.listMine(role, page, perPage);
    printResponse(res);
}

async function cmdDealCreate() {
    const title = arg('--title') || '';
    const body = parseJsonArg('--body');
    if (title) body.title = title;
    const amount = arg('--amount');
    if (amount) body.amount = parseFloat(amount);
    if (!body.title) {
        console.error('deal create requires --title or --body JSON with title');
        process.exit(1);
    }
    const client = workClient();
    const res = await client.agentDeals.create(body);
    printResponse(res, true);
}

async function cmdDealList() {
    const page = arg('--page') ? parseInt(arg('--page')!, 10) : undefined;
    const perPage = arg('--per-page') ? parseInt(arg('--per-page')!, 10) : undefined;
    const client = workClient();
    const res = await client.agentDeals.list(page, perPage);
    printResponse(res);
}

async function cmdDealGet() {
    const slug = arg('--slug') || '';
    if (!slug) {
        console.error('deal get requires --slug');
        process.exit(1);
    }
    const client = workClient();
    const res = await client.agentDeals.get(slug);
    printResponse(res);
}

async function cmdDealAccept() {
    const id = parseInt(arg('--id') || '0', 10);
    if (!id) {
        console.error('deal accept requires --id');
        process.exit(1);
    }
    const role = arg('--role') as 'buyer' | 'seller' | undefined;
    const inviteToken = arg('--invite-token');
    const client = workClient();
    const res = await client.agentDeals.accept(id, { role, inviteToken });
    printResponse(res, true);
}

async function cmdDealFund() {
    const id = parseInt(arg('--id') || '0', 10);
    if (!id) {
        console.error('deal fund requires --id');
        process.exit(1);
    }
    const settlementId = arg('--settlement-id') ? parseInt(arg('--settlement-id')!, 10) : undefined;
    const client = workClient({ wallet: true });
    const res = await client.fundAgentDeal(id, { settlementId });
    printResponse(res, true);
}

async function cmdDealDeliver() {
    const id = parseInt(arg('--id') || '0', 10);
    if (!id) {
        console.error('deal deliver requires --id');
        process.exit(1);
    }
    const client = workClient();
    const res = await client.agentDeals.deliver(id, {
        note: arg('--note'),
        payload: arg('--payload') || arg('--output'),
    });
    printResponse(res, true);
}

async function cmdDealRelease() {
    const id = parseInt(arg('--id') || '0', 10);
    if (!id) {
        console.error('deal release requires --id');
        process.exit(1);
    }
    const client = workClient();
    const res = await client.agentDeals.release(id);
    printResponse(res, true);
}

async function cmdBoardList() {
    const client = workClient({ tokenOptional: true });
    const q = arg('--q') || arg('--query');
    const capability = arg('--capability');
    const res = await client.agents.findWork(q, capability);
    printResponse(res);
}

const OPEN_WORK_MODES = ['brief', 'sprint', 'pitch', 'prove', 'bid'] as const;
const OPEN_WORK_EXECUTION_MODES = ['human', 'agent', 'hybrid'] as const;

async function cmdBriefList() {
    const mode = arg('--mode');
    const executionMode = arg('--execution-mode');
    if (mode && !OPEN_WORK_MODES.includes(mode as (typeof OPEN_WORK_MODES)[number])) {
        console.error(`--mode must be one of: ${OPEN_WORK_MODES.join(', ')}`);
        process.exit(1);
    }
    if (
        executionMode &&
        !OPEN_WORK_EXECUTION_MODES.includes(executionMode as (typeof OPEN_WORK_EXECUTION_MODES)[number])
    ) {
        console.error(`--execution-mode must be one of: ${OPEN_WORK_EXECUTION_MODES.join(', ')}`);
        process.exit(1);
    }
    const page = arg('--page') ? parseInt(arg('--page')!, 10) : undefined;
    const params: Record<string, string | undefined> = {};
    if (mode) params.work_mode = mode;
    if (executionMode) params.execution_mode = executionMode;
    if (page !== undefined) params.page = String(page);
    const q = arg('--q') || arg('--query');
    if (q) params.q = q;
    const client = workClient({ tokenOptional: true });
    const res = await client.get('/work/open', params);
    printResponse(res);
}

async function cmdBriefGet() {
    const ref = arg('--ref') || '';
    if (!ref) {
        console.error('brief get requires --ref');
        process.exit(1);
    }
    const client = workClient({ tokenOptional: true });
    const res = await client.get(`/work/open/${encodeURIComponent(ref)}`);
    printResponse(res);
}

async function cmdBriefSubmit(opts: { defaultPayload?: Record<string, unknown> } = {}) {
    const ref = arg('--ref') || '';
    if (!ref) {
        console.error('brief submit requires --ref');
        process.exit(1);
    }
    const payload = arg('--payload') ? parseJsonArg('--payload') : (opts.defaultPayload ?? {});
    const body: Record<string, unknown> = { payload };
    const bidMicroRaw = arg('--bid-micro');
    if (bidMicroRaw) body.bid_micro = parseInt(bidMicroRaw, 10);
    const client = workClient();
    const token = agentToken()!;
    const res = await client.post(`/work/open/${encodeURIComponent(ref)}/submit`, body, undefined, {
        'Agent-Token': token,
        'X-Agent-Token': token,
    });
    printResponse(res, true);
}

async function cmdSprintJoin() {
    const ref = arg('--ref') || '';
    if (!ref) {
        console.error('sprint join requires --ref');
        process.exit(1);
    }
    await cmdBriefSubmit({ defaultPayload: { join: true } });
}

async function cmdReviewSubmit() {
    const refType = (arg('--ref-type') || '') as WorkReviewRefType;
    const refId = arg('--ref-id') || '';
    const stars = parseInt(arg('--stars') || '0', 10);
    if (!refType || !refId || !stars) {
        console.error('review submit requires --ref-type, --ref-id, --stars');
        process.exit(1);
    }
    if (!WORK_REVIEW_REF_TYPES.includes(refType)) {
        console.error(`--ref-type must be one of: ${WORK_REVIEW_REF_TYPES.join(', ')}`);
        process.exit(1);
    }
    const tagsRaw = arg('--tags');
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    const client = workClient();
    const res = await client.reviews.submit({
        refType,
        refId,
        stars,
        comment: arg('--comment'),
        tags,
        privateNote: arg('--private-note'),
    });
    printResponse(res, true);
}

async function cmdStats() {
    const client = workClient({ tokenOptional: true });
    const agentId = arg('--agent-id') || readConfig().agent_id;
    const marketplaceRes = await client.get('/marketplace/stats');
    let usageRes: JsonResponse | null = null;
    if (agentId) {
        const token = agentToken();
        const params = token ? { agent_token: token } : undefined;
        usageRes = await client.get(`/agents/${encodeURIComponent(agentId)}/usage`, params);
    }
    const out = {
        marketplace: { status: marketplaceRes.status, json: marketplaceRes.json },
        usage: usageRes ? { status: usageRes.status, json: usageRes.json } : null,
    };
    if (jsonMode()) {
        printJson(out);
    } else {
        console.log('Marketplace stats:');
        console.log(JSON.stringify(marketplaceRes.json, null, 2));
        if (usageRes) {
            console.log('\nAgent usage:');
            console.log(JSON.stringify(usageRes.json, null, 2));
        } else if (!agentId) {
            console.log('\nAgent usage: skipped (pass --agent-id or set agent_id in config)');
        }
    }
}

async function main() {
    const cmd = process.argv[2];
    if (!cmd || cmd === '-h' || cmd === '--help') {
        usage();
        process.exit(cmd ? 0 : 1);
    }

    const sub = process.argv[3];
    const base = baseUrl();

    if (cmd === 'config' && sub === 'init') {
        await cmdConfigInit();
        return;
    }

    if (cmd === 'doctor') {
        await cmdDoctor();
        return;
    }

    if (cmd === 'marketplace' && sub === 'list') {
        await cmdMarketplaceList();
        return;
    }

    if (cmd === 'marketplace' && sub === 'get') {
        await cmdMarketplaceGet();
        return;
    }

    if (cmd === 'order' && sub === 'create') {
        await cmdOrderCreate();
        return;
    }

    if (cmd === 'order' && sub === 'fund') {
        await cmdOrderFund();
        return;
    }

    if (cmd === 'order' && sub === 'deliver') {
        await cmdOrderDeliver();
        return;
    }

    if (cmd === 'order' && sub === 'release') {
        await cmdOrderRelease();
        return;
    }

    if (cmd === 'order' && sub === 'revise') {
        await cmdOrderRevise();
        return;
    }

    if (cmd === 'order' && sub === 'dispute') {
        await cmdOrderDispute();
        return;
    }

    if (cmd === 'order' && sub === 'get') {
        await cmdOrderGet();
        return;
    }

    if (cmd === 'order' && sub === 'mine') {
        await cmdOrderMine();
        return;
    }

    if (cmd === 'deal' && sub === 'create') {
        await cmdDealCreate();
        return;
    }

    if (cmd === 'deal' && sub === 'list') {
        await cmdDealList();
        return;
    }

    if (cmd === 'deal' && sub === 'get') {
        await cmdDealGet();
        return;
    }

    if (cmd === 'deal' && sub === 'accept') {
        await cmdDealAccept();
        return;
    }

    if (cmd === 'deal' && sub === 'fund') {
        await cmdDealFund();
        return;
    }

    if (cmd === 'deal' && sub === 'deliver') {
        await cmdDealDeliver();
        return;
    }

    if (cmd === 'deal' && sub === 'release') {
        await cmdDealRelease();
        return;
    }

    if (cmd === 'board' && sub === 'list') {
        await cmdBoardList();
        return;
    }

    if (cmd === 'brief' && sub === 'list') {
        await cmdBriefList();
        return;
    }

    if (cmd === 'brief' && sub === 'get') {
        await cmdBriefGet();
        return;
    }

    if (cmd === 'brief' && sub === 'submit') {
        await cmdBriefSubmit();
        return;
    }

    if (cmd === 'sprint' && sub === 'join') {
        await cmdSprintJoin();
        return;
    }

    if (cmd === 'review' && sub === 'submit') {
        await cmdReviewSubmit();
        return;
    }

    if (cmd === 'stats') {
        await cmdStats();
        return;
    }

    if (cmd === 'catalog') {
        const client = new EarnFiAgentClient({ baseUrl: base });
        const res = await client.getCatalog();
        if (jsonMode()) printJson({ status: res.status, json: res.json });
        else console.log(JSON.stringify(res.json, null, 2));
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
        const skB58 = secretKeyB58() || '';
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
        const skB58 = secretKeyB58() || '';
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
        const token = agentToken() || '';
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
        const token = agentToken() || '';
        const skB58 = secretKeyB58() || '';
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
        const token = agentToken() || '';
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
        const skB58 = secretKeyB58() || '';
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
        const token = agentToken() || '';
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

    console.error('Unknown command:', cmd, sub || '');
    usage();
    process.exit(1);
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
