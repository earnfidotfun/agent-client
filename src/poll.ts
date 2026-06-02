import type { JsonResponse } from './types.js';

export type PollOptions = {
    intervalMs?: number;
    timeoutMs?: number;
    until?: (res: JsonResponse) => boolean;
};

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

/** Poll a function until `until` matches or timeout. */
export async function pollUntil(
    fn: () => Promise<JsonResponse>,
    opts: PollOptions = {}
): Promise<JsonResponse> {
    const intervalMs = opts.intervalMs ?? 5_000;
    const timeoutMs = opts.timeoutMs ?? 300_000;
    const until = opts.until ?? ((r) => r.status === 200);
    const deadline = Date.now() + timeoutMs;
    let last: JsonResponse = { status: 0, headers: new Headers(), json: null };

    while (Date.now() < deadline) {
        last = await fn();
        if (until(last)) return last;
        await sleep(intervalMs);
    }

    return last;
}
