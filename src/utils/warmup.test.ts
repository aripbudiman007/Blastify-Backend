import { describe, it, expect } from 'vitest';
import { getWarmupDay, getWarmupStage } from './warmup';

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

describe('getWarmupDay', () => {
  it('is day 1 right when warm-up starts', () => {
    expect(getWarmupDay(new Date())).toBe(1);
  });

  it('advances one day per 24h elapsed', () => {
    expect(getWarmupDay(daysAgo(2))).toBe(3);
  });
});

describe('getWarmupStage', () => {
  it('caps volume tightly and slows delay on day 1', () => {
    const stage = getWarmupStage(new Date());
    expect(stage.day).toBe(1);
    expect(stage.maxMessagesPerDay).toBe(20);
    expect(stage.delayMultiplier).toBe(3);
    expect(stage.isWarmingUp).toBe(true);
  });

  it('picks the highest schedule entry not exceeding the current day', () => {
    const stage = getWarmupStage(daysAgo(6)); // day 7
    expect(stage.day).toBe(7);
    expect(stage.maxMessagesPerDay).toBe(150);
  });

  it('ends warm-up (no cap, normal delay) after day 14', () => {
    const stage = getWarmupStage(daysAgo(20));
    expect(stage.maxMessagesPerDay).toBe(-1);
    expect(stage.delayMultiplier).toBe(1);
    expect(stage.isWarmingUp).toBe(false);
  });
});
