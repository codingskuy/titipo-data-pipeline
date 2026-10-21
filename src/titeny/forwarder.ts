import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AmplopTiteny } from "./amplop.ts";
import { bolehDikirimTitipo } from "./registry.ts";

export const JEDA_RETRY_DETIK = [5, 30, 300] as const;
export const TIMEOUT_KIRIM_MS = 10_000;

export type HasilTransport =
  | { hasil: "terkirim" }
  | { hasil: "duplikat" }
  | { hasil: "sementara"; alasan: string }
  | { hasil: "ditolak"; alasan: string };

export interface TransportTiteny {
  kirim(a: AmplopTiteny): Promise<HasilTransport>;
}

/** Transport HTTP: POST {baseUrl}/api/v1/event/masuk dengan X-Idempotency-Key = event_id. */
export function buatTransportHttp(opsi: {
  baseUrl: string;
  kunciLayanan?: string; // ASUMSI: header X-Titipo-Service-Key (auth Titeny belum tertulis)
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): TransportTiteny {
  const f = opsi.fetchFn ?? fetch;
  return {
    async kirim(a) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-idempotency-key": a.event_id,
      };
      if (opsi.kunciLayanan) headers["x-titipo-service-key"] = opsi.kunciLayanan;
      let res: Response;
      try {
        res = await f(`${opsi.baseUrl.replace(/\/$/, "")}/api/v1/event/masuk`, {
          method: "POST",
          headers,
          body: JSON.stringify(a),
          signal: AbortSignal.timeout(opsi.timeoutMs ?? TIMEOUT_KIRIM_MS),
        });
      } catch (e) {
        return { hasil: "sementara", alasan: e instanceof Error ? e.message : String(e) };
      }
      if (res.status === 422) {
        const teks = await res.text().catch(() => "");
        return { hasil: "ditolak", alasan: teks.slice(0, 300) || "422" };
      }
      if (res.ok) {
        const badan = (await res.json().catch(() => null)) as { status?: string } | null;
        return badan?.status === "duplikat_diabaikan" ? { hasil: "duplikat" } : { hasil: "terkirim" };
      }
      return { hasil: "sementara", alasan: `HTTP ${res.status}` };
    },
  };
}

export interface RekamanDlq {
  readonly amplop: AmplopTiteny;
  readonly alasan: string;
  readonly percobaan: number;
  readonly masuk_dlq_pada: string;
}

export interface Dlq {
  masukkan(r: RekamanDlq): Promise<void>;
}

export class DlqMemori implements Dlq {
  readonly isi: RekamanDlq[] = [];
  async masukkan(r: RekamanDlq): Promise<void> {
    this.isi.push(r);
  }
}

/** DLQ berkas NDJSON (append-only), mis. data/dlq/titeny.ndjson. */
export class DlqBerkas implements Dlq {
  constructor(private readonly jalur: string) {}
  async masukkan(r: RekamanDlq): Promise<void> {
    await mkdir(dirname(this.jalur), { recursive: true });
    await appendFile(this.jalur, `${JSON.stringify(r)}\n`, "utf8");
  }
}

export type HasilForward = "terkirim" | "duplikat" | "dlq";

/** Kirim sekali + retry 3x (5/30/300 detik); gagal terus atau ditolak 422 -> DLQ. */
export async function teruskan(
  a: AmplopTiteny,
  transport: TransportTiteny,
  dlq: Dlq,
  opsi: { tidur?: (ms: number) => Promise<void>; sekarang?: () => Date } = {},
): Promise<HasilForward> {
  if (!bolehDikirimTitipo(a.event_type)) throw new Error(`event_type_tidak_dikenal: ${String(a.event_type)}`);
  const tidur = opsi.tidur ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const sekarang = opsi.sekarang ?? (() => new Date());
  let alasan = "";
  const totalPercobaan = JEDA_RETRY_DETIK.length + 1;
  for (let i = 0; i < totalPercobaan; i++) {
    if (i > 0) await tidur(JEDA_RETRY_DETIK[i - 1]! * 1000);
    let h: HasilTransport;
    try {
      h = await transport.kirim(a);
    } catch (e) {
      h = { hasil: "sementara", alasan: e instanceof Error ? e.message : String(e) };
    }
    if (h.hasil === "terkirim" || h.hasil === "duplikat") return h.hasil;
    alasan = h.alasan;
    if (h.hasil === "ditolak") {
      // 422: retry tak berguna; perbaiki lalu kirim ulang dengan event_id baru.
      await dlq.masukkan({ amplop: a, alasan: `ditolak: ${alasan}`, percobaan: i + 1, masuk_dlq_pada: sekarang().toISOString() });
      return "dlq";
    }
  }
  await dlq.masukkan({ amplop: a, alasan, percobaan: totalPercobaan, masuk_dlq_pada: sekarang().toISOString() });
  return "dlq";
}
