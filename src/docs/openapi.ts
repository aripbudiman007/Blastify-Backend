import { config } from '../config';

/**
 * Hand-maintained OpenAPI 3.0 spec for the public API surface.
 * Served by swagger-ui-express at GET /api/docs.
 */

const ok = (dataExample: any = {}) => ({
  description: 'Success',
  content: {
    'application/json': {
      schema: { type: 'object' },
      example: { success: true, data: dataExample },
    },
  },
});

const errorResp = (description: string) => ({
  description,
  content: {
    'application/json': {
      example: { success: false, error: { code: 'ERROR_CODE', message: description } },
    },
  },
});

const bearerAuth = [{ bearerAuth: [] }];
const apiKeyAuth = [{ apiKeyAuth: [] }];
const anyAuth = [{ bearerAuth: [] }, { apiKeyAuth: [] }];

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Blastify WA Gateway API',
    version: '1.0.0',
    description:
      'Unofficial WhatsApp Gateway (Baileys-based). Autentikasi via JWT Bearer token (dashboard) atau `X-API-Key` header (server-to-server).',
  },
  servers: [{ url: `${config.APP_URL}/api/v1` }],
  tags: [
    { name: 'Auth' },
    { name: 'Account' },
    { name: 'Devices' },
    { name: 'Messages' },
    { name: 'Media' },
    { name: 'Contacts' },
    { name: 'Auto-Replies' },
    { name: 'Broadcasts' },
    { name: 'Inbox' },
    { name: 'Templates' },
    { name: 'Webhooks' },
    { name: 'Payments' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
  },
  paths: {
    // ── Auth ──────────────────────────────────────────────────────────────
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register akun baru',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string', minLength: 2 },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: { '201': ok({ user: {} }), '409': errorResp('Email already registered'), '429': errorResp('Rate limit exceeded') },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login — mengembalikan access + refresh token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': ok({ accessToken: 'jwt...', refreshToken: 'jwt...', user: {} }),
          '401': errorResp('Invalid credentials'),
          '403': errorResp('Email not verified'),
          '429': errorResp('Too many login attempts'),
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Tukar refresh token dengan access token baru',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } } } },
        },
        responses: { '200': ok({ accessToken: 'jwt...' }), '401': errorResp('Invalid refresh token') },
      },
    },
    '/auth/verify-email': {
      get: {
        tags: ['Auth'],
        summary: 'Verifikasi email via token (link di email)',
        parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': ok({ message: 'Email verified' }), '400': errorResp('Invalid or expired token') },
      },
    },
    '/auth/resend-verification': {
      post: {
        tags: ['Auth'],
        summary: 'Kirim ulang email verifikasi',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } } } },
        },
        responses: { '200': ok({ message: 'Link sent if email is registered' }) },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Minta token reset password',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } } } },
        },
        responses: { '200': ok({ message: 'Reset link sent if email exists' }) },
      },
    },

    // ── Account ───────────────────────────────────────────────────────────
    '/account/profile': {
      get: { tags: ['Account'], summary: 'Profil user saat ini', security: anyAuth, responses: { '200': ok() } },
    },
    '/account/upgrade': {
      post: {
        tags: ['Account'],
        summary: 'Buat invoice upgrade plan (Midtrans Snap URL jika dikonfigurasi)',
        security: bearerAuth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['plan'], properties: { plan: { type: 'string', enum: ['LITE', 'REGULAR', 'MASTER', 'ULTRA'] } } },
            },
          },
        },
        responses: { '200': ok({ invoice: { paymentUrl: 'https://app.midtrans.com/snap/...' }, snapToken: '...' }) },
      },
    },
    '/account/rotate-key': {
      post: { tags: ['Account'], summary: 'Rotasi API Key', security: bearerAuth, responses: { '200': ok({ apiKey: 'new-key' }) } },
    },
    '/account/ai-usage': {
      get: {
        tags: ['Account'],
        summary: 'Pemakaian kuota balasan AI bulan berjalan (limit 0 = plan tanpa AI, -1 = unlimited)',
        security: anyAuth,
        responses: { '200': ok({ month: '2026-07', used: 120, limit: 2000, remaining: 1880, plan: 'MASTER' }) },
      },
    },

    // ── Devices ───────────────────────────────────────────────────────────
    '/devices': {
      get: { tags: ['Devices'], summary: 'List device', security: anyAuth, responses: { '200': ok() } },
      post: {
        tags: ['Devices'],
        summary: 'Tambah device baru',
        security: anyAuth,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } },
        },
        responses: { '201': ok(), '403': errorResp('Device limit reached') },
      },
    },
    '/devices/{deviceId}/connect': {
      post: {
        tags: ['Devices'],
        summary: 'Mulai koneksi — QR code dikirim via Socket.IO room device:{id}',
        security: anyAuth,
        parameters: [{ name: 'deviceId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': ok() },
      },
    },

    // ── Messages ──────────────────────────────────────────────────────────
    '/messages/send': {
      post: {
        tags: ['Messages'],
        summary: 'Kirim pesan (text/media/lokasi/list/button, bisa dijadwalkan)',
        security: anyAuth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['deviceId', 'to'],
                properties: {
                  deviceId: { type: 'string' },
                  to: { type: 'string', example: '628123456789' },
                  type: { type: 'string', enum: ['text', 'image', 'video', 'document', 'audio', 'location', 'list', 'button'], default: 'text' },
                  message: { type: 'string' },
                  url: { type: 'string', format: 'uri', description: 'URL media (hasil dari POST /media/upload)' },
                  caption: { type: 'string' },
                  scheduledAt: { type: 'string', format: 'date-time' },
                  latitude: { type: 'number' },
                  longitude: { type: 'number' },
                },
              },
            },
          },
        },
        responses: { '200': ok({ message: { id: '...', status: 'QUEUED' } }), '429': errorResp('Quota or rate limit exceeded') },
      },
    },
    '/messages/send-bulk': {
      post: {
        tags: ['Messages'],
        summary: 'Kirim pesan ke banyak penerima (max 50)',
        security: anyAuth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['deviceId', 'recipients'],
                properties: {
                  deviceId: { type: 'string' },
                  recipients: { type: 'array', items: { type: 'string' }, maxItems: 50 },
                  type: { type: 'string', default: 'text' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': ok() },
      },
    },
    '/messages': {
      get: {
        tags: ['Messages'],
        summary: 'Riwayat pesan (filter device/status/tanggal)',
        security: anyAuth,
        parameters: [
          { name: 'deviceId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { '200': ok() },
      },
    },
    '/messages/{messageId}': {
      delete: {
        tags: ['Messages'],
        summary: 'Batalkan pesan terjadwal/antri',
        security: anyAuth,
        parameters: [{ name: 'messageId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': ok(), '400': errorResp('Cannot cancel') },
      },
    },

    // ── Media ─────────────────────────────────────────────────────────────
    '/media/upload': {
      post: {
        tags: ['Media'],
        summary: 'Upload file ke Cloudinary — hasil URL dipakai di /messages/send',
        security: anyAuth,
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } },
            },
          },
        },
        responses: { '201': ok({ url: 'https://res.cloudinary.com/...' }), '503': errorResp('Cloudinary not configured') },
      },
    },

    // ── Contacts ──────────────────────────────────────────────────────────
    '/contacts': {
      get: { tags: ['Contacts'], summary: 'List kontak', security: anyAuth, responses: { '200': ok() } },
      post: { tags: ['Contacts'], summary: 'Buat kontak', security: anyAuth, responses: { '201': ok() } },
    },
    '/contacts/export': {
      get: {
        tags: ['Contacts'],
        summary: 'Export semua kontak sebagai CSV',
        security: anyAuth,
        responses: { '200': { description: 'CSV file', content: { 'text/csv': { schema: { type: 'string' } } } } },
      },
    },
    '/contacts/import': {
      post: { tags: ['Contacts'], summary: 'Import kontak dari CSV (REGULAR+)', security: anyAuth, responses: { '200': ok() } },
    },
    '/contacts/validate': {
      get: {
        tags: ['Contacts'],
        summary: 'Validasi nomor terdaftar WhatsApp (bulk, max 50)',
        security: anyAuth,
        parameters: [
          { name: 'deviceId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'phones', in: 'query', required: true, schema: { type: 'string' }, description: 'Comma-separated' },
        ],
        responses: { '200': ok() },
      },
    },

    // ── Auto-replies ──────────────────────────────────────────────────────
    '/auto-replies': {
      get: { tags: ['Auto-Replies'], summary: 'List aturan auto-reply', security: anyAuth, responses: { '200': ok() } },
      post: {
        tags: ['Auto-Replies'],
        summary: 'Buat aturan auto-reply. matchType AI = balasan digenerate LLM (replyContent menjadi system prompt)',
        security: anyAuth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['deviceId', 'name', 'keyword', 'replyContent'],
                properties: {
                  deviceId: { type: 'string' },
                  name: { type: 'string' },
                  keyword: { type: 'string', description: 'Untuk AI: "*" menangkap semua pesan' },
                  matchType: { type: 'string', enum: ['EXACT', 'CONTAINS', 'STARTS_WITH', 'REGEX', 'AI'], default: 'CONTAINS' },
                  replyContent: { type: 'string', description: 'Isi balasan, atau system prompt jika matchType=AI' },
                  priority: { type: 'integer', default: 0 },
                },
              },
            },
          },
        },
        responses: { '201': ok(), '403': errorResp('Plan does not include this feature') },
      },
    },

    // ── Broadcasts / Inbox / Templates / Webhooks (ringkas) ───────────────
    '/broadcasts': {
      get: { tags: ['Broadcasts'], summary: 'List broadcast', security: anyAuth, responses: { '200': ok() } },
      post: { tags: ['Broadcasts'], summary: 'Buat broadcast campaign', security: anyAuth, responses: { '201': ok() } },
    },
    '/inbox': {
      get: { tags: ['Inbox'], summary: 'List pesan masuk (filter device/unread/search)', security: anyAuth, responses: { '200': ok() } },
    },
    '/templates': {
      get: { tags: ['Templates'], summary: 'List template pesan', security: anyAuth, responses: { '200': ok() } },
      post: { tags: ['Templates'], summary: 'Buat template', security: anyAuth, responses: { '201': ok() } },
    },
    '/webhooks': {
      get: { tags: ['Webhooks'], summary: 'List outgoing webhook', security: anyAuth, responses: { '200': ok() } },
      post: { tags: ['Webhooks'], summary: 'Buat webhook', security: anyAuth, responses: { '201': ok() } },
    },

    // ── Payments ──────────────────────────────────────────────────────────
    '/payments/ipaymu/notification': {
      post: {
        tags: ['Payments'],
        summary: 'Notify callback iPaymu (dipanggil server iPaymu; status diverifikasi ulang via API check-transaction sebelum invoice dilunasi)',
        responses: { '200': ok({ status: 'paid' }), '400': errorResp('Invalid payload'), '404': errorResp('Unknown reference_id') },
      },
    },
    '/payments/midtrans/notification': {
      post: {
        tags: ['Payments'],
        summary: 'Webhook notifikasi pembayaran Midtrans (alternatif; diverifikasi via signature SHA-512)',
        responses: { '200': ok({ status: 'paid' }), '403': errorResp('Invalid signature'), '404': errorResp('Unknown order_id') },
      },
    },
  },
} as const;
