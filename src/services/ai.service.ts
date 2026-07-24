import axios from 'axios';
import { config } from '../config';
import { logger } from '../config/logger';
import { prisma } from '../prisma/client';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export function isAiEnabled(): boolean {
  if (config.AI_PROVIDER === 'gemini') return Boolean(config.GEMINI_API_KEY);
  return Boolean(config.OPENAI_API_KEY);
}

const DEFAULT_SYSTEM_PROMPT =
  'Kamu adalah asisten customer service WhatsApp yang ramah dan ringkas. ' +
  'Jawab dalam bahasa yang sama dengan pesan pelanggan. Maksimal 3 kalimat.';

/**
 * Generate an AI reply. `systemPrompt` comes from the AutoReply rule's
 * replyContent; falls back to a generic CS assistant prompt.
 * Returns null on failure — caller must not send anything in that case.
 */
export async function generateAiReply(
  systemPrompt: string | null,
  history: ChatTurn[],
  userMessage: string,
): Promise<string | null> {
  if (!isAiEnabled()) return null;
  const system = systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;

  try {
    if (config.AI_PROVIDER === 'gemini') {
      return await callGemini(system, history, userMessage);
    }
    return await callOpenAi(system, history, userMessage);
  } catch (err: any) {
    const detail = err.response?.data?.error?.message ?? err.message;
    logger.error(`AI reply generation failed (${config.AI_PROVIDER}): ${detail}`);
    return null;
  }
}

async function callGemini(
  system: string,
  history: ChatTurn[],
  userMessage: string,
): Promise<string | null> {
  const contents = [
    ...history.map((t) => ({
      role: t.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: t.text }],
    })),
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  const { data } = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_MODEL}:generateContent`,
    {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: config.AI_MAX_OUTPUT_TOKENS, temperature: 0.7 },
    },
    {
      headers: { 'x-goog-api-key': config.GEMINI_API_KEY, 'Content-Type': 'application/json' },
      timeout: 30_000,
    },
  );

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p: any) => p.text ?? '')
    .join('')
    .trim();
  return text || null;
}

async function callOpenAi(
  system: string,
  history: ChatTurn[],
  userMessage: string,
): Promise<string | null> {
  const messages = [
    { role: 'system', content: system },
    ...history.map((t) => ({ role: t.role, content: t.text })),
    { role: 'user', content: userMessage },
  ];

  const { data } = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: config.OPENAI_MODEL,
      messages,
      max_completion_tokens: config.AI_MAX_OUTPUT_TOKENS,
    },
    {
      headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 30_000,
    },
  );

  return data?.choices?.[0]?.message?.content?.trim() || null;
}

// ─── AI usage metering (kuota bulanan per plan) ───────────────────────────────

export function currentAiMonth(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

export async function getAiUsage(userId: string): Promise<number> {
  const row = await prisma.aiUsageCounter.findUnique({
    where: { userId_month: { userId, month: currentAiMonth() } },
    select: { count: true },
  });
  return row?.count ?? 0;
}

/** true bila user masih punya sisa kuota balasan AI bulan ini */
export async function hasAiQuota(userId: string, aiMonthlyReplies: number): Promise<boolean> {
  if (aiMonthlyReplies === -1) return true; // unlimited
  if (aiMonthlyReplies <= 0) return false;  // plan tanpa kuota AI
  const used = await getAiUsage(userId);
  return used < aiMonthlyReplies;
}

export async function incrementAiUsage(userId: string): Promise<void> {
  const month = currentAiMonth();
  await prisma.aiUsageCounter.upsert({
    where: { userId_month: { userId, month } },
    create: { userId, month, count: 1 },
    update: { count: { increment: 1 } },
  });
}

/**
 * Build recent conversation context for a contact from the inbox.
 * Incoming messages become "user" turns; auto-reply answers (repliedWith)
 * become "assistant" turns.
 */
export async function buildConversationContext(
  deviceId: string,
  fromJid: string,
): Promise<ChatTurn[]> {
  const phone = fromJid.split('@')[0];
  const recent = await prisma.incomingMessage.findMany({
    where: { deviceId, from: { contains: phone } },
    orderBy: { createdAt: 'desc' },
    take: config.AI_CONTEXT_MESSAGES,
    select: { content: true, repliedWith: true },
  });

  const turns: ChatTurn[] = [];
  // reverse → chronological order
  for (const msg of recent.reverse()) {
    if (msg.content) turns.push({ role: 'user', text: msg.content });
    if (msg.repliedWith) turns.push({ role: 'assistant', text: msg.repliedWith });
  }
  return turns;
}
