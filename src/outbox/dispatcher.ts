import type { AmplopOutbox } from "./events.ts";
import type { OutboxStore } from "./store.ts";

/**
 * Hasil kirim ke tujuan.
 * - terkirim: diterima.
 * - duplikat: tujuan menolak karena kunci idempoten sama -> ditandai terkirim tanpa kirim ulang.
 * - sementara: gangguan (timeout, 5xx) -> retry.
 * - ditolak: validasi tujuan (422) -> gagal permanen, perlu perbaikan lalu kirim ulang manual.
 */
export type HasilKirim =
  | { hasil: "terkirim" }
  | { hasil: "duplikat" }
  | { hasil: "sementara"; alasan: string }
  | { hasil: "ditolak"; alasan: string };

export interface Pengirim {
  /** kunciIdempoten = event_id (ULID). */
  kirim(amplop: AmplopOutbox, kunciIdempoten: string): Promise<HasilKirim>;
}

export interface KonfigurasiDispatcher {
  readonly jedaRetryMs: number; // 30 detik
  readonly batasRetryMs: number; // 24 jam sejak dibuat
  readonly ukuranBatch: number;
}

export const KONFIGURASI_BAWAAN: KonfigurasiDispatcher = {
  jedaRetryMs: 30_000,
  batasRetryMs: 24 * 60 * 60 * 1000,
  ukuranBatch: 100,
};

export interface RingkasanPutaran {
  terkirim: number;
  duplikat: number;
  diulang: number;
  gagal: number;
}

/** Satu putaran: kirim FIFO, sekali per event; retry dijadwalkan 30 detik, menyerah setelah 24 jam. */
export async function jalankanPutaran(
  store: OutboxStore,
  pengirim: Pengirim,
  sekarang: Date,
  konf: KonfigurasiDispatcher = KONFIGURASI_BAWAAN,
): Promise<RingkasanPutaran> {
  const r: RingkasanPutaran = { terkirim: 0, duplikat: 0, diulang: 0, gagal: 0 };
  for (const b of await store.ambilJatuhTempo(sekarang, konf.ukuranBatch)) {
    let hasil: HasilKirim;
    try {
      hasil = await pengirim.kirim(b.amplop, b.amplop.event_id);
    } catch (e) {
      hasil = { hasil: "sementara", alasan: e instanceof Error ? e.message : String(e) };
    }
    switch (hasil.hasil) {
      case "terkirim":
        await store.tandaiTerkirim(b.amplop.event_id, sekarang);
        r.terkirim++;
        break;
      case "duplikat":
        await store.tandaiTerkirim(b.amplop.event_id, sekarang);
        r.duplikat++;
        break;
      case "ditolak":
        await store.tandaiGagal(b.amplop.event_id, `ditolak: ${hasil.alasan}`);
        r.gagal++;
        break;
      case "sementara": {
        const umur = sekarang.getTime() - b.dibuatPada.getTime();
        const berikutnya = new Date(sekarang.getTime() + konf.jedaRetryMs);
        if (umur >= konf.batasRetryMs || berikutnya.getTime() - b.dibuatPada.getTime() > konf.batasRetryMs) {
          await store.tandaiGagal(b.amplop.event_id, `melewati batas retry 24 jam: ${hasil.alasan}`);
          r.gagal++;
        } else {
          await store.jadwalUlang(b.amplop.event_id, berikutnya, hasil.alasan);
          r.diulang++;
        }
      }
    }
  }
  return r;
}
