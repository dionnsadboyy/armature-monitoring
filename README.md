# ARMATURE MONITORING SYSTEM

Internal web app untuk monitoring ARMATURE Blower AC Motor PT Denso Manufacturing Indonesia antara Gedung 1 (BOP) dan Gedung 2 (Viewer). Production saat ini memakai **K62 dan K70**.

## Stack

- HTML5 + CSS3 + Vanilla JavaScript
- Supabase Auth + PostgreSQL + RLS + RPC
- Cloudflare Pages
- Tidak menggunakan custom backend server

## Struktur

```text
frontend/
  index.html            # root entry -> LOGIN
  LOGIN/index.html      # Supabase email/password login
  GEDUNG1/index.html    # BOP dashboard
  GEDUNG2/index.html    # Viewer dashboard
  assets/
  css/
  js/
supabase/
  armature_monitoring_supabase_mvp_k62_v2_safe.sql  # historical/bootstrap reference
  dev_request_sequence.sql                           # DEV-only request ordering
  post_install_checks.sql                             # read-only checks
  supabase/migrations/                                # ordered production migrations
```

## Production database state

- `public.armature_type` berisi `K62` dan `K70`.
- K62 existing tetap dipertahankan.
- Semua K70 aktif dan `LOCAL`; initial stock row dibuat dengan quantity `0` dan tidak di-reset oleh catch-up migration, dengan master final berikut:

  - `A:5002` — Biru — LOCAL
  - `A:5012` — Merah — LOCAL
  - `A:5052` — Kuning — LOCAL
  - `A:5072` — Hijau — LOCAL
  - `A:5082` — Hitam — LOCAL
  - `A:5142` — Pink — LOCAL
  - `A:5250` — Orange — LOCAL
  - `A:5260` — Ungu — LOCAL

  Kode K70 lama `A:0002`, `A:0012`, `A:0052`, `A:0072`, `A:0082`, `A:0142`, `A:0260`, dan `A:0520` obsolete dan tidak boleh dipakai.

## Role dan ARMATURE RUNNING

- BOP / Gedung 1 dapat update stock, menangani request, dan mengedit ARMATURE RUNNING.
- Viewer / Gedung 2 dapat melihat stock, USE, membuat request, dan melihat ARMATURE RUNNING, tetapi tidak dapat mengeditnya.
- Mapping database running:
  - K62: `MODULE`, `TRANSFER_LINE`
  - K70: `MODULE_K70`, `TRANSFER_LINE_K70`
- Suffix `_K70` adalah kode internal database. UI tetap menampilkan `MODULE` dan `TRANSFER LINE`.

## Request dan stock flow

- Viewer **USE** -> RPC `use_armature()` -> stock berkurang atomik + usage log.
- Viewer **REQUEST** -> RPC `create_armature_request()` -> status `PENDING`.
- Lifecycle request: `PENDING -> ONGOING -> DONE`.
- `update_request_status()` menerima parameter `p_status`; `p_request_status` bukan parameter yang digunakan.
- Maksimal satu request aktif (`PENDING`/`ONGOING`) per armature.
- BOP **Update Stock** -> RPC `update_armature_stock()` dan nilainya adalah actual stock.
- `DONE` hanya menyelesaikan request dan tidak menambah stock. Stock hanya berubah melalui Update Stock atau USE/HARVEST.
- Status stock hanya `EMPTY` (0 BOX) dan `READY` (>0 BOX). Tidak ada LOW threshold.

## Konfigurasi environment

Frontend tidak lagi memiliki mode test berbasis query string, mock database, atau localStorage. Supabase adalah source of truth untuk semua environment.

### Development / dummy

1. Salin `frontend/js/config.example.js` menjadi `frontend/js/config.js`.
2. Isi `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY` dengan project Supabase DEV/DUMMY.
3. Serve folder `frontend/` memakai static web server.

Gunakan hanya project DEV/DUMMY untuk pengujian manual. Jangan memakai URL/key production untuk testing.

### Production Cloudflare Pages

- Build command: `node scripts/generate-config.js`
- Build output directory: `frontend`
- Set environment variables `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY` pada Cloudflare Pages.

Build script membuat `frontend/js/config.js` saat deploy. File tersebut di-ignore Git dan tidak boleh berisi `service_role`, secret key, atau database password.

`supabase/dev_request_sequence.sql` adalah perubahan schema/RPC **DEV/DUMMY only** untuk persistent request ordering. Jangan menjalankannya pada production.

Migration produksi yang tercatat berada di `supabase/supabase/migrations/`. Migration `20260911100000_add_k70_armature_type.sql` menambahkan enum K70 bila belum ada; migration `20260911101000_reconcile_k70_production_state.sql` mencatat catch-up master K70, stock rows, running machine codes, dan RPC BOP-only. Keduanya belum dan tidak boleh dijalankan langsung ke production tanpa review/rehearsal.

Helper `private.normalize_active_request_sequences()` sudah tercatat di migration request workflow dan dipakai oleh flow `DONE`; tidak dibuat ulang oleh catch-up K70.

## Security

Frontend hanya menggunakan Supabase Project URL + **Publishable Key**. Jangan pernah memasukkan `service_role`, secret key, atau database password ke frontend/repository. Role berasal dari `public.profiles` dan halaman Gedung 1/Gedung 2 dilindungi session/role guard. Critical write dilakukan lewat RPC.

## Menjalankan lokal

Serve folder `frontend/` dengan static web server (misalnya VS Code Live Server). Buka root server; `frontend/index.html` akan mengarahkan ke halaman Login.

## Deploy Cloudflare Pages via GitHub

Setelah deploy, buka root domain Pages dan pastikan diarahkan ke Login. Kemudian lakukan smoke test BOP dan Viewer.

## Frontend state

- Dashboard memiliki tab `[ K62 ] [ K70 ]` dengan default `K62`.
- Data material dan running state berasal dari Supabase.
- BOP editable untuk running; Viewer read-only.

## Smoke test utama

1. Login BOP dan set A:0121 menjadi 10 BOX pada environment yang sesuai.
2. Login Viewer, pastikan terlihat 10 BOX READY.
3. Viewer USE 4 BOX -> stock menjadi 6 BOX.
4. Viewer REQUEST 5 BOX -> `PENDING`.
5. Pastikan transisi `DONE` tidak mengubah stock.

> File SQL di folder `supabase/` adalah source/reference atau migration yang harus direview dan dijalankan berurutan. Jangan menjalankan SQL ke database production dari repository ini tanpa review eksplisit.
