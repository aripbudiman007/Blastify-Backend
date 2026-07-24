import { Response, NextFunction } from 'express';
import { prisma } from '../../prisma/client';
import { AdminRequest } from '../../middleware/admin.middleware';
import { logAudit } from '../../utils/audit';
import { errorResponse } from '../../utils/response';

function extractVariables(...texts: string[]): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  for (const text of texts) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) found.add(match[1]);
  }
  return [...found];
}

// System-wide (default) templates — userId is always null.

export async function listGlobalTemplates(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const data = await prisma.emailTemplate.findMany({
      where: { userId: null, deletedAt: null },
      orderBy: { category: 'asc' },
    });
    res.json({ success: true, data: { templates: data } });
  } catch (err) { next(err); }
}

export async function createGlobalTemplate(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const { name, slug, category, subject, htmlContent, plainTextContent } = req.body;
    const existing = await prisma.emailTemplate.findFirst({ where: { userId: null, slug, deletedAt: null } });
    if (existing) {
      errorResponse(res, 409, 'TEMPLATE_EXISTS', 'A default template with this slug already exists');
      return;
    }

    const data = await prisma.emailTemplate.create({
      data: {
        userId: null,
        name,
        slug,
        category: category ?? 'notification',
        subject,
        htmlContent,
        plainTextContent: plainTextContent ?? null,
        variables: extractVariables(subject, htmlContent, plainTextContent ?? ''),
        isDefault: true,
        isActive: true,
      },
    });

    await prisma.emailTemplateVersion.create({
      data: { templateId: data.id, version: 1, subject: data.subject, htmlContent: data.htmlContent, createdBy: req.admin!.adminId },
    });

    logAudit({
      actorType: 'admin', actorId: req.admin!.adminId, actorEmail: req.admin!.email,
      action: 'email_template.created', targetType: 'email_template', targetId: data.id, ip: req.ip,
    });

    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function updateGlobalTemplate(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const tpl = await prisma.emailTemplate.findFirst({ where: { id: req.params.id, userId: null, deletedAt: null } });
    if (!tpl) {
      errorResponse(res, 404, 'NOT_FOUND', 'Template not found');
      return;
    }

    const { name, category, subject, htmlContent, plainTextContent, isActive } = req.body;
    const nextSubject = subject ?? tpl.subject;
    const nextHtml = htmlContent ?? tpl.htmlContent;
    const nextPlain = plainTextContent !== undefined ? plainTextContent : tpl.plainTextContent;
    const contentChanged = nextSubject !== tpl.subject || nextHtml !== tpl.htmlContent;
    const nextVersion = contentChanged ? tpl.version + 1 : tpl.version;

    const data = await prisma.emailTemplate.update({
      where: { id: tpl.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(category !== undefined ? { category } : {}),
        subject: nextSubject,
        htmlContent: nextHtml,
        plainTextContent: nextPlain,
        variables: extractVariables(nextSubject, nextHtml, nextPlain ?? ''),
        version: nextVersion,
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });

    if (contentChanged) {
      await prisma.emailTemplateVersion.create({
        data: { templateId: tpl.id, version: nextVersion, subject: nextSubject, htmlContent: nextHtml, createdBy: req.admin!.adminId },
      });
    }

    logAudit({
      actorType: 'admin', actorId: req.admin!.adminId, actorEmail: req.admin!.email,
      action: 'email_template.updated', targetType: 'email_template', targetId: tpl.id, ip: req.ip,
    });

    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function deleteGlobalTemplate(req: AdminRequest, res: Response, next: NextFunction) {
  try {
    const tpl = await prisma.emailTemplate.findFirst({ where: { id: req.params.id, userId: null, deletedAt: null } });
    if (!tpl) {
      errorResponse(res, 404, 'NOT_FOUND', 'Template not found');
      return;
    }

    await prisma.emailTemplate.update({ where: { id: tpl.id }, data: { deletedAt: new Date() } });

    logAudit({
      actorType: 'admin', actorId: req.admin!.adminId, actorEmail: req.admin!.email,
      action: 'email_template.deleted', targetType: 'email_template', targetId: tpl.id, ip: req.ip,
    });

    res.json({ success: true, message: 'Template berhasil dihapus' });
  } catch (err) { next(err); }
}
