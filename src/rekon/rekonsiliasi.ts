// BR-307: rekonsiliasi pokok Lumbung tiap Senin 09.00 (transfer tunggal + berita acara CSV).
import { HARI_MS, WIB_MS, tanggalIsoWib } from "../shared/waktu.ts";

export const AMBANG_SUSUT_PERSEN = 2;
export const BATAS_BAGI_MINGGUAN_RUPIAH = 200_000;

export interface KonfigurasiRekon {
  /** Selisih susut di atas persen ini dibagi 50:50. */
  readonly ambangSusutPersen: number;
  /** Batas total yang dibagi 50:50 per minggu; selebihnya ditanggung TitipO. */
  readonly batasBagiMingguanRupiah: number;
}
export const KONFIGURASI_REKON_BAWAAN: KonfigurasiRekon = {
  ambangSusutPersen: AMBANG_SUSUT_PERSEN,
  batasBagiMingguanRupiah: BATAS_BAGI_MINGGUAN_RUPIAH,
};

/** Baris ledger (hanya baca). Uang integer rupiah. */
export interface BarisLedgerPokok {
  readonly kode_pesanan: string;
  readonly id_vendor: string;
  readonly selesai_pada: Date;
  /** Harga pokok Lumbung untuk pesanan itu. */
  readonly pokok_rupiah: number;
  /** Nilai susut (rupiah pada harga pokok) yang tercatat pada pesanan itu. */
  readonly susut_rupiah: number;
}

export interface LedgerPembaca {
  /** Baris ledger pesanan selesai pada [mulai, akhir). Hanya baca; tidak menulis DB titipo/Lumbung. */
  bacaPokokSelesai(mulai: Date, akhir: Date): Promise<readonly BarisLedgerPokok[]>;
}

export interface PeriodeRekon {
  readonly mulai: Date; // Senin 00:00 WIB (inklusif)
  readonly akhir: Date; // Senin berikutnya 00:00 WIB (eksklusif)
  readonly labelMulai: string; // YYYY-MM-DD (Senin)
  readonly labelAkhir: string; // YYYY-MM-DD (Minggu, inklusif)
}

/** Periode minggu lalu (Senin-Minggu WIB) relatif terhadap saat job jalan. */
export function periodeMingguLalu(sekarang: Date): PeriodeRekon {
  const g = new Date(sekarang.getTime() + WIB_MS);
  const awalHari = Date.UTC(g.getUTCFullYear(), g.getUTCMonth(), g.getUTCDate());
  const hariKeSejakSenin = (new Date(awalHari).getUTCDay() + 6) % 7;
  const seninIni = awalHari - hariKeSejakSenin * HARI_MS;
  const mulai = new Date(seninIni - 7 * HARI_MS - WIB_MS);
  const akhir = new Date(seninIni - WIB_MS);
  return { mulai, akhir, labelMulai: tanggalIsoWib(mulai), labelAkhir: tanggalIsoWib(new Date(akhir.getTime() - 1)) };
}

export interface HasilRekon {
  readonly periode: PeriodeRekon;
  readonly jumlahPesanan: number;
  readonly totalPokokRupiah: number;
  readonly totalSusutRupiah: number;
  /** Susut dalam persen dari total pokok (4 desimal), 0 bila tak ada pokok. */
  readonly susutPersen: number;
  /** Bagian susut di atas toleransi ambang. */
  readonly selisihSusutRupiah: number;
  /** Yang dibagi 50:50 (maks batas mingguan). */
  readonly dibagiRupiah: number;
  readonly bagianLumbungRupiah: number;
  readonly bagianTitipoRupiah: number;
  /** Selisih di atas batas bagi, ditanggung TitipO sepenuhnya. */
  readonly kelebihanDitanggungTitipoRupiah: number;
  /** ASUMSI: pokok dikurangi bagian Lumbung atas susut. Perlu disahkan keuangan. */
  readonly transferTunggalRupiah: number;
}

function wajibIntegerNonNegatif(nama: string, n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`bidang_tidak_valid: ${nama}`);
}

export function hitungRekonsiliasi(
  periode: PeriodeRekon,
  baris: readonly BarisLedgerPokok[],
  konf: KonfigurasiRekon = KONFIGURASI_REKON_BAWAAN,
): HasilRekon {
  let pokok = 0;
  let susut = 0;
  for (const b of baris) {
    wajibIntegerNonNegatif("pokok_rupiah", b.pokok_rupiah);
    wajibIntegerNonNegatif("susut_rupiah", b.susut_rupiah);
    if (b.selesai_pada < periode.mulai || b.selesai_pada >= periode.akhir) throw new Error(`baris_di_luar_periode: ${b.kode_pesanan}`);
    pokok += b.pokok_rupiah;
    susut += b.susut_rupiah;
  }
  // Toleransi = ambang% dari pokok, dibulatkan ke bawah (integer rupiah).
  const toleransi = Math.floor((pokok * konf.ambangSusutPersen) / 100);
  const selisih = Math.max(0, susut - toleransi);
  const dibagi = Math.min(selisih, konf.batasBagiMingguanRupiah);
  const bagianLumbung = Math.floor(dibagi / 2);
  const bagianTitipo = dibagi - bagianLumbung;
  const kelebihan = selisih - dibagi;
  return {
    periode,
    jumlahPesanan: baris.length,
    totalPokokRupiah: pokok,
    totalSusutRupiah: susut,
    susutPersen: pokok === 0 ? 0 : Math.round((susut / pokok) * 1_000_000) / 10_000,
    selisihSusutRupiah: selisih,
    dibagiRupiah: dibagi,
    bagianLumbungRupiah: bagianLumbung,
    bagianTitipoRupiah: bagianTitipo,
    kelebihanDitanggungTitipoRupiah: kelebihan,
    transferTunggalRupiah: pokok - bagianLumbung,
  };
}
