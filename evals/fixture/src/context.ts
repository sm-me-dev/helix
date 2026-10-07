// Request context: who is calling, and which limiter class applies.
export type RequestContext = {
  user: string | null;
  apiKey: string | null;
  limiterClass: "public" | "auth";
};

export function anonymousContext(): RequestContext {
  return { user: null, apiKey: null, limiterClass: "public" };
}
