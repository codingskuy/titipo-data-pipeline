// Agregat metrik harian untuk dashboard (metrik/10-repeat-order.md): dihitung di pipeline, bukan di klien.
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HARI_MS, awalHariWib, tanggalIsoWib } from "../shared/waktu.ts";

export type StatusPesanan = "selesai" | "dibatalkan_vendor" | "lainnya";

export interface BarisPesananMetrik {
  readonly kode_pesanan: string;
  readonly id_rumah_tangga: string; // id anonim
  readonly status: StatusPesanan;
  readonly dibuat_pada: Date;
  readonly dikonfirmasi_pada: Date | null;
  readonly diserahkan_pada: Date | null;
  readonly janji_serah_pada: Date | null;
}

export interface PembacaPesananMetrik {
  /** Pesanan yang relevan sepanjang [mulai, akhir): dibuat atau diserahkan di rentang itu. Hanya baca. */
  bacaPesanan(mulai: Date, akhir: Date): Promise<readonly BarisPesananMetrik[]>;
}

export interface Rasio {
  readonly pembilang: number;
  readonly penyebut: number;
  /** null bila penyebut 0 (tak ada data); 4 desimal. */
  readonly nilai: number | null;
}

export interface MetrikHarian {
  readonly skema: 1;
  /** Tanggal WIB (YYYY-MM-DD) hari yang dirangkum. */
  readonly tanggal: string;
  /** Repeat 28 hari bergulir berakhir di akhir hari ini: rumah tangga >=2 selesai / aktif (>=1 selesai). */
  readonly repeat_28h: Rasio;
  /** Serah selesai pada hari ini dalam +-15 menit janji. */
  readonly tepat_serah: Rasio;
  /** Pesanan dibuat hari ini yang berstatus dibatalkan_vendor / total pesanan dibuat hari ini. */
  readonly batal_vendor: Rasio;
  /** Median menit dibuat -> dikonfirmasi untuk pesanan dibuat hari ini dan sudah dikonfirmasi. */
  readonly median_konfirmasi_menit: { readonly nilai: number | null; readonly jumlah_sampel: number };
}

export const TOLERANSI_TEPAT_SERAH_MS = 15 * 60_000;
export const JENDELA_REPEAT_HARI = 28;

const rasio = (p: number, d: number): Rasio => ({ pembilang: p, penyebut: d, nilai: d === 0 ? null : Math.round((p / d) * 10_000) / 10_000 });

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const t = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[t]! : (s[t - 1]! + s[t]!) / 2;
  return Math.round(m * 10) / 10;
}

/** Jendela data yang perlu dibaca untuk menghitung `tanggal` (28 hari ke belakang hingga akhir hari). */
export function jendelaBaca(tanggal: Date): { mulai: Date; akhir: Date } {
  const awal = awalHariWib(tanggal);
  const akhir = new Date(awal.getTime() + HARI_MS);
  return { mulai: new Date(akhir.getTime() - JENDELA_REPEAT_HARI * HARI_MS), akhir };
}

export function hitungMetrikHarian(tanggal: Date, pesanan: readonly BarisPesananMetrik[]): MetrikHarian {
  const awal = awalHariWib(tanggal);
  const akhir = new Date(awal.getTime() + HARI_MS);
  const mulai28 = new Date(akhir.getTime() - JENDELA_REPEAT_HARI * HARI_MS);
  const hariIni = (d: Date | null): boolean => d !== null && d >= awal && d < akhir;

  // repeat 28 hari bergulir (diserahkan di (akhir-28h, akhir])
  const perRumah = new Map<string, number>();
  for (const p of pesanan) {
    if (p.status === "selesai" && p.diserahkan_pada && p.diserahkan_pada >= mulai28 && p.diserahkan_pada < akhir) {
      perRumah.set(p.id_rumah_tangga, (perRumah.get(p.id_rumah_tangga) ?? 0) + 1);
    }
  }
  const aktif = perRumah.size;
  const ulang = [...perRumah.values()].filter((n) => n >= 2).length;

  let serah = 0;
  let tepat = 0;
  let dibuatHariIni = 0;
  let batal = 0;
  const konfirmasi: number[] = [];
  for (const p of pesanan) {
    if (p.status === "selesai" && hariIni(p.diserahkan_pada) && p.janji_serah_pada) {
      serah++;
      if (Math.abs(p.diserahkan_pada!.getTime() - p.janji_serah_pada.getTime()) <= TOLERANSI_TEPAT_SERAH_MS) tepat++;
    }
    if (hariIni(p.dibuat_pada)) {
      dibuatHariIni++;
      if (p.status === "dibatalkan_vendor") batal++;
      if (p.dikonfirmasi_pada) konfirmasi.push((p.dikonfirmasi_pada.getTime() - p.dibuat_pada.getTime()) / 60_000);
    }
  }
  return {
    skema: 1,
    tanggal: tanggalIsoWib(awal),
    repeat_28h: rasio(ulang, aktif),
    tepat_serah: rasio(tepat, serah),
    batal_vendor: rasio(batal, dibuatHariIni),
    median_konfirmasi_menit: { nilai: median(konfirmasi), jumlah_sampel: konfirmasi.length },
  };
}

export interface SinkMetrik {
  /** Idempoten (upsert per tanggal). */
  simpan(m: MetrikHarian): Promise<void>;
}

export class SinkMetrikMemori implements SinkMetrik {
  readonly data = new Map<string, MetrikHarian>();
  async simpan(m: MetrikHarian): Promise<void> {
    this.data.set(m.tanggal, m);
  }
}

/** Satu berkas JSON per hari: data/metrik/harian/YYYY-MM-DD.json (ditimpa atomik bila dijalankan ulang). */
export class SinkMetrikBerkas implements SinkMetrik {
  constructor(private readonly direktori: string) {}
  async simpan(m: MetrikHarian): Promise<void> {
    const jalur = join(this.direktori, `${m.tanggal}.json`);
    await mkdir(dirname(jalur), { recursive: true });
    const sementara = `${jalur}.tmp`;
    await writeFile(sementara, `${JSON.stringify(m, null, 2)}\n`, "utf8");
    await rename(sementara, jalur);
  }
}

/** Job harian: rangkum `tanggal` (hari WIB) lalu simpan. */
export async function jalankanJobMetrikHarian(pembaca: PembacaPesananMetrik, sink: SinkMetrik, tanggal: Date): Promise<MetrikHarian> {
  const { mulai, akhir } = jendelaBaca(tanggal);
  const m = hitungMetrikHarian(tanggal, await pembaca.bacaPesanan(mulai, akhir));
  await sink.simpan(m);
  return m;
}
