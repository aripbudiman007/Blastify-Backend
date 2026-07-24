/**
 * Platform presets — pre-configured defaults for known platforms.
 * These help users set up integrations faster by suggesting the right
 * phoneField path and a starter message template.
 */

export interface PlatformPreset {
  label: string;
  category: string;
  phoneField?: string;       // default dot-path for recipient phone
  filterField?: string;      // payload field used to filter events
  filterValueExample?: string;
  templateHint: string;      // example message template
  webhookDocsUrl?: string;
  notes?: string;
}

export const PLATFORM_PRESETS: Record<string, PlatformPreset> = {
  // ── E-commerce ──────────────────────────────────────────────────────────────
  shopify: {
    label: 'Shopify',
    category: 'E-Commerce',
    phoneField: 'customer.phone',
    filterField: 'topic',
    filterValueExample: 'orders/create',
    templateHint:
      'Halo {{customer.first_name}}, pesanan #{{order_number}} senilai {{total_price}} telah kami terima! 🛍️ Kami akan segera memprosesnya.',
    webhookDocsUrl: 'https://shopify.dev/docs/api/admin-rest/webhook',
    notes: 'Daftarkan webhook di Admin → Settings → Notifications → Webhooks',
  },

  woocommerce: {
    label: 'WooCommerce (WordPress)',
    category: 'E-Commerce',
    phoneField: 'billing.phone',
    filterField: 'topic',
    filterValueExample: 'order.created',
    templateHint:
      'Halo {{billing.first_name}}, pesanan #{{id}} ({{status}}) senilai {{total}} telah kami terima! Terima kasih.',
    webhookDocsUrl: 'https://woocommerce.com/document/webhooks/',
    notes: 'WooCommerce → Settings → Advanced → Webhooks',
  },

  magento2: {
    label: 'Magento 2',
    category: 'E-Commerce',
    phoneField: 'billing_address.telephone',
    templateHint:
      'Pesanan #{{increment_id}} telah diterima. Status: {{status}}. Total: {{base_grand_total}}',
    notes: 'Gunakan extension Magento Webhook atau REST API trigger',
  },

  bigcommerce: {
    label: 'BigCommerce',
    category: 'E-Commerce',
    phoneField: 'data.billing_address.phone',
    filterField: 'scope',
    filterValueExample: 'store/order/created',
    templateHint:
      'Pesanan #{{data.id}} telah diterima! Status: {{data.status}}. Terima kasih telah berbelanja.',
    webhookDocsUrl: 'https://developer.bigcommerce.com/docs/integrations/webhooks',
  },

  zencart: {
    label: 'Zen Cart',
    category: 'E-Commerce',
    phoneField: 'telephone',
    templateHint: 'Pesanan #{{orders_id}} senilai {{order_total}} telah diterima. Terima kasih!',
    notes: 'Gunakan plugin Zen Cart Webhook atau custom notifier',
  },

  cscart: {
    label: 'CS-Cart',
    category: 'E-Commerce',
    phoneField: 'phone',
    templateHint: 'Pesanan #{{order_id}} status {{status}} telah diperbarui.',
    notes: 'CS-Cart → Add-ons → Webhooks atau gunakan API REST',
  },

  swell: {
    label: 'Swell',
    category: 'E-Commerce',
    phoneField: 'billing.phone',
    filterField: 'type',
    filterValueExample: 'order.created',
    templateHint:
      'Pesanan #{{number}} senilai {{grand_total}} telah diterima! Halo {{billing.first_name}}.',
    webhookDocsUrl: 'https://developers.swell.is/guides/webhooks',
  },

  fastspring: {
    label: 'FastSpring',
    category: 'E-Commerce',
    phoneField: 'customer.phone',
    filterField: 'type',
    filterValueExample: 'ORDER_COMPLETED',
    templateHint:
      'Pembelian {{items.0.product}} berhasil! ID: {{id}}. Terima kasih {{customer.first}}.',
    webhookDocsUrl: 'https://developer.fastspring.com/docs/webhooks',
  },

  // ── Point of Sale & Payments ─────────────────────────────────────────────────
  square: {
    label: 'Square',
    category: 'POS / Payments',
    phoneField: 'data.object.order.fulfillments.0.pickup_details.recipient.phone_number',
    filterField: 'type',
    filterValueExample: 'order.fulfillment.updated',
    templateHint: 'Pesanan Square #{{data.object.order.id}} telah diproses.',
    webhookDocsUrl: 'https://developer.squareup.com/docs/webhooks/overview',
  },

  vend: {
    label: 'Vend (Lightspeed Retail)',
    category: 'POS / Payments',
    phoneField: 'payload.customer.mobile',
    filterField: 'type',
    filterValueExample: 'sale.update',
    templateHint: 'Transaksi Vend #{{payload.id}} senilai {{payload.total_price}} berhasil.',
    webhookDocsUrl: 'https://docs.vendhq.com/docs/register-webhooks',
  },

  quickbooks: {
    label: 'QuickBooks',
    category: 'Accounting',
    phoneField: 'Invoice.BillEmail.Address',
    filterField: 'Name',
    filterValueExample: 'Invoice',
    templateHint: 'Invoice QuickBooks #{{Invoice.DocNumber}} senilai {{Invoice.TotalAmt}} telah dibuat.',
    notes: 'QuickBooks → Settings → Webhooks',
    webhookDocsUrl: 'https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks',
  },

  // ── Forms ───────────────────────────────────────────────────────────────────
  jotform: {
    label: 'Jotform',
    category: 'Forms',
    phoneField: 'q3_phoneNumber.full',   // field ID varies; user must adjust
    templateHint: 'Terima kasih {{q4_nameSoal}} telah mengisi form! Kami akan segera menghubungi Anda.',
    webhookDocsUrl: 'https://www.jotform.com/help/236-how-to-use-the-webhook-with-jotform',
    notes: 'Field ID bergantung pada form Anda. Cek Jotform Webhook payload untuk nama field yang tepat.',
  },

  typeform: {
    label: 'Typeform',
    category: 'Forms',
    phoneField: 'form_response.answers.0.phone_number',
    templateHint: 'Terima kasih telah mengisi form! Kami akan menghubungi Anda segera.',
    webhookDocsUrl: 'https://www.typeform.com/developers/webhooks/',
    notes: 'Sesuaikan phoneField dengan answer index field nomor telepon di form Anda.',
  },

  formstack: {
    label: 'Formstack',
    category: 'Forms',
    phoneField: 'field_12345',   // user must replace with actual field ID
    templateHint: 'Form submission diterima. Terima kasih {{field_name}}!',
    webhookDocsUrl: 'https://support.formstack.com/hc/en-us/articles/360019910011',
    notes: 'Ganti phoneField dengan field ID nomor telepon dari form Anda.',
  },

  googleforms: {
    label: 'Google Forms / Sheets',
    category: 'Forms',
    templateHint: 'Respons form dari {{name}} telah diterima pada {{datetime}}. Terima kasih!',
    notes:
      'Gunakan Google Apps Script di Spreadsheet untuk mengirim webhook ke URL integrasi ini saat ada respons baru. Contoh script tersedia di dokumentasi.',
  },

  // ── Website Builders ─────────────────────────────────────────────────────────
  webflow: {
    label: 'Webflow',
    category: 'Website Builder',
    phoneField: 'data.fieldData.phone',
    filterField: 'triggerType',
    filterValueExample: 'form_submission',
    templateHint: 'Formulir Webflow diterima dari {{data.fieldData.name}}. Kami segera menghubungi Anda!',
    webhookDocsUrl: 'https://university.webflow.com/lesson/webhooks',
  },

  wix: {
    label: 'Wix',
    category: 'Website Builder',
    phoneField: 'data.submissionData.phone',
    templateHint: 'Formulir Wix dari {{data.submissionData.name}} telah diterima!',
    notes:
      'Wix → Automations atau gunakan Velo (Wix Code) untuk trigger webhook ke URL integrasi ini.',
  },

  godaddy: {
    label: 'GoDaddy (Website Builder)',
    category: 'Website Builder',
    phoneField: 'phone',
    templateHint: 'Ada pesan masuk dari {{name}}. Kami akan segera menghubungi Anda!',
    notes: 'GoDaddy Website Builder → Form Notifications atau pakai Zapier sebagai perantara.',
  },

  // ── CRM & Business ───────────────────────────────────────────────────────────
  bitrix24: {
    label: 'Bitrix24',
    category: 'CRM',
    phoneField: 'data.FIELDS.PHONE',
    filterField: 'event',
    filterValueExample: 'ONCRMLEADADD',
    templateHint: 'Lead baru di Bitrix24: {{data.FIELDS.NAME}} - {{data.FIELDS.PHONE}}',
    webhookDocsUrl: 'https://training.bitrix24.com/rest_help/rest_events/',
  },

  zoho: {
    label: 'Zoho CRM / Flow',
    category: 'CRM',
    phoneField: 'data.Mobile',
    filterField: 'module',
    filterValueExample: 'Leads',
    templateHint: 'Lead baru Zoho: {{data.First_Name}} {{data.Last_Name}}. Kami akan segera menghubungi!',
    webhookDocsUrl: 'https://www.zoho.com/flow/',
    notes: 'Zoho CRM → Automation Rules atau gunakan Zoho Flow untuk trigger webhook.',
  },

  // ── Indonesian Platforms ──────────────────────────────────────────────────────
  slims: {
    label: 'SLiMS (Perpustakaan)',
    category: 'Indonesian Platform',
    phoneField: 'member.phone',
    templateHint:
      'Halo {{member.name}}, peminjaman buku "{{item.title}}" berhasil. Batas kembali: {{due_date}}.',
    notes:
      'SLiMS tidak punya webhook bawaan. Gunakan SLiMS Plugin atau trigger dari database/cron job yang memanggil URL integrasi ini.',
  },

  opensid: {
    label: 'OpenSID',
    category: 'Indonesian Platform',
    phoneField: 'penduduk.telepon',
    templateHint:
      'Halo {{penduduk.nama}}, pengajuan surat {{jenis_surat}} Anda telah diterima. No. referensi: {{no_referensi}}.',
    notes: 'OpenSID → Notifikasi atau gunakan REST API OpenSID untuk trigger ke URL integrasi ini.',
  },

  jibas: {
    label: 'Jibas (Sekolah)',
    category: 'Indonesian Platform',
    phoneField: 'siswa.telp_ortu',
    templateHint:
      'Halo orang tua {{siswa.nama}}, tagihan {{bulan}} senilai Rp {{nominal}} telah jatuh tempo.',
    notes: 'Jibas → API atau gunakan trigger dari database Jibas yang memanggil URL integrasi ini.',
  },

  mixradius: {
    label: 'Mixradius',
    category: 'Indonesian Platform',
    phoneField: 'phone',
    templateHint: 'Halo {{name}}, request lagu "{{song}}" telah diterima! Tunggu sebentar ya 🎵',
    notes: 'Konfigurasikan webhook Mixradius ke URL integrasi ini.',
  },

  // ── Automation Platforms (note: these use HTTP Request to our API directly) ──
  zapier: {
    label: 'Zapier',
    category: 'Automation',
    templateHint: 'Pesan dari Zapier: {{message}}',
    notes:
      'Zapier bisa memanggil REST API kita langsung (POST /api/v1/messages/send) menggunakan action "Webhooks by Zapier". URL integrasi ini untuk menerima trigger dari Zapier.',
  },

  pabbly: {
    label: 'Pabbly Connect',
    category: 'Automation',
    templateHint: 'Notifikasi Pabbly: {{message}}',
    notes:
      'Pabbly → Action: HTTP Client → POST ke /api/v1/messages/send dengan API Key. Atau gunakan Pabbly sebagai trigger yang mengirim ke URL integrasi ini.',
  },

  integrately: {
    label: 'Integrately',
    category: 'Automation',
    templateHint: 'Notifikasi dari Integrately: {{message}}',
    notes: 'Gunakan Integrately HTTP action untuk memanggil REST API kita langsung.',
  },

  integromat: {
    label: 'Make (Integromat)',
    category: 'Automation',
    templateHint: 'Pesan dari Make: {{message}}',
    notes:
      'Make → HTTP Module → POST ke /api/v1/messages/send. Atau gunakan Webhook module untuk mengirim ke URL integrasi ini.',
  },

  n8n: {
    label: 'n8n',
    category: 'Automation',
    templateHint: 'Pesan dari n8n: {{message}}',
    notes:
      'n8n → HTTP Request node → POST ke /api/v1/messages/send dengan header X-API-Key. Atau gunakan Webhook node di workflow n8n untuk mengirim trigger ke URL integrasi ini.',
    webhookDocsUrl: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/',
  },

  superblocks: {
    label: 'Superblocks',
    category: 'Automation',
    templateHint: 'Notifikasi Superblocks: {{message}}',
    notes: 'Superblocks → API block → POST ke /api/v1/messages/send dengan Authorization header.',
  },

  // ── Indonesian Platform — Direct Blastify API ────────────────────────────────
  // Platform-platform ini memanggil REST API Blastify secara langsung (bukan webhook receiver)

  berdu: {
    label: 'Berdu',
    category: 'Indonesian Platform',
    templateHint: 'Halo {{name}}, pesanan {{order_id}} senilai {{amount}} telah dikonfirmasi! Terima kasih.',
    notes:
      'Berdu → Pengaturan → Notifikasi WhatsApp → masukkan API Key Blastify dan nomor device. Berdu memanggil Blastify API (POST /api/v1/blastify/send-message) langsung dari sistem mereka.',
    webhookDocsUrl: 'https://berdu.id',
  },

  sejoli: {
    label: 'Sejoli',
    category: 'Indonesian Platform',
    templateHint: 'Halo {{name}}, pembelian {{product_name}} berhasil! Akses produk Anda di: {{download_url}}',
    notes:
      'Sejoli (plugin WooCommerce untuk produk digital) → Pengaturan WhatsApp → masukkan API Key Blastify. Sejoli memanggil endpoint Blastify API secara langsung untuk notifikasi pembelian.',
    webhookDocsUrl: 'https://sejoli.co.id',
  },

  cepatlakoo: {
    label: 'Cepatlakoo',
    category: 'Indonesian Platform',
    templateHint: 'Halo {{customer_name}}, pesanan #{{order_number}} sudah kami terima. Kami segera proseskan!',
    notes:
      'Cepatlakoo → Integrasi → WhatsApp Gateway → masukkan API Key dan pilih device. Platform memanggil Blastify REST API langsung untuk notifikasi order dan pengiriman.',
    webhookDocsUrl: 'https://cepatlakoo.com',
  },

  wpaff: {
    label: 'WPAff WhatsApp',
    category: 'Indonesian Platform',
    templateHint: 'Selamat {{affiliate_name}}! Komisi Rp {{commission}} dari referral {{referred_name}} telah ditambahkan.',
    notes:
      'WPAff WhatsApp (plugin WordPress/WooCommerce untuk notifikasi affiliate) → Settings → WhatsApp API → pilih "Custom API" → masukkan endpoint Blastify dan API Key. Plugin memanggil API langsung.',
    webhookDocsUrl: 'https://wpaff.com',
  },

  lsdplugins: {
    label: 'LSD Plugins',
    category: 'Indonesian Platform',
    templateHint: 'Halo {{billing_first_name}}, pesanan WooCommerce #{{order_number}} ({{order_status}}) telah diperbarui.',
    notes:
      'LSD Plugins (WooCommerce WhatsApp notification plugin) → LSD WA Settings → masukkan Blastify API Key dan URL endpoint. Plugin mengirim notifikasi order WooCommerce langsung via Blastify API.',
    webhookDocsUrl: 'https://lsdplugins.com',
  },

  // ── Generic fallback ─────────────────────────────────────────────────────────
  generic: {
    label: 'Generic Webhook',
    category: 'Generic',
    templateHint: 'Notifikasi baru: {{message}}',
    notes:
      'Platform apapun yang mendukung webhook. Konfigurasikan URL integrasi ini sebagai webhook destination.',
  },
};

export function getPlatformPreset(platform: string): PlatformPreset | undefined {
  return PLATFORM_PRESETS[platform.toLowerCase()];
}

export function listPlatforms() {
  return Object.entries(PLATFORM_PRESETS).map(([key, preset]) => ({
    key,
    label: preset.label,
    category: preset.category,
    notes: preset.notes,
  }));
}
