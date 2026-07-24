import { describe, it, expect, vi, beforeEach } from 'vitest';

const deviceRow: { sessionData: string | null } = { sessionData: null };

vi.mock('../prisma/client', () => ({
  prisma: {
    device: {
      findUnique: vi.fn(async () => ({ sessionData: deviceRow.sessionData })),
      update: vi.fn(async ({ data }: { data: { sessionData?: string | null } }) => {
        if (data.sessionData !== undefined) deviceRow.sessionData = data.sessionData;
        return {};
      }),
    },
  },
}));

import { loadAuthState } from './session';

describe('loadAuthState session persistence', () => {
  beforeEach(() => {
    deviceRow.sessionData = null;
  });

  it('persists signal keys written via keys.set() and reloads them on a fresh instance', async () => {
    const { state } = await loadAuthState('device-1');

    await state.keys.set({
      'pre-key': { '1': { keyPair: { public: 'AA==', private: 'BB==' } } },
    } as any);

    expect(deviceRow.sessionData).not.toBeNull();

    const reloaded = await loadAuthState('device-1');
    const fetched = await reloaded.state.keys.get('pre-key' as any, ['1']);
    expect(fetched['1']).toBeDefined();
  });

  it('does not wipe previously persisted keys when saveState() runs again (creds.update regression)', async () => {
    const { state, saveState } = await loadAuthState('device-1');

    await state.keys.set({
      session: { abc: { registrationId: 42 } },
    } as any);

    // Simulate Baileys firing `creds.update` after the key store already wrote
    // data. Before the fix, this handler persisted an empty `keys: {}` because
    // it read a non-existent `__keys` property off the cacheable key store,
    // silently deleting every signal key just written above.
    await saveState();

    const reloaded = await loadAuthState('device-1');
    const fetched = await reloaded.state.keys.get('session' as any, ['abc']);
    expect(fetched.abc).toEqual({ registrationId: 42 });
  });
});
