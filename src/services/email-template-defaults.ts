export interface DefaultEmailTemplate {
  slug: string;
  name: string;
  category: string;
  subject: string;
  htmlContent: string;
  plainTextContent: string;
  variables: string[];
}

function layout(title: string, body: string): string {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <img src="{{logoUrl}}" alt="Blastify" width="28" height="28" style="display:inline-block;vertical-align:middle" />
      <h2 style="color:#4f46e5;margin:0;display:inline-block;vertical-align:middle">Blastify</h2>
    </div>
    <h3 style="margin-top:0">${title}</h3>
    ${body}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
    <p style="font-size:12px;color:#9ca3af">
      Email ini dikirim otomatis oleh Blastify WA Gateway. Jangan balas email ini.
    </p>
  </div>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0">
    <a href="${url}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block">${label}</a>
  </p>
  <p style="font-size:12px;color:#6b7280">Atau salin tautan ini ke browser:<br />${url}</p>`;
}

export const DEFAULT_EMAIL_TEMPLATES: DefaultEmailTemplate[] = [
  {
    slug: 'registration-verification',
    name: 'Email Verification',
    category: 'registration',
    subject: 'Verifikasi Email Anda - Blastify',
    variables: ['logoUrl', 'name', 'email', 'verificationLink', 'expiresIn'],
    plainTextContent:
      'Halo {{name}}, verifikasi email kamu dengan membuka: {{verificationLink}} (berlaku {{expiresIn}})',
    htmlContent: layout(
      'Halo {{name}}, verifikasi email kamu',
      `<p>Klik tombol di bawah untuk memverifikasi alamat email akun Blastify kamu. Tautan berlaku {{expiresIn}}.</p>
       ${button('{{verificationLink}}', 'Verifikasi Email')}`,
    ),
  },
  {
    slug: 'welcome',
    name: 'Welcome Email',
    category: 'registration',
    subject: 'Selamat Datang di Blastify!',
    variables: ['logoUrl', 'name', 'email', 'appUrl', 'supportEmail'],
    plainTextContent: 'Halo {{name}}, akun Blastify kamu sudah aktif. Kunjungi {{appUrl}} untuk mulai.',
    htmlContent: layout(
      'Halo {{name}}!',
      `<p>Akun Blastify kamu sudah aktif. Mulai hubungkan device WhatsApp pertamamu dan kirim pesan melalui API.</p>
       <p>Langkah cepat:</p>
       <ol>
         <li>Tambahkan device dan scan QR code</li>
         <li>Ambil API Key di menu Account</li>
         <li>Kirim pesan pertama via <code>POST /api/v1/messages/send</code></li>
       </ol>
       <p>Butuh bantuan? Hubungi kami di {{supportEmail}}.</p>`,
    ),
  },
  {
    slug: 'password-reset',
    name: 'Password Reset',
    category: 'account',
    subject: 'Reset Password - Blastify',
    variables: ['logoUrl', 'name', 'resetLink', 'expiresIn', 'supportEmail'],
    plainTextContent: 'Halo {{name}}, reset password kamu di: {{resetLink}} (berlaku {{expiresIn}})',
    htmlContent: layout(
      'Halo {{name}}, reset password akunmu',
      `<p>Kami menerima permintaan untuk reset password akun Blastify kamu. Tautan berlaku {{expiresIn}}.</p>
       ${button('{{resetLink}}', 'Reset Password')}
       <p>Jika kamu tidak melakukan permintaan ini, abaikan email ini atau hubungi {{supportEmail}}.</p>`,
    ),
  },
  {
    slug: 'invoice-created',
    name: 'Invoice Created',
    category: 'payment',
    subject: 'Invoice Baru - {{invoiceId}}',
    variables: ['logoUrl', 'name', 'invoiceId', 'amount', 'planName', 'dueDate', 'paymentLink'],
    plainTextContent: 'Halo {{name}}, invoice {{invoiceId}} sebesar {{amount}} untuk plan {{planName}} jatuh tempo {{dueDate}}. Bayar: {{paymentLink}}',
    htmlContent: layout(
      'Invoice baru',
      `<p>Halo {{name}},</p>
       <p>Invoice <b>{{invoiceId}}</b> sebesar <b>{{amount}}</b> untuk plan <b>{{planName}}</b> telah dibuat dan jatuh tempo pada <b>{{dueDate}}</b>.</p>
       ${button('{{paymentLink}}', 'Bayar Sekarang')}`,
    ),
  },
  {
    slug: 'payment-received',
    name: 'Payment Confirmation',
    category: 'payment',
    subject: 'Pembayaran Dikonfirmasi',
    variables: ['logoUrl', 'name', 'invoiceId', 'amount', 'transactionId', 'receiptLink'],
    plainTextContent: 'Halo {{name}}, pembayaran invoice {{invoiceId}} sebesar {{amount}} (transaksi {{transactionId}}) telah dikonfirmasi.',
    htmlContent: layout(
      'Pembayaran berhasil',
      `<p>Halo {{name}},</p>
       <p>Pembayaran invoice <b>{{invoiceId}}</b> sebesar <b>{{amount}}</b> sudah kami terima (transaksi <b>{{transactionId}}</b>).</p>
       ${button('{{receiptLink}}', 'Lihat Kwitansi')}`,
    ),
  },
  {
    slug: 'device-connected',
    name: 'Device Connected',
    category: 'notification',
    subject: 'Device Terhubung - {{deviceName}}',
    variables: ['logoUrl', 'name', 'deviceName', 'timestamp'],
    plainTextContent: 'Halo {{name}}, device {{deviceName}} berhasil terhubung pada {{timestamp}}.',
    htmlContent: layout(
      'Device terhubung',
      `<p>Halo {{name}},</p>
       <p>Device <b>{{deviceName}}</b> berhasil terhubung ke Blastify pada <b>{{timestamp}}</b>.</p>`,
    ),
  },
  {
    slug: 'broadcast-completed',
    name: 'Broadcast Completed',
    category: 'notification',
    subject: 'Broadcast Selesai',
    variables: ['logoUrl', 'name', 'broadcastName', 'sentCount', 'failureCount'],
    plainTextContent: 'Halo {{name}}, broadcast {{broadcastName}} selesai. Terkirim: {{sentCount}}, gagal: {{failureCount}}.',
    htmlContent: layout(
      'Broadcast selesai',
      `<p>Halo {{name}},</p>
       <p>Broadcast <b>{{broadcastName}}</b> telah selesai diproses.</p>
       <p>Terkirim: <b>{{sentCount}}</b> &nbsp;|&nbsp; Gagal: <b>{{failureCount}}</b></p>`,
    ),
  },
  {
    slug: 'password-changed',
    name: 'Password Changed',
    category: 'account',
    subject: 'Password kamu berhasil diubah - Blastify',
    variables: ['logoUrl', 'name', 'supportEmail'],
    plainTextContent: 'Halo {{name}}, password akun Blastify kamu baru saja berhasil diubah. Semua sesi login lama telah dikeluarkan otomatis. Jika ini bukan kamu, hubungi {{supportEmail}}.',
    htmlContent: layout(
      'Halo {{name}}',
      `<p>Password akun Blastify kamu baru saja berhasil diubah. Semua sesi login lama telah dikeluarkan secara otomatis.</p>
       <p>Jika kamu tidak melakukan perubahan ini, segera hubungi support kami di <a href="mailto:{{supportEmail}}">{{supportEmail}}</a>.</p>`,
    ),
  },
  {
    slug: 'quota-warning',
    name: 'Quota Warning',
    category: 'notification',
    subject: 'Kuota pesan kamu hampir habis - Blastify',
    variables: ['logoUrl', 'name', 'used', 'limit', 'plan', 'percentage'],
    plainTextContent: 'Halo {{name}}, pemakaian pesan bulan ini sudah {{used}} dari {{limit}} ({{percentage}}%) pada plan {{plan}}. Upgrade plan untuk menambah kuota.',
    htmlContent: layout(
      'Peringatan kuota pesan',
      `<p>Halo {{name}},</p>
       <p>Pemakaian pesan bulan ini sudah mencapai <b>{{used}} dari {{limit}}</b> ({{percentage}}%) pada plan <b>{{plan}}</b>.</p>
       <p>Upgrade plan untuk menambah kuota dan menghindari pesan tertolak.</p>`,
    ),
  },
];
