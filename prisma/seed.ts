import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { generateApiKey } from '../src/utils/crypto';
import { DEFAULT_EMAIL_TEMPLATES } from '../src/services/email-template-defaults';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ─── 1. Plan Limits ───────────────────────────────────────────────────────────

async function seedPlanLimits() {
  // Tiering integrasi: LITE = tools ringan (forms/website/CRM dasar);
  // REGULAR = + e-commerce & platform Indonesia; MASTER/ULTRA = semua (POS, accounting, automation)
  const PLATFORMS_LITE = ['googleforms', 'zoho', 'generic', 'woocommerce', 'wix', 'godaddy'];
  const PLATFORMS_REGULAR = [
    ...PLATFORMS_LITE,
    'shopify', 'magento2', 'bigcommerce', 'bitrix24',
    'jotform', 'typeform', 'formstack', 'webflow',
    'sejoli', 'berdu', 'cepatlakoo', 'wpaff', 'lsdplugins',
    'slims', 'opensid', 'jibas', 'mixradius',
  ];

  const plans = [
    { plan: 'FREE',    maxDevices: 1,  monthlyMessages: 1_000,  maxContacts: 500,   maxBroadcasts: 3,  messageRetentionDays: 2,  maxTemplates: 5,   canAutoReply: false, canDeviceRotation: false, canWebhook: false, canCsvImport: false, canIpWhitelist: false, canAiReply: false, aiMonthlyReplies: 0,      price: 0,          hasWatermark: true,  allowedMessageTypes: ['TEXT'], allowedPlatforms: [] },
    { plan: 'LITE',    maxDevices: 1,  monthlyMessages: 1_000,  maxContacts: 1_000, maxBroadcasts: 5,  messageRetentionDays: 3,  maxTemplates: 20,  canAutoReply: false, canDeviceRotation: false, canWebhook: true,  canCsvImport: false, canIpWhitelist: false, canAiReply: false, aiMonthlyReplies: 0,      price: 25_000_00,  hasWatermark: false, allowedMessageTypes: ['TEXT', 'IMAGE', 'DOCUMENT'], allowedPlatforms: PLATFORMS_LITE },
    { plan: 'REGULAR', maxDevices: 3,  monthlyMessages: 10_000, maxContacts: 5_000, maxBroadcasts: 20, messageRetentionDays: 5,  maxTemplates: 50,  canAutoReply: true,  canDeviceRotation: false, canWebhook: true,  canCsvImport: true,  canIpWhitelist: true,  canAiReply: false, aiMonthlyReplies: 0,      price: 66_000_00,  hasWatermark: false, allowedMessageTypes: [], allowedPlatforms: PLATFORMS_REGULAR },
    { plan: 'MASTER',  maxDevices: 10, monthlyMessages: -1,     maxContacts: -1,    maxBroadcasts: -1, messageRetentionDays: 7,  maxTemplates: 200, canAutoReply: true,  canDeviceRotation: true,  canWebhook: true,  canCsvImport: true,  canIpWhitelist: true,  canAiReply: true,  aiMonthlyReplies: 2_000,  price: 175_000_00, hasWatermark: false, allowedMessageTypes: [], allowedPlatforms: [] },
    { plan: 'ULTRA',   maxDevices: -1, monthlyMessages: -1,     maxContacts: -1,    maxBroadcasts: -1, messageRetentionDays: 30, maxTemplates: -1,  canAutoReply: true,  canDeviceRotation: true,  canWebhook: true,  canCsvImport: true,  canIpWhitelist: true,  canAiReply: true,  aiMonthlyReplies: 10_000, price: 355_000_00, hasWatermark: false, allowedMessageTypes: [], allowedPlatforms: [] },
  ] as const;

  for (const p of plans) {
    await (prisma as any).planLimit.upsert({
      where: { plan: p.plan },
      update: p,
      create: p,
    });
  }
  console.log('✅ Plan limits seeded (5 plans)');
}

// ─── 2. Demo User (ULTRA) ─────────────────────────────────────────────────────

async function seedAdminUser() {
  const password = await bcrypt.hash('password123', 12);
  const apiKey = generateApiKey();

  const user = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      name: 'Admin User',
      password,
      apiKey,
      plan: 'ULTRA',
    },
  });

  console.log('✅ Demo user seeded:', user.email);
  console.log('   API Key (save this!):', apiKey);
  console.log('   Password           : password123');

  return user;
}

// ─── 3. Super Admin (backoffice) ──────────────────────────────────────────────

async function seedSuperAdmin() {
  const email = 'superadmin@example.com';
  const plainPassword = 'SuperAdmin@123';
  const password = await bcrypt.hash(plainPassword, 12);

  const admin = await prisma.admin.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Super Admin',
      password,
      role: 'SUPER_ADMIN',
      isActive: true,
    },
  });

  // Also seed a regular STAFF admin for demo
  const staffEmail = 'staff@example.com';
  const staffPassword = await bcrypt.hash('Staff@123456', 12);
  await prisma.admin.upsert({
    where: { email: staffEmail },
    update: {},
    create: {
      email: staffEmail,
      name: 'Staff Admin',
      password: staffPassword,
      role: 'STAFF',
      isActive: true,
    },
  });

  console.log('✅ Admin panel accounts seeded:');
  console.log(`   SUPER_ADMIN → ${admin.email} / ${plainPassword}`);
  console.log(`   STAFF       → ${staffEmail} / Staff@123456`);
  console.log('   ⚠️  Change passwords after first login!');
}

