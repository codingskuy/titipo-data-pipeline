import { type AmplopOutbox, type JenisEvent, VERSI_SKEMA_SAAT_INI, validasiAmplop } from "./events.ts";
import { ulid } from "../shared/ulid.ts";

export interface OpsiAmplop {
  readonly sekarang?: Date;
  readonly buatUlid?: (ms?: number) => string;
}

/** Bangun amplop idempoten berversi: ULID, waktu UTC, versi skema. Gagal bila payload tak sesuai skema. */
export function buatAmplop(jenis: JenisEvent, payload: Record<string, unknown>, opsi: OpsiAmplop = {}): AmplopOutbox {
  const waktu = opsi.sekarang ?? new Date();
  const amplop: AmplopOutbox = {
    event_id: (opsi.buatUlid ?? ulid)(waktu.getTime()),
    jenis,
    schema_version: VERSI_SKEMA_SAAT_INI,
    occurred_at: waktu.toISOString(),
    data: payload,
  };
  validasiAmplop(amplop);
  return amplop;
}
