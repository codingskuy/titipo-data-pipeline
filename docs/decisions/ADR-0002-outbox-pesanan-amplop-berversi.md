# ADR-0002 — Outbox 7 event pesanan dan amplop idempoten berversi

Status: Diterima | Tanggal: 2026-10-21

## Konteks

Tiket TTP-DATA-002 (#2). FSD 30-kontrak §Event menetapkan 7 event pesanan yang membawa ULID, waktu, dan versi. Bagian ini belum merinci skema payload, jadi skema v1 di bawah adalah **asumsi turunan** dari `pipelines/order_to_titeny.md`, BRD 30 (fee), dan `docs/api/openapi.yaml` backend-service (acuan kontrak). Koordinasikan dengan pemilik backend sebelum produksi.

## Keputusan

1. Event: `pesanan.dibuat`, `pesanan.dibayar`, `pesanan.dikonfirmasi`, `pesanan.diserahkan`, `pesanan.dialihkan`, `fee.dicairkan`, `konflik.dicatat`. Skema `data` v1 ada di `src/outbox/events.ts` (`SKEMA_V1`); bidang di luar skema ditolak.
2. Amplop outbox mengikuti skema `EventPesanan` di `docs/api/openapi.yaml` backend-service: `event_id` (ULID, juga kunci idempoten), `jenis`, `schema_version` (string, `"1"`), `occurred_at` (ISO-8601 UTC), `data`. Isi `data` per jenis adalah asumsi karena openapi hanya menulis `additionalProperties: true`. Uang integer rupiah, berat gram integer (FSD).
3. Tanpa PII mentah: payload hanya id anonim; kunci bernama `nama`, `alamat`, `telepon`, `email`, `foto`, koordinat, dan sejenisnya ditolak validator. Foto tidak lewat pipeline.
4. Outbox dikirim FIFO satu kali per event. Event berkunci agregat sama (kode pesanan, atau id vendor untuk `fee.dicairkan`) tidak saling melompati; agregat berbeda tidak saling menghalangi.
5. Duplikat: tujuan menjawab duplikat -> baris ditandai terkirim tanpa kirim ulang. `enqueue` idempoten menurut `event_id`.
6. Retry tiap 30 detik; bila sejak dibuat sudah 24 jam, baris ditandai `gagal` dan hanya bisa dikirim ulang manual (`kirimUlangManual`, jendela 24 jam baru). Penolakan validasi (422) langsung `gagal`.
7. Event `gagal` menghalangi event berikutnya milik agregat yang sama sampai dikirim ulang manual, agar urutan terjaga.
8. Kenaikan versi skema: bump `VERSI_SKEMA_SAAT_INI`, tambah ke `VERSI_DIDUKUNG` selama 30 hari dual-read, tulis ADR baru.

## Konsekuensi

- Hanya penyimpanan memori (`OutboxMemori`) yang tersedia; adapter Postgres untuk outbox DB `titipo` belum ditulis karena tabel outbox dimiliki migrasi `titipo-backend-service`. Antarmuka `OutboxStore` sudah memuat operasi yang dibutuhkan (ambil FIFO dengan penguncian baris, tandai, jadwal ulang).
- Retry outbox (30 detik/24 jam, internal) berbeda dari retry forwarder ke Titeny (5/30/300 detik lalu DLQ, TTP-DATA-003); keduanya dari dokumen sumber yang berbeda.
