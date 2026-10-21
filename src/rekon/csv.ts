import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tanggalIsoWib } from "../shared/waktu.ts";
import { type BarisLedgerPokok, type HasilRekon, type LedgerPembaca, hitungRekonsiliasi, periodeMingguLalu, type KonfigurasiRekon, KONFIGURASI_REKON_BAWAAN } from "./rekonsiliasi.ts";

const KOLOM = ["jenis_baris", "kunci", "id_vendor", "tanggal_selesai_wib", "pokok_rupiah", "susut_rupiah", "nilai"] as const;

/** Escape CSV (RFC 4180) + netralkan awalan rumus spreadsheet pada sel teks. */
export function selCsv(v: string | number): string {
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

const baris = (...sel: (string | number)[]): string => `${sel.map(selCsv).join(",")}\r\n`;

/** Berita acara CSV: satu baris per pesanan + baris ringkasan. Urutan deterministik. */
export function buatCsvBeritaAcara(h: HasilRekon, ledger: readonly BarisLedgerPokok[]): string {
  let out = baris(...KOLOM);
  const urut = [...ledger].sort((a, b) => a.selesai_pada.getTime() - b.selesai_pada.getTime() || a.kode_pesanan.localeCompare(b.kode_pesanan));
  for (const b of urut) {
    out += baris("pesanan", b.kode_pesanan, b.id_vendor, tanggalIsoWib(b.selesai_pada), b.pokok_rupiah, b.susut_rupiah, "");
  }
  const ring: [string, string | number][] = [
    ["periode_mulai", h.periode.labelMulai],
    ["periode_akhir", h.periode.labelAkhir],
    ["jumlah_pesanan", h.jumlahPesanan],
    ["total_pokok_rupiah", h.totalPokokRupiah],
    ["total_susut_rupiah", h.totalSusutRupiah],
    ["susut_persen", h.susutPersen],
    ["selisih_susut_di_atas_ambang_rupiah", h.selisihSusutRupiah],
    ["dibagi_50_50_rupiah", h.dibagiRupiah],
    ["bagian_lumbung_rupiah", h.bagianLumbungRupiah],
    ["bagian_titipo_rupiah", h.bagianTitipoRupiah],
    ["kelebihan_ditanggung_titipo_rupiah", h.kelebihanDitanggungTitipoRupiah],
    ["transfer_tunggal_rupiah", h.transferTunggalRupiah],
  ];
  for (const [k, v] of ring) out += baris("ringkasan", k, "", "", "", "", v);
  return out;
}

export function namaBerkasRekon(h: HasilRekon): string {
  return `rekonsiliasi-pokok-lumbung_${h.periode.labelMulai}_${h.periode.labelAkhir}.csv`;
}

export interface HasilJobRekon {
  readonly status: "ditulis" | "sudah_ada";
  readonly jalur: string;
  readonly hasil: HasilRekon;
}

/** Job Senin 09.00: baca ledger minggu lalu, hitung, tulis CSV (idempoten: tidak menimpa berkas yang sudah ada). */
export async function jalankanJobRekon(
  pembaca: LedgerPembaca,
  direktori: string,
  sekarang: Date,
  konf: KonfigurasiRekon = KONFIGURASI_REKON_BAWAAN,
): Promise<HasilJobRekon> {
  const periode = periodeMingguLalu(sekarang);
  const ledger = await pembaca.bacaPokokSelesai(periode.mulai, periode.akhir);
  const hasil = hitungRekonsiliasi(periode, ledger, konf);
  const jalur = join(direktori, namaBerkasRekon(hasil));
  if (await ada(jalur)) return { status: "sudah_ada", jalur, hasil };
  await mkdir(dirname(jalur), { recursive: true });
  const sementara = `${jalur}.tmp`;
  await writeFile(sementara, buatCsvBeritaAcara(hasil, ledger), "utf8");
  await rename(sementara, jalur);
  return { status: "ditulis", jalur, hasil };
}

async function ada(jalur: string): Promise<boolean> {
  try {
    await stat(jalur);
    return true;
  } catch {
    return false;
  }
}
