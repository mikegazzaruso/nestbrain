// Simple in-memory rate limiter for LLM calls
const calls: number[] = [];
const MAX_CALLS_PER_MINUTE = 20;

export function checkRateLimit(): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;

  // Remove old entries
  while (calls.length > 0 && calls[0] < oneMinuteAgo) {
    calls.shift();
  }

  if (calls.length >= MAX_CALLS_PER_MINUTE) {
    const retryAfter = Math.ceil((calls[0] + 60_000 - now) / 1000);
    return { allowed: false, retryAfter };
  }

  calls.push(now);
  return { allowed: true };
}
