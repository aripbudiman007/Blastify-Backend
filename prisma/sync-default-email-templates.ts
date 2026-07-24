/**
 * One-off backfill: push the current DEFAULT_EMAIL_TEMPLATES content (subject,
 * htmlContent, plainTextContent, variables) into existing default rows
 * (userId: null, isDefault: true), and create any slugs that don't exist yet.
 *
 * Unlike prisma/seed.ts's seedEmailTemplates() — which only creates missing
 * defaults and never touches existing rows (so admin edits in production
 * survive re-seeding) — this script intentionally overwrites default rows.
 * Run it manually whenever DEFAULT_EMAIL_TEMPLATES changes and you want that
 * change reflected in an already-seeded database:
 *
 *   npx tsx prisma/sync-default-email-templates.ts
 */
import { prisma } from '../src/prisma/client';
import { DEFAULT_EMAIL_TEMPLATES } from '../src/services/email-template-defaults';

async function main() {
  let updated = 0;
  let created = 0;

  for (const tpl of DEFAULT_EMAIL_TEMPLATES) {
    const existing = await prisma.emailTemplate.findFirst({
      where: { userId: null, slug: tpl.slug },
    });

    if (existing) {
      await prisma.emailTemplate.update({
        where: { id: existing.id },
        data: {
          name: tpl.name,
          category: tpl.category,
          subject: tpl.subject,
          htmlContent: tpl.htmlContent,
          plainTextContent: tpl.plainTextContent,
          variables: tpl.variables,
          version: existing.version + 1,
        },
      });
      updated++;
    } else {
      await prisma.emailTemplate.create({
        data: {
          userId: null,
          name: tpl.name,
          slug: tpl.slug,
          category: tpl.category,
          subject: tpl.subject,
          htmlContent: tpl.htmlContent,
          plainTextContent: tpl.plainTextContent,
          variables: tpl.variables,
          isDefault: true,
          isActive: true,
        },
      });
      created++;
    }
  }

  console.log(`✅ Default email templates synced (${updated} updated, ${created} created)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
