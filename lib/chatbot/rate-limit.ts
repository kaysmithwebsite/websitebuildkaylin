/**
 * Best-effort per-IP rate limiting for the chat endpoint, backed by Netlify
 * Blobs (global store, strong consistency so a burst can't race past the
 * limit within the same deploy). "Best effort" because Blobs' last-write-wins
 * model has no real locking — acceptable here: the goal is deterring abuse
 * and runaway API cost, not a hard security boundary.
 *
 * The whole thing fails open: if Blobs isn't reachable or isn't configured
 * in the current environment at all (getStore() itself can throw outside a
 * real Netlify runtime, not just its .get()/.set() calls), this returns
 * {allowed:true} rather than letting the chat endpoint 500. A rate limiter
 * outage should never take the chatbot down.
 */
import { getStore } from "@netlify/blobs";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 12;

interface Bucket {
  windowStart: number;
  count: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export async function checkRateLimit(ip: string): Promise<RateLimitResult> {
  try {
    const store = getStore({ name: "chat-rate-limit", consistency: "strong" });
    const key = `ip:${ip}`;
    const now = Date.now();

    let bucket: Bucket | null = await store.get(key, { type: "json" });
    if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
      bucket = { windowStart: now, count: 0 };
    }
    bucket.count += 1;

    if (bucket.count > MAX_REQUESTS_PER_WINDOW) {
      const retryAfterSeconds = Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000);
      return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
    }

    await store.setJSON(key, bucket);
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}
