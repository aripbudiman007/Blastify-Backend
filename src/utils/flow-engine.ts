import { KeywordMatchType } from '@prisma/client';
import { renderTemplate } from './template';
import { matchesKeyword } from './keyword-match';

/**
 * Chat flow node shapes. Stored as `ChatFlow.nodes` (JSON array) — this is the
 * backend engine for a JSON-defined multi-step chatbot. There is no visual
 * builder; flows are authored as JSON via the API.
 */
export type FlowNode =
  | { id: string; type: 'message'; text: string; mediaUrl?: string; next?: string }
  | { id: string; type: 'question'; text: string; saveAs: string; next: string }
  | {
      id: string;
      type: 'condition';
      variable: string;
      branches: Array<{ matchType: KeywordMatchType; value: string; next: string }>;
      default?: string;
    }
  | { id: string; type: 'action'; action: string; params?: Record<string, any>; next?: string }
  | { id: string; type: 'end' };

export interface FlowSessionState {
  currentNodeId: string;
  variables: Record<string, string>;
  status: 'ACTIVE' | 'COMPLETED';
}

export interface FlowRunContext {
  sendMessage: (content: { text?: string; mediaUrl?: string }) => Promise<void>;
  runAction?: (node: Extract<FlowNode, { type: 'action' }>, variables: Record<string, string>) => Promise<void>;
}

const MAX_HOPS = 25;

/**
 * Advance a flow's state machine by one user turn.
 *
 * `incomingText === null` means "just entered the flow" (fresh trigger) —
 * the current node is processed as-is. Otherwise the current node is assumed
 * to be a `question` awaiting a reply: the answer is saved before continuing.
 *
 * Runs nodes in sequence until it hits a `question` (stops and waits for the
 * next reply) or an `end`/dead-end node (marks the session COMPLETED), or a
 * hop-count safety limit is reached (guards against a misconfigured flow
 * with a cycle that has no question node to break it).
 */
export async function advanceFlow(
  nodes: FlowNode[],
  session: FlowSessionState,
  incomingText: string | null,
  ctx: FlowRunContext,
): Promise<FlowSessionState> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const variables = { ...session.variables };

  let current = byId.get(session.currentNodeId);
  let lastId = session.currentNodeId;
  if (!current) return { currentNodeId: lastId, variables, status: 'COMPLETED' };

  if (current.type === 'question' && incomingText !== null) {
    variables[current.saveAs] = incomingText;
    lastId = current.next;
    current = byId.get(current.next);
  }

  let hops = 0;
  while (current) {
    lastId = current.id;
    if (hops++ > MAX_HOPS) {
      return { currentNodeId: lastId, variables, status: 'COMPLETED' };
    }

    switch (current.type) {
      case 'message': {
        await ctx.sendMessage({ text: renderTemplate(current.text, variables), mediaUrl: current.mediaUrl });
        if (!current.next) return { currentNodeId: lastId, variables, status: 'COMPLETED' };
        lastId = current.next;
        current = byId.get(current.next);
        break;
      }
      case 'question': {
        await ctx.sendMessage({ text: renderTemplate(current.text, variables) });
        return { currentNodeId: current.id, variables, status: 'ACTIVE' };
      }
      case 'condition': {
        const value = variables[current.variable] ?? '';
        const branch = current.branches.find((b) => matchesKeyword(value, b.value, b.matchType));
        const nextId = branch?.next ?? current.default;
        if (!nextId) return { currentNodeId: lastId, variables, status: 'COMPLETED' };
        lastId = nextId;
        current = byId.get(nextId);
        break;
      }
      case 'action': {
        await ctx.runAction?.(current, variables);
        if (!current.next) return { currentNodeId: lastId, variables, status: 'COMPLETED' };
        lastId = current.next;
        current = byId.get(current.next);
        break;
      }
      case 'end':
        return { currentNodeId: current.id, variables, status: 'COMPLETED' };
    }
  }

  return { currentNodeId: lastId, variables, status: 'COMPLETED' };
}
