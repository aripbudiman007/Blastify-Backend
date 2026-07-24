import { prisma } from '../prisma/client';
import { renderTemplate } from '../utils/template';
import { MessageType } from '@prisma/client';

const TEMPLATE_LIMIT_DEFAULTS: Record<string, number> = {
  FREE: 5, LITE: 20, REGULAR: 50, MASTER: 200, ULTRA: -1,
};

async function checkTemplateLimit(userId: string, plan: string) {
  let max = TEMPLATE_LIMIT_DEFAULTS[plan] ?? 5;
  try {
    const planLimit = await (prisma as any).planLimit.findUnique({ where: { plan } });
    if (planLimit?.maxTemplates != null) max = planLimit.maxTemplates;
  } catch { /* use defaults */ }

  if (max === -1) return; // unlimited

  const count = await prisma.messageTemplate.count({ where: { userId } });
  if (count >= max) {
    const err = new Error(`Template limit reached for your plan (max ${max}). Upgrade to create more.`) as any;
    err.status = 403; err.code = 'TEMPLATE_LIMIT_REACHED'; throw err;
  }
}

export interface TemplateInput {
  name: string;
  category?: string;
  type?: MessageType;
  content: string;
  mediaUrl?: string;
  caption?: string;
}

export async function listTemplates(userId: string, filter: { category?: string; search?: string; page?: number; limit?: number } = {}) {
  const { category, search, page = 1, limit = 20 } = filter;
  const skip = (page - 1) * limit;
  const where: any = { userId, isActive: true };
  if (category) where.category = category;
  if (search) where.name = { contains: search, mode: 'insensitive' };

  const [total, data] = await Promise.all([
    prisma.messageTemplate.count({ where }),
    prisma.messageTemplate.findMany({
      where, orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
      skip, take: limit,
    }),
  ]);
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function getTemplate(userId: string, id: string) {
  const tpl = await prisma.messageTemplate.findFirst({ where: { id, userId } });
  if (!tpl) {
    const err = new Error('Template not found') as any;
    err.status = 404; err.code = 'NOT_FOUND'; throw err;
  }
  return tpl;
}

export async function createTemplate(userId: string, plan: string, input: TemplateInput) {
  await checkTemplateLimit(userId, plan);
  return prisma.messageTemplate.create({
    data: {
      userId,
      name: input.name,
      category: input.category ?? 'general',
      type: input.type ?? 'TEXT',
      content: input.content,
      mediaUrl: input.mediaUrl ?? null,
      caption: input.caption ?? null,
    },
  });
}

export async function updateTemplate(userId: string, id: string, input: Partial<TemplateInput> & { isActive?: boolean }) {
  await getTemplate(userId, id);
  return prisma.messageTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.mediaUrl !== undefined ? { mediaUrl: input.mediaUrl } : {}),
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

export async function deleteTemplate(userId: string, id: string) {
  await getTemplate(userId, id);
  await prisma.messageTemplate.delete({ where: { id } });
}

export async function useTemplate(
  userId: string,
  id: string,
  vars: Record<string, string> = {},
) {
  const tpl = await getTemplate(userId, id);
  await prisma.messageTemplate.update({ where: { id }, data: { usageCount: { increment: 1 } } });
  const rendered = renderTemplate(tpl.content, vars);
  const caption = tpl.caption ? renderTemplate(tpl.caption, vars) : undefined;
  return { ...tpl, renderedContent: rendered, renderedCaption: caption };
}
