// 7 event pesanan TitipO (FSD 30-kontrak §Event). Skema berversi; perubahan skema = bump versi + ADR + 30 hari dual-read.
import { POLA_ULID } from "../shared/ulid.ts";

export const JENIS_EVENT = [
  "pesanan.dibuat",
  "pesanan.dibayar",
  "pesanan.dikonfirmasi",
  "pesanan.diserahkan",
  "pesanan.dialihkan",
  "fee.dicairkan",
  "konflik.dicatat",
] as const;
export type JenisEvent = (typeof JENIS_EVENT)[number];

export const VERSI_SKEMA_SAAT_INI = 1;
/** Versi yang masih diterima pembaca (dual-read 30 hari saat bump versi). */
export const VERSI_DIDUKUNG: readonly number[] = [1];

type Bidang = "string" | "integer" | "kode_pesanan" | "id" | "ulid" | "waktu_utc";
type Spesifikasi = Readonly<Record<string, Bidang | `${Bidang}?`>>;

const POLA_KODE_PESANAN = /^T-\d{4}-\d{6}$/;
const POLA_ID = /^[A-Za-z0-9_-]{1,64}$/;
const POLA_WAKTU_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Skema payload v1 per event. Hanya id anonim, tanpa PII; uang integer rupiah; berat gram integer. */
export const SKEMA_V1: Readonly<Record<JenisEvent, Spesifikasi>> = {
  "pesanan.dibuat": {
    kode_pesanan: "kode_pesanan",
    id_vendor: "id",
    id_rumah_tangga: "id",
    jadwal_serah: "waktu_utc",
    total_item_rupiah: "integer",
    ongkir_rupiah: "integer",
    jumlah_item: "integer",
    berat_total_gram: "integer",
  },
  "pesanan.dibayar": { kode_pesanan: "kode_pesanan", id_gateway: "id", total_bayar_rupiah: "integer" },
  "pesanan.dikonfirmasi": { kode_pesanan: "kode_pesanan", id_vendor: "id", keputusan: "string", alasan_kode: "string?" },
  "pesanan.diserahkan": { kode_pesanan: "kode_pesanan", id_vendor: "id", diserahkan_pada: "waktu_utc" },
  "pesanan.dialihkan": { kode_pesanan: "kode_pesanan", id_vendor_asal: "id", id_vendor_baru: "id", urutan_alih: "integer" },
  "fee.dicairkan": { id_vendor: "id", periode_tanggal: "string", fee_rupiah: "integer", denda_rupiah: "integer", dicairkan_rupiah: "integer" },
  "konflik.dicatat": { kode_pesanan: "kode_pesanan", jenis_konflik: "string", id_pelapor: "id" },
};

/** Kunci terlarang: indikasi PII mentah. Foto tidak lewat pipeline. */
const KUNCI_TERLARANG = /(^|_)(nama|alamat|telepon|telp|hp|email|foto|url_foto|lat|lng|latitude|longitude|ktp|rekening)(_|$)/i;

export interface AmplopOutbox {
  readonly event_id: string; // ULID; sekaligus kunci idempoten
  readonly event_type: JenisEvent;
  readonly schema_version: number;
  readonly occurred_at: string; // ISO-8601 UTC
  readonly payload: Readonly<Record<string, unknown>>;
}

export class GalatValidasi extends Error {
  constructor(public readonly kode: string, public readonly bidang?: string) {
    super(bidang ? `${kode}: ${bidang}` : kode);
    this.name = "GalatValidasi";
  }
}

function cocok(tipe: Bidang, nilai: unknown): boolean {
  switch (tipe) {
    case "string": return typeof nilai === "string" && nilai.length > 0 && nilai.length <= 200;
    case "integer": return typeof nilai === "number" && Number.isSafeInteger(nilai) && nilai >= 0;
    case "kode_pesanan": return typeof nilai === "string" && POLA_KODE_PESANAN.test(nilai);
    case "id": return typeof nilai === "string" && POLA_ID.test(nilai);
    case "ulid": return typeof nilai === "string" && POLA_ULID.test(nilai);
    case "waktu_utc": return typeof nilai === "string" && POLA_WAKTU_UTC.test(nilai) && !Number.isNaN(Date.parse(nilai));
  }
}

export function validasiPayload(jenis: JenisEvent, versi: number, payload: unknown): void {
  if (!VERSI_DIDUKUNG.includes(versi)) throw new GalatValidasi("versi_tidak_didukung", String(versi));
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new GalatValidasi("payload_bukan_objek");
  const obj = payload as Record<string, unknown>;
  const skema = SKEMA_V1[jenis];
  for (const kunci of Object.keys(obj)) {
    if (KUNCI_TERLARANG.test(kunci)) throw new GalatValidasi("pii_terlarang", kunci);
    if (!(kunci in skema)) throw new GalatValidasi("bidang_tidak_dikenal", kunci);
  }
  for (const [kunci, spek] of Object.entries(skema)) {
    const opsional = spek.endsWith("?");
    const tipe = (opsional ? spek.slice(0, -1) : spek) as Bidang;
    const nilai = obj[kunci];
    if (nilai === undefined) {
      if (!opsional) throw new GalatValidasi("bidang_wajib_hilang", kunci);
      continue;
    }
    if (!cocok(tipe, nilai)) throw new GalatValidasi("bidang_tidak_valid", kunci);
  }
}

export function validasiAmplop(a: AmplopOutbox): void {
  if (!(JENIS_EVENT as readonly string[]).includes(a.event_type)) throw new GalatValidasi("event_type_tidak_dikenal", a.event_type);
  if (!cocok("ulid", a.event_id)) throw new GalatValidasi("event_id_bukan_ulid");
  if (!cocok("waktu_utc", a.occurred_at)) throw new GalatValidasi("occurred_at_bukan_utc");
  validasiPayload(a.event_type, a.schema_version, a.payload);
}
