# ADR-0004 — CSV rekonsiliasi Senin, agregat metrik harian, arsip 2 tahun

Status: Diterima | Tanggal: 2026-10-21

## Konteks

Tiket TTP-DATA-004 (#4). Sumber: BRD 30-keuangan-fee BR-307, `metrik/10-repeat-order.md`, FSD 30-kontrak (job arsip tanggal 1 jam 02.00). Kinerja analitik boleh terlambat maksimal 24 jam; pesanan dan fee tidak boleh terganggu oleh pipeline.

## Keputusan

1. **Rekonsiliasi Senin 09.00 WIB**: periode = Senin-Minggu WIB minggu lalu. Berita acara CSV (`jenis_baris,kunci,id_vendor,tanggal_selesai_wib,pokok_rupiah,susut_rupiah,nilai`): satu baris per pesanan + baris ringkasan; urutan deterministik; berkas `rekonsiliasi-pokok-lumbung_<mulai>_<akhir>.csv`, tidak menimpa berkas yang sudah ada (idempoten). Sel teks dinetralkan dari awalan rumus spreadsheet.
2. **Susut**: toleransi = floor(2% x total pokok); selisih = susut - toleransi (bila positif). Yang dibagi 50:50 = min(selisih, Rp200.000) per minggu (Lumbung = floor separuh, sisa rupiah ganjil ke TitipO); kelebihan di atas Rp200.000 ditanggung TitipO. Ambang dan batas konfigurabel.
3. **Agregat harian** (per hari WIB, `data/metrik/harian/YYYY-MM-DD.json`, tulis atomik): `repeat_28h` (rolling 28 hari: >=2 selesai / >=1 selesai), `tepat_serah` (serah hari itu dalam +-15 menit janji), `batal_vendor` (dibatalkan_vendor / pesanan dibuat hari itu), `median_konfirmasi_menit` (pesanan dibuat hari itu). Setiap metrik membawa pembilang dan penyebut agar dashboard dapat menggabungkan tanpa hitung ulang; `null` bila tidak ada data.
4. **Arsip**: pesanan selesai lebih dari 2 tahun (selesai_pada < sekarang - 2 tahun) disalin ke tujuan arsip lebih dulu, baru ditandai lewat `SumberArsip.tandaiDiarsipkan`. Ledger audit wajib disimpan 2 tahun (`ledgerMasihWajibSimpan`); arsip tidak menyentuh ledger.
5. **Jadwal WIB** (`src/jadwal.ts`): rekonsiliasi Senin 09.00, metrik harian 01.00 (batch harian sesuai `pipelines/README.md`), arsip tanggal 1 jam 02.00. Pelaksana menjalankan sekali bila terlewat (catch-up satu kali) dan mengisolasi galat per pekerjaan.
6. Akses data hanya lewat antarmuka baca (`LedgerPembaca`, `PembacaPesananMetrik`, `SumberArsip`); tidak ada tulis balik ke DB titipo atau akses DB Lumbung.

## Asumsi (perlu disahkan keuangan/produk)

- Bentuk ledger (`pokok_rupiah`, `susut_rupiah` per pesanan) belum didefinisikan dokumen; skema ini turunan.
- "Selisih susut > 2%" dibaca sebagai bagian susut di atas toleransi 2%; "maksimal Rp200.000" dibaca sebagai batas total yang dibagi 50:50 per minggu (bukan batas bagian Lumbung). Tafsir lain mengubah angka.
- `transfer_tunggal_rupiah` = total pokok dikurangi bagian Lumbung atas susut. BR-307 hanya menyebut transfer tunggal; rumus ini asumsi.
- Susut dalam toleransi 2% dianggap tidak dibagi (pengaruh ke transfer tidak dimodelkan).
- Definisi hari untuk `tepat_serah` (berdasar tanggal serah), `batal_vendor` dan median (berdasar tanggal dibuat) adalah pilihan implementasi; dokumen metrik tidak menjadwalkan per hari.
- Efek `tandaiDiarsipkan` (pindah/hapus/flag) menyentuh data pemilik pesanan (backend); implementasi konkret tidak ada di repo ini karena dilarang menulis balik ke DB titipo. Perlu keputusan siapa pemilik langkah itu.

## Konsekuensi

- Adapter Postgres untuk pembaca ledger/pesanan dan sumber arsip belum ada; tombol pemicu (proses penjadwal) belum disambung ke runtime.
