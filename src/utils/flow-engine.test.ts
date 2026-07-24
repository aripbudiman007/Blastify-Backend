import { describe, it, expect, vi } from 'vitest';
import { advanceFlow, FlowNode, FlowSessionState } from './flow-engine';

function makeCtx() {
  const sent: Array<{ text?: string; mediaUrl?: string }> = [];
  const actions: Array<{ action: string; variables: Record<string, string> }> = [];
  return {
    sent,
    actions,
    ctx: {
      sendMessage: vi.fn(async (content: { text?: string; mediaUrl?: string }) => {
        sent.push(content);
      }),
      runAction: vi.fn(async (node: any, variables: Record<string, string>) => {
        actions.push({ action: node.action, variables });
      }),
    },
  };
}

describe('advanceFlow', () => {
  it('chains message nodes and completes when a node has no next', async () => {
    const nodes: FlowNode[] = [
      { id: 'a', type: 'message', text: 'Halo {{name}}', next: 'b' },
      { id: 'b', type: 'message', text: 'Selamat datang' },
    ];
    const session: FlowSessionState = { currentNodeId: 'a', variables: { name: 'Budi' }, status: 'ACTIVE' };
    const { ctx, sent } = makeCtx();

    const result = await advanceFlow(nodes, session, null, ctx);

    expect(sent.map((s) => s.text)).toEqual(['Halo Budi', 'Selamat datang']);
    expect(result.status).toBe('COMPLETED');
    expect(result.currentNodeId).toBe('b');
  });

  it('stops at a question node and waits for a reply', async () => {
    const nodes: FlowNode[] = [
      { id: 'q1', type: 'question', text: 'Siapa nama Anda?', saveAs: 'name', next: 'end' },
      { id: 'end', type: 'end' },
    ];
    const session: FlowSessionState = { currentNodeId: 'q1', variables: {}, status: 'ACTIVE' };
    const { ctx, sent } = makeCtx();

    const result = await advanceFlow(nodes, session, null, ctx);

    expect(sent).toEqual([{ text: 'Siapa nama Anda?' }]);
    expect(result.status).toBe('ACTIVE');
    expect(result.currentNodeId).toBe('q1');
  });

  it('saves the reply into variables and continues past the question node', async () => {
    const nodes: FlowNode[] = [
      { id: 'q1', type: 'question', text: 'Siapa nama Anda?', saveAs: 'name', next: 'greet' },
      { id: 'greet', type: 'message', text: 'Halo {{name}}!' },
    ];
    const session: FlowSessionState = { currentNodeId: 'q1', variables: {}, status: 'ACTIVE' };
    const { ctx, sent } = makeCtx();

    const result = await advanceFlow(nodes, session, 'Budi', ctx);

    expect(result.variables.name).toBe('Budi');
    expect(sent).toEqual([{ text: 'Halo Budi!' }]);
    expect(result.status).toBe('COMPLETED');
  });

  it('branches on a condition node using the matching branch', async () => {
    const nodes: FlowNode[] = [
      {
        id: 'c1',
        type: 'condition',
        variable: 'choice',
        branches: [
          { matchType: 'EXACT', value: '1', next: 'buy' },
          { matchType: 'EXACT', value: '2', next: 'support' },
        ],
        default: 'fallback',
      },
      { id: 'buy', type: 'message', text: 'Menuju pembelian' },
      { id: 'support', type: 'message', text: 'Menuju support' },
      { id: 'fallback', type: 'message', text: 'Pilihan tidak dikenali' },
    ];
    const { ctx, sent } = makeCtx();

    const result = await advanceFlow(
      nodes,
      { currentNodeId: 'c1', variables: { choice: '2' }, status: 'ACTIVE' },
      null,
      ctx,
    );

    expect(sent).toEqual([{ text: 'Menuju support' }]);
    expect(result.currentNodeId).toBe('support');
  });

  it('falls back to the default branch when nothing matches', async () => {
    const nodes: FlowNode[] = [
      {
        id: 'c1',
        type: 'condition',
        variable: 'choice',
        branches: [{ matchType: 'EXACT', value: '1', next: 'buy' }],
        default: 'fallback',
      },
      { id: 'buy', type: 'message', text: 'Menuju pembelian' },
      { id: 'fallback', type: 'message', text: 'Pilihan tidak dikenali' },
    ];
    const { ctx, sent } = makeCtx();

    const result = await advanceFlow(
      nodes,
      { currentNodeId: 'c1', variables: { choice: 'zzz' }, status: 'ACTIVE' },
      null,
      ctx,
    );

    expect(sent).toEqual([{ text: 'Pilihan tidak dikenali' }]);
    expect(result.currentNodeId).toBe('fallback');
  });

  it('runs action nodes via ctx.runAction and continues to next', async () => {
    const nodes: FlowNode[] = [
      { id: 'a1', type: 'action', action: 'ADD_LABEL', params: { labelName: 'lead-baru' }, next: 'done' },
      { id: 'done', type: 'message', text: 'Selesai' },
    ];
    const { ctx, sent, actions } = makeCtx();

    const result = await advanceFlow(
      nodes,
      { currentNodeId: 'a1', variables: {}, status: 'ACTIVE' },
      null,
      ctx,
    );

    expect(actions).toEqual([{ action: 'ADD_LABEL', variables: {} }]);
    expect(sent).toEqual([{ text: 'Selesai' }]);
    expect(result.status).toBe('COMPLETED');
  });

  it('stops immediately at an end node', async () => {
    const nodes: FlowNode[] = [{ id: 'x', type: 'end' }];
    const { ctx, sent } = makeCtx();

    const result = await advanceFlow(nodes, { currentNodeId: 'x', variables: {}, status: 'ACTIVE' }, null, ctx);

    expect(sent).toEqual([]);
    expect(result.status).toBe('COMPLETED');
  });

  it('breaks out of an infinite loop via the hop-count safety limit', async () => {
    // A misconfigured flow: two messages that point at each other forever, no question node to break it.
    const nodes: FlowNode[] = [
      { id: 'a', type: 'message', text: 'ping', next: 'b' },
      { id: 'b', type: 'message', text: 'pong', next: 'a' },
    ];
    const { ctx, sent } = makeCtx();

    const result = await advanceFlow(nodes, { currentNodeId: 'a', variables: {}, status: 'ACTIVE' }, null, ctx);

    expect(sent.length).toBeGreaterThan(0);
    expect(sent.length).toBeLessThan(1000); // proves it terminated, not that it ran forever
    expect(result.status).toBe('COMPLETED');
  });

  it('completes gracefully if currentNodeId no longer exists in the flow', async () => {
    const nodes: FlowNode[] = [{ id: 'a', type: 'message', text: 'hi' }];
    const { ctx } = makeCtx();

    const result = await advanceFlow(nodes, { currentNodeId: 'missing', variables: {}, status: 'ACTIVE' }, null, ctx);

    expect(result.status).toBe('COMPLETED');
    expect(result.currentNodeId).toBe('missing');
  });
});
