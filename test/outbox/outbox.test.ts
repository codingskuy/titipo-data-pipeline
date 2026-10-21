import { describe, expect, test } from "bun:test";
import { buatAmplop } from "../../src/outbox/amplop.ts";
import { type JenisEvent, JENIS_EVENT, GalatValidasi, validasiAmplop } from "../../src/outbox/events.ts";
import { type HasilKirim, type Pengirim, jalankanPutaran } from "../../src/outbox/dispatcher.ts";
import { OutboxMemori } from "../../src/outbox/store.ts";
import { POLA_ULID, buatPembuatUlid, ulid } from "../../src/shared/ulid.ts";

const T0 = new Date("2026-10-21T01:00:00.000Z");
const KODE = "T-2026-000112";

const CONTOH: Record<JenisEvent, Record<string, unknown>> = {
  "pesanan.dibuat": { kode_pesanan: KODE, id_vendor: "vnd_001", id_rumah_tangga: "rt_9", jadwal_serah: "2026-10-22T23:00:00Z", total_item_rupiah: 47000, ongkir_rupiah: 5000, jumlah_item: 3, berat_total_gram: 4000 },
  "pesanan.dibayar": { kode_pesanan: KODE, id_gateway: "gw_77", total_bayar_rupiah: 52000 },
  "pesanan.dikonfirmasi": { kode_pesanan: KODE, id_vendor: "vnd_001", keputusan: "terima" },
  "pesanan.diserahkan": { kode_pesanan: KODE, id_vendor: "vnd_001", diserahkan_pada: "2026-10-22T23:30:00Z" },
  "pesanan.dialihkan": { kode_pesanan: KODE, id_vendor_asal: "vnd_001", id_vendor_baru: "vnd_002", urutan_alih: 1 },
  "fee.dicairkan": { id_vendor: "vnd_001", periode_tanggal: "2026-10-20", fee_rupiah: 5640, denda_rupiah: 0, dicairkan_rupiah: 9640 },
  "konflik.dicatat": { kode_pesanan: KODE, jenis_konflik: "barang_tidak_sesuai", id_pelapor: "rt_9" },
};

function pengirimDari(urutan: HasilKirim[], catat: string[] = []): Pengirim {
  let i = 0;
  return {
    async kirim(a, kunci) {
      catat.push(`${a.event_id}|${kunci}`);
      return urutan[Math.min(i++, urutan.length - 1)]!;
    },
  };
}

describe("ULID", () => {
  test("format valid dan monotonik pada ms yang sama", () => {
    const buat = buatPembuatUlid(() => new Uint8Array(10));
    const a = buat(1_700_000_000_000);
    const b = buat(1_700_000_000_000);
    expect(a).toMatch(POLA_ULID);
    expect(b > a).toBe(true);
    expect(ulid()).toMatch(POLA_ULID);
  });
});

describe("7 event berversi", () => {
  test("tujuh jenis persis sesuai FSD", () => {
    expect([...JENIS_EVENT]).toEqual(["pesanan.dibuat", "pesanan.dibayar", "pesanan.dikonfirmasi", "pesanan.diserahkan", "pesanan.dialihkan", "fee.dicairkan", "konflik.dicatat"]);
  });

  for (const jenis of JENIS_EVENT) {
    test(`amplop ${jenis} membawa ULID, waktu UTC, versi`, () => {
      const a = buatAmplop(jenis, CONTOH[jenis], { sekarang: T0 });
      expect(a.event_id).toMatch(POLA_ULID);
      expect(a.occurred_at).toBe("2026-10-21T01:00:00.000Z");
      expect(a.schema_version).toBe(1);
      expect(() => validasiAmplop(a)).not.toThrow();
    });
  }

  test("bidang wajib hilang ditolak", () => {
    const { total_bayar_rupiah: _, ...sisa } = CONTOH["pesanan.dibayar"]!;
    expect(() => buatAmplop("pesanan.dibayar", sisa)).toThrow(GalatValidasi);
  });

  test("PII mentah ditolak (nama, alamat, foto)", () => {
    for (const kunci of ["nama_pembeli", "alamat", "url_foto", "telepon"]) {
      expect(() => buatAmplop("pesanan.dibayar", { ...CONTOH["pesanan.dibayar"]!, [kunci]: "x" })).toThrow(/pii_terlarang/);
    }
  });

  test("versi tak didukung dan bidang asing ditolak", () => {
    const a = buatAmplop("pesanan.dibayar", CONTOH["pesanan.dibayar"]!);
    expect(() => validasiAmplop({ ...a, schema_version: 2 })).toThrow(/versi_tidak_didukung/);
    expect(() => buatAmplop("pesanan.dibayar", { ...CONTOH["pesanan.dibayar"]!, ekstra: 1 })).toThrow(/bidang_tidak_dikenal/);
  });

  test("uang non-integer dan waktu bukan UTC ditolak", () => {
    expect(() => buatAmplop("pesanan.dibayar", { ...CONTOH["pesanan.dibayar"]!, total_bayar_rupiah: 100.5 })).toThrow(GalatValidasi);
    expect(() => buatAmplop("pesanan.diserahkan", { ...CONTOH["pesanan.diserahkan"]!, diserahkan_pada: "2026-10-22T06:30:00+07:00" })).toThrow(GalatValidasi);
  });
});

