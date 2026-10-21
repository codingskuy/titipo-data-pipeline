# TitipO Data Pipeline — Divisi TitipO (Community Commerce)

> Aliran event pesanan TitipO → Titeny (analitik).
> TownHall: [TitipO-TownHall](https://github.com/Coding-Skuy/TitipO-TownHall).
> Kontrak auth pola Lumbung: [Lumbung-TownHall](https://github.com/Coding-Skuy/Lumbung-TownHall) — JWT `aud=titipo`, service key `titipo→lumbung`.

## Alur

```text
titipo-backend-service (DB titipo: pesanan, langganan)
  → outbox event pesanan dibuat/diantar/selesai
  → pipelines/order_to_titeny
  → Titeny (analitik pola titip)
```

## Event

7 event pesanan di outbox (FSD 30-kontrak; skema v1 di `src/outbox/events.ts`, keputusan di ADR-0002):

| Nama | Kapan |
|------|-------|
| `pesanan.dibuat` | checkout pesanan |
| `pesanan.dibayar` | pembayaran dikonfirmasi gateway |
| `pesanan.dikonfirmasi` | vendor menerima/menolak |
| `pesanan.diserahkan` | serah ke rumah tangga |
| `pesanan.dialihkan` | pesanan dialihkan ke vendor cadangan |
| `fee.dicairkan` | job cair-fee |
| `konflik.dicatat` | konflik/laporan pesanan |

Tanpa PII mentah, hanya id anonim.

## Pengembangan

```bash
bun install
bun run check   # tsc strict
bun test
```

## Struktur

```text
pipelines/README.md          # daftar pipeline + jadwal
pipelines/order_to_titeny.md # kontrak event → Titeny
```

## Tautan

- TownHall: https://github.com/Coding-Skuy/TitipO-TownHall
- Backend DB: https://github.com/Coding-Skuy/titipo-backend-service
- AI konsumen: https://github.com/Coding-Skuy/titipo-ai-models
