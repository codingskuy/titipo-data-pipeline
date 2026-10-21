// Pemetaan sumber TitipO -> payload event Titeny (projects/Titeny/data/20-kontrak-event.md §3.4, §3.7, §3.8).
import { type AmplopTiteny, type OpsiAmplopTiteny, buatAmplopTiteny } from "./amplop.ts";

/** Batas grosir (gram). KONTEKS/AGENTS: 50 kg. FSD v1.0.0 menyebut 20 kg; dibuat konfigurabel, bukan keputusan final. */
export const BATAS_GROSIR_GRAM_BAWAAN = 50_000;

/** Baris transaksi dari outbox/backend. Berat gram integer, uang integer rupiah (FSD). */
export interface SumberTransaksi {
  readonly transaksi_id: string;
  readonly komoditas_id: string;
  readonly berat_gram: number;
  readonly harga_satuan_rupiah_per_kg: number;
  readonly vendor_id: string;
  readonly zona_rute: string;
  readonly waktu: Date;
}

export type StatusVendor = "calon" | "aktif" | "prioritas" | "skors" | "keluar";

export interface SumberVendorStatus {
  readonly vendor_id: string;
  readonly status: StatusVendor;
  readonly jenis: string;
  readonly zona_operasi: string;
  readonly kapasitas_harian_kg: number;
  readonly terjadi_pada: Date;
}

export interface SumberBiayaLogistik {
  readonly rute_id: string;
  readonly jarak_km: number;
  readonly biaya_per_kg: number;
  readonly moda: string;
  readonly berlaku_mulai: string; // YYYY-MM-DD
  readonly sebab: string;
  readonly terjadi_pada: Date;
}

function wajibIntegerPositif(nama: string, n: number): void {
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`bidang_tidak_valid: ${nama}`);
}
function wajibTeks(nama: string, s: string): void {
  if (typeof s !== "string" || s.length === 0) throw new Error(`bidang_tidak_valid: ${nama}`);
}

export function petakanTransaksi(
  s: SumberTransaksi,
  o: Omit<OpsiAmplopTiteny, "kunciSumber" | "occurredAt">,
  batasGrosirGram: number = BATAS_GROSIR_GRAM_BAWAAN,
): AmplopTiteny {
  wajibTeks("transaksi_id", s.transaksi_id);
  wajibTeks("komoditas_id", s.komoditas_id);
  wajibTeks("vendor_id", s.vendor_id);
  wajibTeks("zona_rute", s.zona_rute);
  wajibIntegerPositif("berat_gram", s.berat_gram);
  wajibIntegerPositif("harga_satuan_rupiah_per_kg", s.harga_satuan_rupiah_per_kg);
  return buatAmplopTiteny(
    "transaksi.dibuat",
    {
      transaksi_id: s.transaksi_id,
      komoditas_id: s.komoditas_id,
      qty_kg: s.berat_gram / 1000,
      harga_satuan: s.harga_satuan_rupiah_per_kg,
      vendor_id: s.vendor_id,
      zona_rute: s.zona_rute,
      waktu: s.waktu.toISOString(),
      // Tepat di batas bukan grosir; "di atas 50 kg" = lebih dari.
      grosir: s.berat_gram > batasGrosirGram,
    },
    { ...o, kunciSumber: s.transaksi_id, occurredAt: s.waktu },
  );
}

export function petakanVendorStatus(s: SumberVendorStatus, o: Omit<OpsiAmplopTiteny, "kunciSumber" | "occurredAt">): AmplopTiteny {
  wajibTeks("vendor_id", s.vendor_id);
  wajibTeks("jenis", s.jenis);
  wajibTeks("zona_operasi", s.zona_operasi);
  if (!(s.kapasitas_harian_kg >= 0)) throw new Error("bidang_tidak_valid: kapasitas_harian_kg");
  return buatAmplopTiteny(
    "vendor.status_berubah",
    {
      vendor_id: s.vendor_id,
      jenis: s.jenis,
      status_aktif: s.status === "aktif" || s.status === "prioritas",
      zona_operasi: s.zona_operasi,
      kapasitas_harian_kg: s.kapasitas_harian_kg,
    },
    // kunci idempoten Titeny: vendor_id + occurred_at
    { ...o, kunciSumber: `${s.vendor_id}|${s.terjadi_pada.toISOString()}`, occurredAt: s.terjadi_pada },
  );
}

export function petakanBiayaLogistik(s: SumberBiayaLogistik, o: Omit<OpsiAmplopTiteny, "kunciSumber" | "occurredAt">): AmplopTiteny {
  wajibTeks("rute_id", s.rute_id);
  wajibTeks("moda", s.moda);
  wajibTeks("sebab", s.sebab);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.berlaku_mulai)) throw new Error("bidang_tidak_valid: berlaku_mulai");
  if (!(s.jarak_km >= 0)) throw new Error("bidang_tidak_valid: jarak_km");
  wajibIntegerPositif("biaya_per_kg", s.biaya_per_kg);
  return buatAmplopTiteny(
    "logistik.biaya_diperbarui",
    {
      rute_id: s.rute_id,
      jarak_km: s.jarak_km,
      biaya_per_kg: s.biaya_per_kg,
      moda: s.moda,
      berlaku_mulai: s.berlaku_mulai,
      sebab: s.sebab,
    },
    // kunci idempoten Titeny: rute_id + berlaku_mulai
    { ...o, kunciSumber: `${s.rute_id}|${s.berlaku_mulai}`, occurredAt: s.terjadi_pada },
  );
}
