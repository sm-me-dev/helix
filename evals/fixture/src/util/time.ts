// UTC calendar-day key for quota windows.
export function dayString(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}
