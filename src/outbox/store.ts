import type { AmplopOutbox } from "./events.ts";

export type StatusOutbox = "menunggu" | "terkirim" | "gagal";

export interface BarisOutbox {
  readonly seq: number; // urutan FIFO
  readonly amplop: AmplopOutbox;
  /** Kunci urutan: event dengan agregat sama dikirim berurutan (mis. kode pesanan). */
  readonly agregat: string;
  readonly status: StatusOutbox;
  readonly percobaan: number;
  readonly dibuatPada: Date;
  readonly cobaBerikutnya: Date;
  readonly kesalahanTerakhir: string | null;
  readonly terkirimPada: Date | null;
}

export interface OutboxStore {
  /** Idempoten menurut event_id: kembali false bila sudah ada (tidak ada rekaman ganda). */
  enqueue(amplop: AmplopOutbox, agregat: string, sekarang: Date): Promise<boolean>;
  /** FIFO; hanya baris jatuh tempo dan tidak terhalang baris lebih awal milik agregat yang sama. */
  ambilJatuhTempo(sekarang: Date, batas: number): Promise<BarisOutbox[]>;
  tandaiTerkirim(eventId: string, sekarang: Date): Promise<void>;
  jadwalUlang(eventId: string, cobaBerikutnya: Date, kesalahan: string): Promise<void>;
  tandaiGagal(eventId: string, kesalahan: string): Promise<void>;
  /** Kirim ulang manual: baris gagal kembali menunggu dengan jendela retry baru. */
  kirimUlangManual(eventId: string, sekarang: Date): Promise<boolean>;
  daftarGagal(): Promise<BarisOutbox[]>;
}

export class OutboxMemori implements OutboxStore {
  private baris: BarisOutbox[] = [];
  private seq = 0;

  async enqueue(amplop: AmplopOutbox, agregat: string, sekarang: Date): Promise<boolean> {
    if (this.baris.some((b) => b.amplop.event_id === amplop.event_id)) return false;
    this.baris.push({
      seq: ++this.seq,
      amplop,
      agregat,
      status: "menunggu",
      percobaan: 0,
      dibuatPada: sekarang,
      cobaBerikutnya: sekarang,
      kesalahanTerakhir: null,
      terkirimPada: null,
    });
    return true;
  }

  async ambilJatuhTempo(sekarang: Date, batas: number): Promise<BarisOutbox[]> {
    const terhalang = new Set<string>();
    const hasil: BarisOutbox[] = [];
    for (const b of [...this.baris].sort((x, y) => x.seq - y.seq)) {
      if (b.status === "terkirim") continue;
      if (terhalang.has(b.agregat)) continue;
      if (b.status === "gagal" || b.cobaBerikutnya.getTime() > sekarang.getTime()) {
        terhalang.add(b.agregat);
        continue;
      }
      hasil.push(b);
      terhalang.add(b.agregat); // satu baris per agregat per putaran
      if (hasil.length >= batas) break;
    }
    return hasil;
  }

  private ubah(eventId: string, f: (b: BarisOutbox) => BarisOutbox): void {
    const i = this.baris.findIndex((b) => b.amplop.event_id === eventId);
    if (i < 0) throw new Error(`event tidak ada di outbox: ${eventId}`);
    this.baris[i] = f(this.baris[i]!);
  }

  async tandaiTerkirim(eventId: string, sekarang: Date): Promise<void> {
    this.ubah(eventId, (b) => ({ ...b, status: "terkirim", percobaan: b.percobaan + 1, terkirimPada: sekarang }));
  }

  async jadwalUlang(eventId: string, cobaBerikutnya: Date, kesalahan: string): Promise<void> {
    this.ubah(eventId, (b) => ({ ...b, percobaan: b.percobaan + 1, cobaBerikutnya, kesalahanTerakhir: kesalahan }));
  }

  async tandaiGagal(eventId: string, kesalahan: string): Promise<void> {
    this.ubah(eventId, (b) => ({ ...b, status: "gagal", percobaan: b.percobaan + 1, kesalahanTerakhir: kesalahan }));
  }

  async kirimUlangManual(eventId: string, sekarang: Date): Promise<boolean> {
    const b = this.baris.find((x) => x.amplop.event_id === eventId);
    if (!b || b.status !== "gagal") return false;
    this.ubah(eventId, (x) => ({ ...x, status: "menunggu", percobaan: 0, dibuatPada: sekarang, cobaBerikutnya: sekarang }));
    return true;
  }

  async daftarGagal(): Promise<BarisOutbox[]> {
    return this.baris.filter((b) => b.status === "gagal");
  }

  semua(): readonly BarisOutbox[] {
    return this.baris;
  }
}
