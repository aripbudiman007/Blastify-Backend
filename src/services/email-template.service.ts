import { prisma } from '../prisma/client';

export interface EmailTemplateInput {
  name: string;
  category?: string;
  subject: string;
  htmlContent: string;
  plainTextContent?: string;
}

function extractVariables(...texts: string[]): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  for (const text of texts) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) found.add(match[1]);
  }
  return [...found];
}

export function renderEmailTemplate(text: string, variables: Record<string, any> = {}): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) =>
    variables[key] !== undefined && variables[key] !== null ? String(variables[key]) : '');
}

export async function listEmailTemplates(userId: string) {
  const [userTemplates, defaults] = await Promise.all([
    prisma.emailTemplate.findMany({ where: { userId, deletedAt: null }, orderBy: { category: 'asc' } }),
    prisma.emailTemplate.findMany({ where: { userId: null, deletedAt: null }, orderBy: { category: 'asc' } }),
  ]);
  const overriddenSlugs = new Set(userTemplates.map((t) => t.slug));
  const inherited = defaults.filter((t) => !overriddenSlugs.has(t.slug));
  return [...userTemplates, ...inherited].sort((a, b) => a.category.localeCompare(b.category));
}

export async function getEmailTemplate(userId: string, id: string) {
  const tpl = await prisma.emailTemplate.findFirst({
    where: { id, deletedAt: null, OR: [{ userId }, { userId: null }] },
  });
  if (!tpl) {
    const err = new Error('Email template not found') as any;
    err.status = 404; err.code = 'NOT_FOUND'; throw err;
  }
  return tpl;
}

export async function createEmailTemplate(userId: string, input: EmailTemplateInput) {
  const slug = input.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (!slug) {
    const err = new Error('Template name must contain at least one alphanumeric character') as any;
    err.status = 400; err.code = 'INVALID_NAME'; throw err;
  }
  const existing = await prisma.emailTemplate.findFirst({ where: { userId, slug, deletedAt: null } });
  if (existing) {
    const err = new Error('You already have a template with this name') as any;
    err.status = 409; err.code = 'TEMPLATE_EXISTS'; throw err;
  }

  const variables = extractVariables(input.subject, input.htmlContent, input.plainTextContent ?? '');
  const tpl = await prisma.emailTemplate.create({
    data: {
      userId,
      name: input.name,
      slug,
      category: input.category ?? 'notification',
      subject: input.subject,
      htmlContent: input.htmlContent,
      plainTextContent: input.plainTextContent ?? null,
      variables,
      isDefault: false,
      isActive: true,
    },
  });

  await prisma.emailTemplateVersion.create({
    data: { templateId: tpl.id, version: 1, subject: tpl.subject, htmlContent: tpl.htmlContent, createdBy: userId },
  });

  return tpl;
}

export async function updateEmailTemplate(
  userId: string,
  id: string,
  input: Partial<Pick<EmailTemplateInput, 'subject' | 'htmlContent' | 'plainTextContent'>> & { isActive?: boolean },
) {
  const tpl = await prisma.emailTemplate.findFirst({ where: { id, userId, deletedAt: null } });
  if (!tpl) {
    const err = new Error('Email template not found') as any;
    err.status = 404; err.code = 'NOT_FOUND'; throw err;
  }

  const nextSubject = input.subject ?? tpl.subject;
  const nextHtml = input.htmlContent ?? tpl.htmlContent;
  const nextPlain = input.plainTextContent !== undefined ? input.plainTextContent : tpl.plainTextContent;
  const contentChanged = nextSubject !== tpl.subject || nextHtml !== tpl.htmlContent;
  const nextVersion = contentChanged ? tpl.version + 1 : tpl.version;

  const updated = await prisma.emailTemplate.update({
    where: { id },
    data: {
      subject: nextSubject,
      htmlContent: nextHtml,
      plainTextContent: nextPlain,
      variables: extractVariables(nextSubject, nextHtml, nextPlain ?? ''),
      version: nextVersion,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });

  if (contentChanged) {
    await prisma.emailTemplateVersion.create({
      data: { templateId: id, version: nextVersion, subject: nextSubject, htmlContent: nextHtml, createdBy: userId },
    });
  }

  return updated;
}

export async function deleteEmailTemplate(userId: string, id: string) {
  const tpl = await prisma.emailTemplate.findFirst({ where: { id, userId, deletedAt: null } });
  if (!tpl) {
    const err = new Error('Email template not found') as any;
    err.status = 404; err.code = 'NOT_FOUND'; throw err;
  }
  await prisma.emailTemplate.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function sendTestEmailTemplate(
  userId: string,
  id: string,
  recipientEmail: string,
  variables: Record<string, any> = {},
) {
  const tpl = await getEmailTemplate(userId, id);
  const { sendEmail } = await import('./email.service');
  await sendEmail(recipientEmail, renderEmailTemplate(tpl.subject, variables), renderEmailTemplate(tpl.htmlContent, variables));
}
