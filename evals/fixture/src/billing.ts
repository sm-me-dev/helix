// Plan tiers for billing clients. Boring on purpose: the refactor task
// must not change any of this behavior.
export type Plan = "free" | "team" | "scale";

const LIMITS: Record<Plan, number> = { free: 40, team: 400, scale: 4000 };

export function planLimit(plan: Plan): number {
  return LIMITS[plan];
}

export function planForApiKey(apiKey: string): Plan {
  if (apiKey === "key-test-2") return "team";
  return "free";
}