describe("outbox FIFO kirim sekali", () => {
  test("enqueue idempoten menurut event_id", async () => {
    const s = new OutboxMemori();
    const a = buatAmplop("pesanan.dibayar", CONTOH["pesanan.dibayar"]!, { sekarang: T0 });
    expect(await s.enqueue(a, KODE, T0)).toBe(true);
    expect(await s.enqueue(a, KODE, T0)).toBe(false);
    expect(s.semua().length).toBe(1);
  });

  test("urutan FIFO dan kunci idempoten = event_id", async () => {
    const s = new OutboxMemori();
    const catat: string[] = [];
    const a1 = buatAmplop("pesanan.dibuat", CONTOH["pesanan.dibuat"]!, { sekarang: T0 });
    const a2 = buatAmplop("pesanan.dibayar", CONTOH["pesanan.dibayar"]!, { sekarang: T0 });
    await s.enqueue(a1, KODE, T0);
    await s.enqueue(a2, "T-2026-000999", T0);
    const r = await jalankanPutaran(s, pengirimDari([{ hasil: "terkirim" }], catat), T0);
    expect(r.terkirim).toBe(2);
    expect(catat).toEqual([`${a1.event_id}|${a1.event_id}`, `${a2.event_id}|${a2.event_id}`]);
    // putaran berikutnya tidak mengirim ulang
    const r2 = await jalankanPutaran(s, pengirimDari([{ hasil: "terkirim" }], catat), T0);
    expect(r2.terkirim).toBe(0);
    expect(catat.length).toBe(2);
  });

  test("duplikat ditandai terkirim tanpa kirim ulang", async () => {
    const s = new OutboxMemori();
    const catat: string[] = [];
    await s.enqueue(buatAmplop("pesanan.dibayar", CONTOH["pesanan.dibayar"]!, { sekarang: T0 }), KODE, T0);
    const r = await jalankanPutaran(s, pengirimDari([{ hasil: "duplikat" }], catat), T0);
    expect(r.duplikat).toBe(1);
    await jalankanPutaran(s, pengirimDari([{ hasil: "terkirim" }], catat), new Date(T0.getTime() + 60_000));
    expect(catat.length).toBe(1);
    expect(s.semua()[0]!.status).toBe("terkirim");
  });

  test("event agregat sama tidak melompati event yang sedang retry", async () => {
    const s = new OutboxMemori();
    const catat: string[] = [];
    const a1 = buatAmplop("pesanan.dibuat", CONTOH["pesanan.dibuat"]!, { sekarang: T0 });
    const a2 = buatAmplop("pesanan.dibayar", CONTOH["pesanan.dibayar"]!, { sekarang: T0 });
    await s.enqueue(a1, KODE, T0);
    await s.enqueue(a2, KODE, T0);
    await jalankanPutaran(s, pengirimDari([{ hasil: "sementara", alasan: "503" }], catat), T0);
    expect(catat).toEqual([`${a1.event_id}|${a1.event_id}`]);
    // belum 30 detik: tidak ada yang dikirim
    await jalankanPutaran(s, pengirimDari([{ hasil: "terkirim" }], catat), new Date(T0.getTime() + 29_000));
    expect(catat.length).toBe(1);
    // 30 detik: a1 dulu, lalu a2 baru putaran berikutnya
    const p = pengirimDari([{ hasil: "terkirim" }], catat);
    await jalankanPutaran(s, p, new Date(T0.getTime() + 30_000));
    await jalankanPutaran(s, p, new Date(T0.getTime() + 30_000));
    expect(catat.map((c) => c.split("|")[0])).toEqual([a1.event_id, a1.event_id, a2.event_id]);
  });

  test("agregat berbeda tidak saling menghalangi", async () => {
    const s = new OutboxMemori();
    const catat: string[] = [];
    const a1 = buatAmplop("pesanan.dibayar", CONTOH["pesanan.dibayar"]!, { sekarang: T0 });
    const a2 = buatAmplop("fee.dicairkan", CONTOH["fee.dicairkan"]!, { sekarang: T0 });
    await s.enqueue(a1, KODE, T0);
    await s.enqueue(a2, "vnd_001", T0);
    await jalankanPutaran(s, pengirimDari([{ hasil: "sementara", alasan: "timeout" }, { hasil: "terkirim" }], catat), T0);
    expect(catat.length).toBe(2);
  });
});

