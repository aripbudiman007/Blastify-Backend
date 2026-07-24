/**
 * Warm-up schedule (anti-ban ramp-up for freshly connected numbers).
 * WhatsApp is far more likely to flag/ban a number that suddenly sends high
 * volume right after connecting. This ramps daily volume up over ~14 days
 * and slows the per-message delay down proportionally during that window.
 */
export interface WarmupStage {
  day: number;
  maxMessagesPerDay: number; // -1 = warm-up finished, no extra cap (plan quota still applies)
  delayMultiplier: number;
}

const WARMUP_SCHEDULE: WarmupStage[] = [
  { day: 1, maxMessagesPerDay: 20, delayMultiplier: 3 },
  { day: 3, maxMessagesPerDay: 40, delayMultiplier: 2.5 },
  { day: 5, maxMessagesPerDay: 80, delayMultiplier: 2 },
  { day: 7, maxMessagesPerDay: 150, delayMultiplier: 1.5 },
  { day: 10, maxMessagesPerDay: 300, delayMultiplier: 1.2 },
  { day: 14, maxMessagesPerDay: -1, delayMultiplier: 1 },
];

export function getWarmupDay(startedAt: Date, now: Date = new Date()): number {
  const diffMs = now.getTime() - startedAt.getTime();
  return Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1);
}

/** Resolve the active warm-up stage for a device given when it started warming up. */
export function getWarmupStage(startedAt: Date, now: Date = new Date()): WarmupStage & { isWarmingUp: boolean } {
  const day = getWarmupDay(startedAt, now);
  let stage = WARMUP_SCHEDULE[0];
  for (const s of WARMUP_SCHEDULE) {
    if (day >= s.day) stage = s;
  }
  return { ...stage, day, isWarmingUp: stage.maxMessagesPerDay !== -1 };
}
