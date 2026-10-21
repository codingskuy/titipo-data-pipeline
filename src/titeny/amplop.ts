import { type EventTitipo, SUMBER, VERSI_SKEMA_TITENY, bolehDikirimTitipo } from "./registry.ts";

export interface AmplopTiteny {
  readonly event_id: string; // evt_YYYYMMDD_NNNNNN
  readonly event_type: EventTitipo;
  readonly schema_version: number;
  readonly source: typeof SUMBER;
  readonly occurred_at: string;
  readonly received_at: string;
  readonly batch_id: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export const POLA_EVENT_ID = /^evt_\d{8}_\d{6}$/;
const WIB_MS = 7 * 3600_000;

/** Tanggal kalender WIB (YYYYMMDD), mengikuti contoh Titeny (waktu +07:00). */
export function tanggalWib(d: Date): string {
  return new Date(d.getTime() + WIB_MS).toISOString().slice(0, 10).replaceAll("-", "");
}

/**
 * Pengalokasi event_id. Idempoten: kunci sumber yang sama selalu memberi event_id yang sama,
 * sehingga retry dan pengiriman ulang tidak membuat rekaman ganda di tujuan.
 */
export interface PengalokasiEventId {
  alokasi(kunciSumber: string, tanggal: string): string;
}

export class PengalokasiMemori implements PengalokasiEventId {
  private peta = new Map<string, string>();
  private hitung = new Map<string, number>();

  alokasi(kunciSumber: string, tanggal: string): string {
    const ada = this.peta.get(kunciSumber);
    if (ada) return ada;
    const n = (this.hitung.get(tanggal) ?? 0) + 1;
    if (n > 999_999) throw new Error("urutan event_id harian habis");
    this.hitung.set(tanggal, n);
    const id = `evt_${tanggal}_${String(n).padStart(6, "0")}`;
    this.peta.set(kunciSumber, id);
    return id;
  }
}

export interface OpsiAmplopTiteny {
  readonly kunciSumber: string;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
  readonly pengalokasi: PengalokasiEventId;
  /** Penanda gelombang batch, mis. "realtime" atau "harian". */
  readonly labelBatch?: string;
}

export function buatAmplopTiteny(jenis: EventTitipo, payload: Record<string, unknown>, o: OpsiAmplopTiteny): AmplopTiteny {
  if (!bolehDikirimTitipo(jenis)) throw new Error(`event_type_tidak_dikenal: ${String(jenis)}`);
  const tanggal = tanggalWib(o.occurredAt);
  return {
    event_id: o.pengalokasi.alokasi(`${jenis}|${o.kunciSumber}`, tanggal),
    event_type: jenis,
    schema_version: VERSI_SKEMA_TITENY,
    source: SUMBER,
    occurred_at: o.occurredAt.toISOString(),
    received_at: o.receivedAt.toISOString(),
    batch_id: `batch_${SUMBER}_${tanggalWib(o.receivedAt)}_${o.labelBatch ?? "realtime"}`,
    payload,
  };
}
