# CHANGELOG — titipo-data-pipeline

## [Belum dirilis]

### Ditambahkan
- 2026-10-21: TTP-DATA-003 forwarder `transaksi.dibuat`, `vendor.status_berubah`, `logistik.biaya_diperbarui` ke Titeny (`src/titeny/`, ADR-0003), flag grosir > 50 kg konfigurabel, retry 5/30/300 detik + DLQ.
- 2026-10-21: TTP-DATA-002 outbox 7 event pesanan + amplop idempoten berversi (`src/outbox/`, ADR-0002), scaffold Bun + TypeScript strict.
- 2026-10-14: fondasi AI-dev v1.0.0 (`AGENTS.md`, `CLAUDE.md`, `docs/decisions/ADR-0001-fondasi-teknis.md`, `versions/v1.0.0/docs/40-TECHSTACK.md`, `versions/v1.0.0/docs/60-BLAST-RADIUS.md`).
