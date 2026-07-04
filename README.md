# Sylent AI

Aplikasi chat AI full-stack (frontend + backend dalam **satu project**), terinspirasi
tampilan Claude, ditenagai model **Sylent 0.1**.

---

## Fitur

- Chat modern (dark theme, sidebar, chat bubble, markdown, syntax highlight)
- Bubble "AI sedang berpikir" premium (wave dots + status bergantian) begitu pesan dikirim
- Typing animation saat jawaban selesai, tanpa flicker saat error
- Upload lampiran gambar/file di composer (drag & drop atau tombol attach)
- Chat baru, rename, delete, regenerate, stop generate
- Enter kirim, Shift+Enter baris baru
- Live Code Preview (HTML/SVG/CSS/JS) dalam iframe: Fullscreen, Refresh, Open New Tab, Download
- Admin Panel dengan **login session** (bukan API key di URL), dashboard auto-refresh,
  filter user, riwayat chat, export JSON/CSV, hapus log
- Tracking user otomatis: IP, browser, OS, device, referer, halaman aktif, durasi, status online
- Keamanan: Helmet, CSP, Rate Limit, DOMPurify, validasi input, session HttpOnly,
  admin key hanya divalidasi sekali di backend (tidak pernah dikirim ke frontend)

## Stack

**Frontend**: HTML5, CSS3, Vanilla JS, Marked (markdown), Highlight.js, DOMPurify, Inter Font
**Backend**: Node.js, Express, Upstash Redis (REST, serverless-friendly), Helmet,
Compression, Express Rate Limit, express-session (cookie signing)

## Struktur

```
/
├── server.js              # entrypoint tunggal (frontend + backend)
├── redis.js               # re-export dari database/redis.js
├── database/redis.js       # semua logic Redis (users, chat log, stats, admin key, session)
├── routes/                 # ai.js, admin.js (auth + dashboard), api.js
├── middleware/             # auth.js, logger.js, security.js, session.js
├── public/
│   ├── index.html, profile.html, docs.html
│   ├── atmin/               # admin panel (login + dashboard, satu halaman)
│   ├── css/, js/, icons/
└── logs/                   # access log lokal (dilewati otomatis saat di Vercel)
```

## Menjalankan

1. Salin `.env.example` menjadi `.env` dan isi kredensial Upstash Redis Anda
   (buat gratis di https://console.upstash.com).
2. Jalankan:

```bash
npm install
npm start
```

Aplikasi otomatis membaca `.env` lewat `dotenv` — tidak ada konfigurasi tambahan.
Server berjalan di `http://localhost:$PORT` (default `8080`).

## Konfigurasi (.env)

```
PORT=8080
NODE_ENV=production
DOMAIN=http://localhost:3000

UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-upstash-rest-token

ADMIN_KEY=sylentpajar

AI_API_BASE=https://api.cmnty.web.id/ai/claude

RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=30

SESSION_SECRET=replace-with-a-long-random-secret
SESSION_EXPIRES=7d
```

`ADMIN_KEY` hanya dipakai untuk memvalidasi *sekali* saat login di endpoint
`POST /atmin/api/auth/login`; nilai aktualnya disimpan di Redis
(`sylent:admin_key`) dan **tidak pernah** dikirim ke frontend atau URL.

`SESSION_SECRET` menandatangani cookie sesi admin (HttpOnly + signed).
Generate secret kuat dengan:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Admin Panel (Login Session)

Akses: `/atmin`

- Tidak ada lagi parameter `?key=` di URL.
- Masukkan Admin Key di halaman login → backend memvalidasi ke Redis →
  jika benar, sebuah sesi dibuat di Redis dan direferensikan lewat cookie
  `HttpOnly` bernama `sylent_admin_session` (signed, `sameSite=lax`).
- Selama sesi valid, refresh halaman langsung masuk dashboard tanpa login ulang.
- Tombol **Logout** menghapus sesi di Redis dan cookie di browser.
- Semua endpoint di bawah `/atmin/api/*` (kecuali login) dilindungi
  middleware `requireAdminSession` — mengembalikan `403 Unauthorized` jika
  sesi tidak valid/habis.

Fitur dashboard: stats realtime (polling 5 detik), daftar user + filter
(browser/device/negara/halaman), detail user, riwayat chat (maks 2 percakapan
terakhir per user), export JSON/CSV, hapus log — semuanya tetap seperti sebelumnya.

## Sumber AI (tidak diubah)

```
GET https://api.cmnty.web.id/ai/claude?text={PROMPT}
```

Diproxy lewat backend di `GET /ai/claude?text=...` agar rate-limited, tercatat, dan aman.
Endpoint dan perilaku ini **tidak diubah** dari versi sebelumnya.

## Deploy ke Vercel

Project ini sudah dikonfigurasi (`vercel.json`) untuk berjalan sebagai
serverless function di Vercel:

1. Push repo ke GitHub/GitLab.
2. Import project di Vercel.
3. Isi Environment Variables sesuai `.env.example` (terutama
   `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `ADMIN_KEY`,
   `SESSION_SECRET`).
4. Deploy — tidak perlu server Redis terpisah karena Upstash berbasis REST
   (cocok untuk lingkungan serverless).

## Identitas

| | |
|---|---|
| Nama Website | Sylent AI |
| Model | Sylent 0.1 |
| Developer | pajar |
| Portfolio | https://pixajar.my.id |
| Donasi | https://hellocloud.my.id/donasi |
