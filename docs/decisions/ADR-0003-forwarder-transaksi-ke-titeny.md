# ADR-0003 — Forwarder transaksi.dibuat dan event episodik ke Titeny

Status: Diterima | Tanggal: 2026-10-21

## Konteks

Tiket TTP-DATA-003 (#3). Tujuan: `POST /api/v1/event/masuk` Titeny dengan amplop KONTEKS §3 dan kontrak `projects/Titeny/data/20-kontrak-event.md` (§1, §3.4, §3.7, §3.8, §4). Hanya 3 dari 11 event registry yang berasal dari TitipO: `transaksi.dibuat`, `vendor.status_berubah`, `logistik.biaya_diperbarui`. `pedaree.stok.v1` bukan registry Titeny dan tidak pernah diteruskan.

## Keputusan

1. Amplop: `event_id` (`evt_YYYYMMDD_NNNNNN`), `event_type`, `schema_version` (1), `source: titipo`, `occurred_at`, `received_at`, `batch_id`, `payload`. Header `X-Idempotency-Key` = `event_id`.
2. `event_id` dialokasikan idempoten dari kunci sumber (`transaksi_id`; `vendor_id+occurred_at`; `rute_id+berlaku_mulai`) sehingga retry dan kirim ulang memakai `event_id` yang sama. Tanggal pada `event_id` adalah tanggal WIB dari `occurred_at`. `received_at` diisi saat amplop dibangun (UTC) dan tetap saat retry.
3. `batch_id` = `batch_titipo_YYYYMMDD_<label>` (label bawaan `realtime`), mengikuti pola contoh Titeny.
4. Retry 3x dengan jeda 5/30/300 detik (total 4 percobaan, timeout 10 detik) lalu DLQ. HTTP 422 langsung DLQ tanpa retry (Titeny: perbaiki dan kirim ulang dengan `event_id` baru). 200 `duplikat_diabaikan` dianggap selesai.
5. DLQ: antarmuka `Dlq`; implementasi berkas NDJSON `DlqBerkas` (direktori `data/` diabaikan git).
6. Flag grosir: `payload.grosir = berat_gram > batas`; batas bawaan 50.000 gram (KONTEKS/AGENTS), konfigurabel. Lebih dari batas = grosir, tepat di batas bukan grosir. Satu event per baris item (sesuai skema Titeny yang bersifat per komoditas).
7. Hanya `EVENT_DARI_TITIPO` yang boleh dibangun dan diteruskan; selain itu ditolak.

## Asumsi (belum dikunci dokumen)

- Titeny menerima bidang opsional `grosir` (tambah field opsional = minor, `schema_version` tetap 1, perlu dicatat di changelog kontrak Titeny).
- Auth ke Titeny: header `X-Titipo-Service-Key` dari env (dari `pipelines/README.md`: service key TitipO); belum tertulis di kontrak Titeny.
- Bentuk sumber (`SumberTransaksi`, `SumberVendorStatus`, `SumberBiayaLogistik`) belum ada di outbox backend; event pesanan tidak membawa baris item.
- `logistik.biaya_diperbarui` mensyaratkan `biaya_per_kg`, sementara ongkir TitipO flat Rp5.000 per pesanan; pemetaan belum jelas.
- `vendor.status_berubah`: `status_aktif` = status `aktif` atau `prioritas`; `jenis` dan `kapasitas_harian_kg` harus dipasok sumber.
- Alokator `event_id` hanya memori; produksi perlu penyimpanan persisten dan koordinasi urutan harian lintas source agar `event_id` unik global.

## Konsekuensi

Ketidakselarasan batas berat (FSD 20 kg per pesanan, 422 di backend, vs 50 kg grosir) membuat bendera grosir tidak akan pernah aktif bila backend menolak di atas 20 kg; perlu keputusan manusia.
