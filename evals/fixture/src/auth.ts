import { anonymousContext, type RequestContext } from "./context.ts";
import { userForKey } from "./keys.ts";

// Stamps who the caller is. Deliberately does NOT decide the limiter class:
// that belongs to RequestContext so cookie and key paths share it (task 3).
export function authenticate(headers: Record<string, string>): RequestContext {
  const ctx = anonymousContext();
  const key = headers["x-api-key"];
  if (!key) return ctx;
  const user = userForKey(key);
  if (!user) return ctx;
  ctx.user = user;
  ctx.apiKey = key;
  return ctx;
}
