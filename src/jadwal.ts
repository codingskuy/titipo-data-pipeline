import { berikutnyaHarian, berikutnyaSenin, berikutnyaTanggalSatu } from "./shared/waktu.ts";

export interface Pekerjaan {
  readonly nama: string;
  /** Waktu jalan pertama yang > sejak. */
  readonly berikutnya: (sejak: Date) => Date;
  /** `dijadwalkan` = waktu terjadwal yang sedang dipenuhi. */
  readonly jalankan: (dijadwalkan: Date) => Promise<void>;
}

/** Jadwal WIB: rekonsiliasi Senin 09.00, metrik harian 01.00 (batch harian), arsip tanggal 1 jam 02.00. */
export const JADWAL = {
  rekonsiliasiSenin: (sejak: Date) => berikutnyaSenin(sejak, 9, 0),
  metrikHarian: (sejak: Date) => berikutnyaHarian(sejak, 1, 0),
  arsipBulanan: (sejak: Date) => berikutnyaTanggalSatu(sejak, 2, 0),
} as const;

export interface KondisiJadwal {
  /** nama -> waktu terjadwal berikutnya. Disimpan pemanggil bila ingin tahan restart. */
  readonly berikutnya: Map<string, Date>;
}

/**
 * Jalankan pekerjaan yang jatuh tempo pada `sekarang`. Bila terlewat beberapa kali (mis. proses mati),
 * hanya dijalankan sekali (catch-up satu kali) lalu dijadwalkan ke waktu berikutnya setelah `sekarang`.
 * Galat satu pekerjaan tidak menghentikan yang lain dan dilaporkan.
 */
export async function jalankanJatuhTempo(
  pekerjaan: readonly Pekerjaan[],
  kondisi: KondisiJadwal,
  sekarang: Date,
): Promise<{ nama: string; galat?: string }[]> {
  const hasil: { nama: string; galat?: string }[] = [];
  for (const p of pekerjaan) {
    const jadwal = kondisi.berikutnya.get(p.nama) ?? p.berikutnya(sekarang);
    if (!kondisi.berikutnya.has(p.nama)) {
      kondisi.berikutnya.set(p.nama, jadwal);
    }
    if (jadwal.getTime() > sekarang.getTime()) continue;
    kondisi.berikutnya.set(p.nama, p.berikutnya(sekarang));
    try {
      await p.jalankan(jadwal);
      hasil.push({ nama: p.nama });
    } catch (e) {
      hasil.push({ nama: p.nama, galat: e instanceof Error ? e.message : String(e) });
    }
  }
  return hasil;
}