// ─── 4. Message Templates ─────────────────────────────────────────────────────

async function seedMessageTemplates(userId: string) {
  const templates = [
    {
      name: 'Selamat Datang',
      category: 'greeting',
      type: 'TEXT' as const,
      content: 'Halo {{name}} 👋 Selamat datang! Ada yang bisa kami bantu?',
    },
    {
      name: 'Konfirmasi Pesanan',
      category: 'notification',
      type: 'TEXT' as const,
      content:
        'Halo {{name}}, pesanan Anda dengan nomor *#{{order_id}}* telah kami terima ✅\n' +
        'Total pembayaran: *Rp {{total}}*\n' +
        'Estimasi pengiriman: 2-3 hari kerja.\n\n' +
        'Terima kasih telah berbelanja! 🛍️',
    },
    {
      name: 'Pengingat Pembayaran',
      category: 'notification',
      type: 'TEXT' as const,
      content:
        'Halo {{name}} 🔔\n\n' +
        'Tagihan Anda senilai *Rp {{amount}}* akan jatuh tempo pada *{{due_date}}*.\n' +
        'Segera lakukan pembayaran untuk menghindari keterlambatan.\n\n' +
        'Terima kasih 🙏',
    },
    {
      name: 'Promo Spesial',
      category: 'promo',
      type: 'TEXT' as const,
      content:
        '🎉 *PROMO SPESIAL untuk {{name}}!*\n\n' +
        'Dapatkan diskon *{{discount}}%* untuk semua produk hari ini saja!\n' +
        'Gunakan kode: *{{promo_code}}*\n\n' +
        'Berlaku hingga: {{expiry_date}}\n' +
        'Info lebih lanjut hubungi kami 📲',
    },
    {
      name: 'Follow Up Pelanggan',
      category: 'general',
      type: 'TEXT' as const,
      content:
        'Halo {{name}} 😊\n\n' +
        'Kami ingin memastikan Anda puas dengan layanan kami.\n' +
        'Apakah ada yang bisa kami bantu lebih lanjut?\n\n' +
        'Balas pesan ini kapan saja, kami siap membantu! 🤝',
    },
  ];

  let created = 0;
  for (const tpl of templates) {
    const existing = await prisma.messageTemplate.findFirst({
      where: { userId, name: tpl.name },
    });
    if (!existing) {
      await prisma.messageTemplate.create({ data: { userId, ...tpl } });
      created++;
    }
  }

  console.log(`✅ Message templates seeded (${created} created, ${templates.length - created} skipped)`);
}

// ─── 5. Sample Announcement ───────────────────────────────────────────────────

async function seedAnnouncements(adminId: string) {
  const existing = await prisma.announcement.findFirst({
    where: { title: 'Selamat Datang di WA Gateway!' },
  });

  if (!existing) {
    await prisma.announcement.create({
      data: {
        title: 'Selamat Datang di WA Gateway!',
        content:
          'Platform WhatsApp Gateway Anda kini siap digunakan. ' +
          'Hubungkan perangkat WhatsApp, kirim pesan massal, dan otomasi komunikasi bisnis Anda. ' +
          'Kunjungi dokumentasi untuk panduan lengkap.',
        type: 'INFO',
        isActive: true,
        targetPlan: [],   // semua plan
        createdBy: adminId,
      },
    });

    await prisma.announcement.create({
      data: {
        title: '🔧 Maintenance Terjadwal',
        content:
          'Sistem akan menjalani maintenance rutin setiap Minggu pukul 02.00–04.00 WIB. ' +
          'Layanan mungkin terganggu sementara selama periode tersebut.',
        type: 'MAINTENANCE',
        isActive: true,
        targetPlan: [],
        createdBy: adminId,
      },
    });

    console.log('✅ Announcements seeded (2 entries)');
  } else {
    console.log('✅ Announcements already exist, skipped');
  }
}

// ─── 6. Default Email Templates ────────────────────────────────────────────────

async function seedEmailTemplates() {
  let created = 0;
  for (const tpl of DEFAULT_EMAIL_TEMPLATES) {
    const existing = await prisma.emailTemplate.findFirst({
      where: { userId: null, slug: tpl.slug },
    });
    if (existing) continue;
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
  console.log(`✅ Default email templates seeded (${created} templates)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Starting seed...\n');

  await seedPlanLimits();
  await seedEmailTemplates();

  const demoUser = await seedAdminUser();
  await seedMessageTemplates(demoUser.id);

  await seedSuperAdmin();

  // Fetch the SUPER_ADMIN to use their ID for announcements
  const superAdmin = await prisma.admin.findUnique({
    where: { email: 'superadmin@example.com' },
  });
  if (superAdmin) {
    await seedAnnouncements(superAdmin.id);
  }

  console.log('\n🎉 Seed completed successfully!');
  console.log('\n── Login Credentials ──────────────────────────────');
  console.log('  User Dashboard  : admin@example.com / password123');
  console.log('  Admin Backoffice: superadmin@example.com / SuperAdmin@123');
  console.log('────────────────────────────────────────────────────\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