describe("retry 30 detik, maksimal 24 jam, kirim ulang manual", () => {
  test("retry berjeda 30 detik lalu gagal setelah 24 jam", async () => {
    const s = new OutboxMemori();
    const a = buatAmplop("pesanan.dibayar", CONTOH["pesanan.dibayar"]!, { sekarang: T0 });
    await s.enqueue(a, KODE, T0);
    const gagalTerus = pengirimDari([{ hasil: "sementara", alasan: "503" }]);
    await jalankanPutaran(s, gagalTerus, T0);
    expect(s.semua()[0]!.cobaBerikutnya.getTime()).toBe(T0.getTime() + 30_000);
    // loncat ke tepat 24 jam
    const r = await jalankanPutaran(s, gagalTerus, new Date(T0.getTime() + 24 * 3600_000));
    expect(r.gagal).toBe(1);
    expect(s.semua()[0]!.status).toBe("gagal");
    // tidak dikirim lagi otomatis
    const r2 = await jalankanPutaran(s, gagalTerus, new Date(T0.getTime() + 25 * 3600_000));
    expect(r2).toEqual({ terkirim: 0, duplikat: 0, diulang: 0, gagal: 0 });
  });

  test("pengirim melempar galat diperlakukan sementara", async () => {
    const s = new OutboxMemori();
    await s.enqueue(buatAmplop("pesanan.dibayar", CONTOH["pesanan.dibayar"]!, { sekarang: T0 }), KODE, T0);
    const r = await jalankanPutaran(s, { kirim: async () => { throw new Error("ECONNRESET"); } }, T0);
    expect(r.diulang).toBe(1);
    expect(s.semua()[0]!.kesalahanTerakhir).toBe("ECONNRESET");
  });

  test("ditolak tujuan langsung gagal; kirim ulang manual membuka jendela baru", async () => {
    const s = new OutboxMemori();
    const a = buatAmplop("pesanan.dibayar", CONTOH["pesanan.dibayar"]!, { sekarang: T0 });
    await s.enqueue(a, KODE, T0);
    await jalankanPutaran(s, pengirimDari([{ hasil: "ditolak", alasan: "422" }]), T0);
    expect((await s.daftarGagal()).length).toBe(1);
    expect(await s.kirimUlangManual("tidak-ada", T0)).toBe(false);
    const T1 = new Date(T0.getTime() + 3600_000);
    expect(await s.kirimUlangManual(a.event_id, T1)).toBe(true);
    const r = await jalankanPutaran(s, pengirimDari([{ hasil: "terkirim" }]), T1);
    expect(r.terkirim).toBe(1);
    expect(await s.kirimUlangManual(a.event_id, T1)).toBe(false); // sudah terkirim
  });
});
