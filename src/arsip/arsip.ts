// Arsip pesanan selesai > 2 tahun (job tanggal 1 jam 02.00 WIB). Ledger audit tetap tersimpan 2 tahun.
import { kurangiTahun } from "../shared/waktu.ts";

export const MASA_SIMPAN_TAHUN = 2;

export interface PesananSelesai {
  readonly kode_pesanan: string;
  readonly selesai_pada: Date;
}

/** Batas: pesanan yang selesai SEBELUM tanggal ini sudah lebih dari 2 tahun. */
export const batasArsip = (sekarang: Date): Date => kurangiTahun(sekarang, MASA_SIMPAN_TAHUN);

export function pilihUntukArsip<T extends PesananSelesai>(pesanan: readonly T[], sekarang: Date): T[] {
  const batas = batasArsip(sekarang);
  return pesanan.filter((p) => p.selesai_pada < batas);
}

/** Ledger audit wajib disimpan 2 tahun sejak dicatat; sebelum itu tidak boleh dihapus/diarsipkan keluar. */
export function ledgerMasihWajibSimpan(dicatatPada: Date, sekarang: Date): boolean {
  return dicatatPada >= batasArsip(sekarang);
}

export interface SumberArsip {
  /** Pesanan berstatus selesai dan selesai_pada < batas, belum diarsipkan. Hanya baca. */
  daftarSelesaiSebelum(batas: Date, limit: number): Promise<readonly PesananSelesai[]>;
  /** Penandaan setelah salinan arsip aman tersimpan. Pemilik data (backend) yang memutuskan efeknya. */
  tandaiDiarsipkan(kode: readonly string[]): Promise<void>;
}

export interface TujuanArsip {
  /** Idempoten menurut kode_pesanan; kembali setelah data tersimpan permanen. */
  simpan(pesanan: readonly PesananSelesai[]): Promise<void>;
}

export interface HasilArsip {
  readonly batas: Date;
  readonly diarsipkan: number;
}

export async function jalankanJobArsip(sumber: SumberArsip, tujuan: TujuanArsip, sekarang: Date, ukuranBatch = 500): Promise<HasilArsip> {
  const batas = batasArsip(sekarang);
  let total = 0;
  for (;;) {
    const kandidat = pilihUntukArsip(await sumber.daftarSelesaiSebelum(batas, ukuranBatch), sekarang);
    if (kandidat.length === 0) break;
    await tujuan.simpan(kandidat); // simpan dulu; tandai hanya bila simpan berhasil
    await sumber.tandaiDiarsipkan(kandidat.map((p) => p.kode_pesanan));
    total += kandidat.length;
    if (kandidat.length < ukuranBatch) break;
  }
  return { batas, diarsipkan: total };
}
