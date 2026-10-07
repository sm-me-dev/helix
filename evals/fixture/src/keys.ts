// Test keys only. Production keys live in the secrets manager, never here.
export const TEST_KEYS: Record<string, string> = {
  "key-test-1": "alice",
  "key-test-2": "bob",
};

export function userForKey(apiKey: string): string | null {
  return TEST_KEYS[apiKey] ?? null;
}
