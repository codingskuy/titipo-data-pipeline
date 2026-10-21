// Registry 11 event Titeny (KONTEKS-LINTAS-DIVISI §3). TitipO (source=titipo) hanya boleh mengirim 3 di antaranya.
export const REGISTRY_TITENY = [
  "harga.diperbarui",
  "stok.berubah",
  "stok.snapshot_harian",
  "transaksi.dibuat",
  "lapak.status_berubah",
  "panen.dicatat",
  "logistik.biaya_diperbarui",
  "vendor.status_berubah",
  "cuaca.diperbarui",
  "kalender.dikunci",
  "keuangan.ringkasan_harian",
] as const;

export const EVENT_DARI_TITIPO = ["transaksi.dibuat", "vendor.status_berubah", "logistik.biaya_diperbarui"] as const;
export type EventTitipo = (typeof EVENT_DARI_TITIPO)[number];

export const SUMBER = "titipo" as const;
export const VERSI_SKEMA_TITENY = 1;

export function bolehDikirimTitipo(jenis: string): jenis is EventTitipo {
  return (EVENT_DARI_TITIPO as readonly string[]).includes(jenis);
}
