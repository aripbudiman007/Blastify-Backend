# WhatsApp Gateway (Unofficial)

> SaaS WhatsApp Gateway berbasis Baileys — kirim/terima pesan WA via REST API menggunakan nomor WA pribadi.

## Stack

- **Runtime**: Node.js 20+ (TypeScript)
- **WhatsApp**: `@whiskeysockets/baileys`
- **Framework**: Express.js
- **ORM**: Prisma + PostgreSQL
- **Queue**: BullMQ + Redis
- **Realtime**: Socket.IO
- **Auth**: JWT + API Key

---

## Quick Start

### 1. Prerequisites

- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 16
- Redis 7

### 2. Setup

```bash
cp .env.example .env
# Edit .env sesuai environment Anda

npm install

# Jalankan DB & Redis via Docker
docker-compose up postgres redis -d

# Generate Prisma client & migrate
npm run db:generate
npm run db:migrate

# Seed data awal (opsional)
npm run db:seed

# Jalankan dev server
npm run dev
```

### 3. Production

```bash
npm run build
npm start
# atau jalankan seluruh stack via Docker
docker-compose up -d
```

---

## Environment Variables

| Variable | Deskripsi | Contoh |
|---|---|---|
| `PORT` | Port server | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://...` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | Secret JWT (min 32 char) | `...` |
| `JWT_REFRESH_SECRET` | Secret refresh token | `...` |
| `SESSION_SECRET_KEY` | Kunci enkripsi session (32 char persis) | `12345678901234567890123456789012` |
| `WEBHOOK_TIMEOUT_MS` | Timeout request webhook | `10000` |
| `MESSAGE_DELAY_MIN_MS` | Delay minimum antar pesan | `1000` |
| `MESSAGE_DELAY_MAX_MS` | Delay maksimum antar pesan | `3000` |

---

## Authentication

Semua endpoint (kecuali `/auth`) memerlukan salah satu dari:

```
Authorization: Bearer <JWT_ACCESS_TOKEN>
X-API-Key: <API_KEY>
?apiKey=<API_KEY>
```

---

## API Reference

Base URL: `http://localhost:3000/api/v1`

### Auth

#### `POST /auth/register`
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123"
}
```

#### `POST /auth/login`
```json
{ "email": "john@example.com", "password": "password123" }
```
Response:
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "user": { "id": "...", "name": "...", "plan": "FREE" }
  }
}
```

#### `POST /auth/refresh`
```json
{ "refreshToken": "eyJ..." }
```

#### `POST /auth/logout`
```json
{ "refreshToken": "eyJ..." }
```

---

### Account

#### `GET /account/me`
Info user + usage bulan ini.

#### `PUT /account/me`
```json
{ "name": "New Name", "password": "newpass123" }
```

#### `GET /account/api-key`
Tampilkan API key (masked).

#### `POST /account/api-key/regenerate`
Generate API key baru. **Simpan hasilnya — tidak akan ditampilkan lagi.**

---

### Devices

#### `GET /devices`
List semua device.

#### `POST /devices`
```json
{ "name": "My Phone" }
```

#### `GET /devices/:deviceId`
Detail device.

#### `DELETE /devices/:deviceId`
Hapus device + disconnect session.

#### `POST /devices/:deviceId/connect`
Mulai koneksi Baileys. QR code tersedia via Socket.IO (`device:{deviceId}`) atau endpoint berikut.

#### `POST /devices/:deviceId/disconnect`
Disconnect session.

#### `GET /devices/:deviceId/qr`
QR code saat ini (base64 PNG). Hanya tersedia saat status `QR_READY`.

---

### Messages

#### `POST /messages/send`
```json
{
  "deviceId": "cld...",
  "to": "6281234567890",
  "type": "text",
  "message": "Halo dari WA Gateway!",
  "scheduledAt": "2024-12-01T10:00:00Z"
}
```

**Kirim gambar/video/dokumen:**
```json
{
  "deviceId": "cld...",
  "to": "6281234567890",
  "type": "image",
  "url": "https://example.com/image.jpg",
  "caption": "Caption opsional"
}
```

**Kirim lokasi:**
```json
{
  "deviceId": "cld...",
  "to": "6281234567890",
  "type": "location",
  "latitude": -6.2087634,
  "longitude": 106.845599
}
```

#### `POST /messages/send-bulk`
```json
{
  "deviceId": "cld...",
  "recipients": ["6281234567890", "6289876543210"],
  "type": "text",
  "message": "Blast message!"
}
```
Max 50 nomor per request.

#### `GET /messages`
Query params: `deviceId`, `status`, `from`, `to`, `page`, `limit`.

#### `GET /messages/:messageId`
Detail pesan.

---

### Webhooks

#### `GET /webhooks`

#### `POST /webhooks`
```json
{
  "url": "https://yourapp.com/webhook",
  "events": ["message.received", "device.connected"],
  "deviceIds": ["cld..."]
}
```

#### `PUT /webhooks/:webhookId`
```json
{ "isActive": false }
```

#### `DELETE /webhooks/:webhookId`

#### `POST /webhooks/:webhookId/test`
Kirim test payload ke URL webhook.

---

## Webhook Payload

```json
{
  "event": "message.received",
  "deviceId": "cld...",
  "timestamp": 1704067200,
  "data": {
    "id": "...",
    "from": "6281234567890@s.whatsapp.net",
    "type": "conversation",
    "message": { "conversation": "Halo!" },
    "pushName": "John"
  }
}
```

**Verifikasi signature:**
```
X-Gateway-Signature: sha256=<hmac-sha256(secret, body)>
```

**Events:**
- `message.received` — pesan masuk
- `message.sent` — terkirim
- `message.delivered` — terdeliver
- `message.read` — dibaca
- `device.connected` — WA tersambung
- `device.disconnected` — WA terputus
- `device.qr` — QR baru tersedia

---

## Socket.IO

Connect ke `ws://localhost:3000`, lalu join room device:

```js
socket.emit('join:device', deviceId);

socket.on('qr', ({ deviceId, qr }) => {
  // tampilkan QR code dari data URL base64
});

socket.on('connected', ({ deviceId, phone }) => {
  console.log('WA connected:', phone);
});

socket.on('message', (payload) => {
  console.log('Pesan masuk:', payload);
});
```

---

## Response Format

**Sukses:**
```json
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "limit": 20, "total": 100 }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "DEVICE_NOT_FOUND",
    "message": "Device tidak ditemukan",
    "details": null
  }
}
```

---

## Rate Limits

| Endpoint | Limit |
|---|---|
| Global | 60 req/menit per API key |
| `POST /messages/send` | 20 req/menit per device |
| `POST /messages/send-bulk` | 5 req/menit per device |

---

## Keamanan

- Session Baileys dienkripsi dengan AES-256-GCM sebelum disimpan ke DB
- Password di-hash dengan bcryptjs (salt 12)
- Webhook payload ditandatangani dengan HMAC-SHA256
- API key hanya ditampilkan sekali saat generate (tidak disimpan plaintext)
- Helmet.js untuk security headers
- Input divalidasi dengan Zod di semua endpoint
