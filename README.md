# ARMATURE MONITORING SYSTEM

Internal MVP untuk monitoring ARMATURE Blower AC Motor PT Denso Manufacturing Indonesia antara Gedung 1 (BOP) dan Gedung 2 (Viewer). Trial aktif saat ini: **K62**.

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
  armature_monitoring_supabase_mvp_k62_v2_safe.sql
  post_install_checks.sql
```

## Flow MVP

- Viewer **USE** -> RPC `use_armature()` -> stock berkurang atomik + usage log.
- Viewer **REQUEST** -> RPC `create_armature_request()` -> status `PENDING`.
- Maksimal satu request aktif (`PENDING`/`ONGOING`) per armature.
- BOP **Update Stock** -> RPC `update_armature_stock()` dan nilainya adalah actual stock.
- BOP request: `PENDING -> ONGOING -> DONE` melalui `update_request_status()`.
- Saat `DONE`, database otomatis menambahkan requested quantity ke stock.
- Status stock hanya `EMPTY` (0 BOX) dan `READY` (>0 BOX). Tidak ada LOW threshold.

## Security

Frontend hanya menggunakan Supabase Project URL + **Publishable Key**. Jangan pernah memasukkan `service_role`, secret key, atau database password ke frontend/repository. Role berasal dari `public.profiles` dan halaman Gedung 1/Gedung 2 dilindungi session/role guard. Critical write dilakukan lewat RPC.

## Menjalankan lokal

Serve folder `frontend/` dengan static web server (misalnya VS Code Live Server). Buka root server; `frontend/index.html` akan mengarahkan ke halaman Login.

## Deploy Cloudflare Pages via GitHub

Untuk repository dengan struktur ini:

- Framework preset: **None**
- Build command: **kosong**
- Build output directory: **frontend**

Setelah deploy, buka root domain Pages dan pastikan diarahkan ke Login. Kemudian lakukan smoke test BOP dan Viewer.

## Smoke test utama

1. Login BOP dan set A:0121 menjadi 10 BOX.
2. Login Viewer, pastikan terlihat 10 BOX READY.
3. Viewer USE 4 BOX -> stock menjadi 6 BOX.
4. Viewer REQUEST 5 BOX -> `PENDING`.
5. BOP ubah `PENDING -> ONGOING -> DONE`.
6. Stock akhir harus 11 BOX dan request tidak lagi aktif.

> File SQL di folder `supabase/` adalah source/reference untuk database yang sudah dipasang. Jangan menjalankan ulang ke database production tanpa review.
