import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POLA_EVENT_ID, PengalokasiMemori, buatAmplopTiteny, tanggalWib } from "../../src/titeny/amplop.ts";
import { DlqBerkas, DlqMemori, type HasilTransport, type TransportTiteny, buatTransportHttp, teruskan } from "../../src/titeny/forwarder.ts";
import { BATAS_GROSIR_GRAM_BAWAAN, petakanBiayaLogistik, petakanTransaksi, petakanVendorStatus, type SumberTransaksi } from "../../src/titeny/peta.ts";
import { REGISTRY_TITENY } from "../../src/titeny/registry.ts";

const WAKTU = new Date("2026-10-04T01:12:00.000Z"); // 08:12 WIB
const TERIMA = new Date("2026-10-04T01:12:41.000Z");

function opsi(p = new PengalokasiMemori()) {
  return { receivedAt: TERIMA, pengalokasi: p };
}
const trx = (berat_gram: number, id = "trx_20261004_881201"): SumberTransaksi => ({
  transaksi_id: id,
  komoditas_id: "cmd_telur_ayam",
  berat_gram,
  harga_satuan_rupiah_per_kg: 28500,
  vendor_id: "vnd_keliling_014",
  zona_rute: "bekasi_utara",
  waktu: WAKTU,
});

describe("amplop Titeny", () => {
  test("semua bidang wajib ada dan format event_id benar", () => {
    const a = petakanTransaksi(trx(2000), opsi());
    expect(a.event_id).toMatch(POLA_EVENT_ID);
    expect(a.event_id).toBe("evt_20261004_000001");
    expect(a.schema_version).toBe(1);
    expect(a.source).toBe("titipo");
    expect(a.occurred_at).toBe("2026-10-04T01:12:00.000Z");
    expect(a.received_at).toBe("2026-10-04T01:12:41.000Z");
    expect(a.batch_id).toBe("batch_titipo_20261004_realtime");
    expect(a.event_type).toBe("transaksi.dibuat");
  });

  test("tanggal event_id memakai tanggal WIB (lewat tengah malam UTC)", () => {
    expect(tanggalWib(new Date("2026-10-04T18:00:00Z"))).toBe("20261005");
  });

  test("event_id stabil untuk sumber yang sama (retry/kirim ulang tidak ganda), urut naik untuk beda", () => {
    const p = new PengalokasiMemori();
    const a1 = petakanTransaksi(trx(2000, "trx_a"), opsi(p));
    const a1lagi = petakanTransaksi(trx(2000, "trx_a"), opsi(p));
    const a2 = petakanTransaksi(trx(2000, "trx_b"), opsi(p));
    expect(a1lagi.event_id).toBe(a1.event_id);
    expect(a2.event_id).toBe("evt_20261004_000002");
  });

  test("hanya 3 event TitipO; event lain (termasuk pedaree.stok.v1) ditolak", () => {
    const p = new PengalokasiMemori();
    const dasar = { kunciSumber: "x", occurredAt: WAKTU, receivedAt: TERIMA, pengalokasi: p };
    // @ts-expect-error jenis di luar yang boleh dikirim TitipO
    expect(() => buatAmplopTiteny("harga.diperbarui", {}, dasar)).toThrow(/event_type_tidak_dikenal/);
    // @ts-expect-error bilateral, bukan registry Titeny
    expect(() => buatAmplopTiteny("pedaree.stok.v1", {}, dasar)).toThrow(/event_type_tidak_dikenal/);
    expect(REGISTRY_TITENY.length).toBe(11);
  });
});

describe("flag grosir > 50 kg", () => {
  test("batas bawaan 50 kg; tepat 50 kg bukan grosir, di atasnya grosir", () => {
    expect(BATAS_GROSIR_GRAM_BAWAAN).toBe(50_000);
    expect(petakanTransaksi(trx(49_999), opsi()).payload.grosir).toBe(false);
    expect(petakanTransaksi(trx(50_000, "b"), opsi()).payload.grosir).toBe(false);
    expect(petakanTransaksi(trx(50_001, "c"), opsi()).payload.grosir).toBe(true);
  });

  test("batas konfigurabel (mis. 20 kg sesuai FSD) tanpa ubah kode", () => {
    expect(petakanTransaksi(trx(20_001), opsi(), 20_000).payload.grosir).toBe(true);
    expect(petakanTransaksi(trx(20_000, "d"), opsi(), 20_000).payload.grosir).toBe(false);
  });

  test("payload transaksi.dibuat sesuai skema Titeny (qty_kg dari gram, tanpa PII)", () => {
    const a = petakanTransaksi(trx(2000), opsi());
    expect(a.payload).toEqual({
      transaksi_id: "trx_20261004_881201",
      komoditas_id: "cmd_telur_ayam",
      qty_kg: 2,
      harga_satuan: 28500,
      vendor_id: "vnd_keliling_014",
      zona_rute: "bekasi_utara",
      waktu: "2026-10-04T01:12:00.000Z",
      grosir: false,
    });
  });

  test("berat bukan integer positif ditolak", () => {
    expect(() => petakanTransaksi(trx(0), opsi())).toThrow(/berat_gram/);
    expect(() => petakanTransaksi(trx(1500.5), opsi())).toThrow(/berat_gram/);
  });
});

describe("pemetaan episodik", () => {
  test("vendor.status_berubah: status_aktif dari StatusVendor", () => {
    const dasar = { vendor_id: "vnd_1", jenis: "rumahan", zona_operasi: "bekasi_utara", kapasitas_harian_kg: 120, terjadi_pada: WAKTU };
    expect(petakanVendorStatus({ ...dasar, status: "prioritas" }, opsi()).payload.status_aktif).toBe(true);
    expect(petakanVendorStatus({ ...dasar, status: "skors", terjadi_pada: new Date(WAKTU.getTime() + 1) }, opsi()).payload.status_aktif).toBe(false);
  });

  test("logistik.biaya_diperbarui terpetakan dengan kunci rute+berlaku_mulai", () => {
    const p = new PengalokasiMemori();
    const s = { rute_id: "rte_1", jarak_km: 3.5, biaya_per_kg: 900, moda: "motor", berlaku_mulai: "2026-10-05", sebab: "penyesuaian_bbm", terjadi_pada: WAKTU };
    const a = petakanBiayaLogistik(s, opsi(p));
    expect(a.event_type).toBe("logistik.biaya_diperbarui");
    expect(petakanBiayaLogistik(s, opsi(p)).event_id).toBe(a.event_id);
    expect(() => petakanBiayaLogistik({ ...s, berlaku_mulai: "05-10-2026" }, opsi(p))).toThrow(/berlaku_mulai/);
  });
});

function transportDari(urutan: HasilTransport[], panggilan: string[] = []): TransportTiteny {
  let i = 0;
  return {
    async kirim(a) {
      panggilan.push(a.event_id);
      return urutan[Math.min(i++, urutan.length - 1)]!;
    },
  };
}

describe("retry 5/30/300 lalu DLQ", () => {
  const a = petakanTransaksi(trx(2000), opsi());

  test("sukses langsung: tanpa tidur dan tanpa DLQ", async () => {
    const dlq = new DlqMemori();
    const jeda: number[] = [];
    expect(await teruskan(a, transportDari([{ hasil: "terkirim" }]), dlq, { tidur: async (ms) => void jeda.push(ms) })).toBe("terkirim");
    expect(jeda).toEqual([]);
    expect(dlq.isi.length).toBe(0);
  });

  test("gagal terus: 4 percobaan dengan jeda 5/30/300 detik lalu DLQ", async () => {
    const dlq = new DlqMemori();
    const jeda: number[] = [];
    const pg: string[] = [];
    const h = await teruskan(a, transportDari([{ hasil: "sementara", alasan: "HTTP 503" }], pg), dlq, { tidur: async (ms) => void jeda.push(ms), sekarang: () => TERIMA });
    expect(h).toBe("dlq");
    expect(pg.length).toBe(4);
    expect(jeda).toEqual([5000, 30000, 300000]);
    expect(dlq.isi[0]).toMatchObject({ alasan: "HTTP 503", percobaan: 4, masuk_dlq_pada: TERIMA.toISOString() });
    expect(dlq.isi[0]!.amplop.event_id).toBe(a.event_id);
  });

  test("berhasil pada retry ke-2", async () => {
    const dlq = new DlqMemori();
    const jeda: number[] = [];
    const h = await teruskan(a, transportDari([{ hasil: "sementara", alasan: "timeout" }, { hasil: "sementara", alasan: "timeout" }, { hasil: "terkirim" }]), dlq, { tidur: async (ms) => void jeda.push(ms) });
    expect(h).toBe("terkirim");
    expect(jeda).toEqual([5000, 30000]);
    expect(dlq.isi.length).toBe(0);
  });

  test("duplikat diabaikan tujuan dihitung selesai tanpa DLQ", async () => {
    const dlq = new DlqMemori();
    expect(await teruskan(a, transportDari([{ hasil: "duplikat" }]), dlq, { tidur: async () => {} })).toBe("duplikat");
    expect(dlq.isi.length).toBe(0);
  });

  test("422 langsung DLQ tanpa retry", async () => {
    const dlq = new DlqMemori();
    const pg: string[] = [];
    expect(await teruskan(a, transportDari([{ hasil: "ditolak", alasan: "payload_tidak_valid" }], pg), dlq, { tidur: async () => {} })).toBe("dlq");
    expect(pg.length).toBe(1);
    expect(dlq.isi[0]!.alasan).toContain("ditolak");
  });

  test("transport melempar galat diperlakukan sementara", async () => {
    const dlq = new DlqMemori();
    const t: TransportTiteny = { kirim: async () => { throw new Error("ECONNRESET"); } };
    expect(await teruskan(a, t, dlq, { tidur: async () => {} })).toBe("dlq");
    expect(dlq.isi[0]!.alasan).toBe("ECONNRESET");
  });

  test("DLQ berkas menulis NDJSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dlq-"));
    const jalur = join(dir, "sub", "titeny.ndjson");
    await teruskan(a, transportDari([{ hasil: "sementara", alasan: "x" }]), new DlqBerkas(jalur), { tidur: async () => {} });
    const baris = (await readFile(jalur, "utf8")).trim().split("\n");
    expect(baris.length).toBe(1);
    expect(JSON.parse(baris[0]!).amplop.event_id).toBe(a.event_id);
  });
});

describe("transport HTTP", () => {
  const a = petakanTransaksi(trx(2000), opsi());
  const buat = (res: () => Response | Promise<Response>, panggil: { url?: string; init?: RequestInit }[] = []) =>
    buatTransportHttp({
      baseUrl: "https://titeny.test/",
      kunciLayanan: "rahasia",
      fetchFn: (async (url: string, init: RequestInit) => {
        panggil.push({ url, init });
        return res();
      }) as unknown as typeof fetch,
    });

  test("POST /api/v1/event/masuk dengan X-Idempotency-Key = event_id dan amplop lengkap", async () => {
    const p: { url?: string; init?: RequestInit }[] = [];
    const h = await buat(() => Response.json({ status: "diterima" }), p).kirim(a);
    expect(h).toEqual({ hasil: "terkirim" });
    expect(p[0]!.url).toBe("https://titeny.test/api/v1/event/masuk");
    const hd = p[0]!.init!.headers as Record<string, string>;
    expect(hd["x-idempotency-key"]).toBe(a.event_id);
    expect(p[0]!.init!.method).toBe("POST");
    expect(JSON.parse(p[0]!.init!.body as string)).toEqual(JSON.parse(JSON.stringify(a)));
  });

  test("200 duplikat_diabaikan, 422 ditolak, 5xx/429 sementara, jaringan sementara", async () => {
    expect(await buat(() => Response.json({ status: "duplikat_diabaikan" })).kirim(a)).toEqual({ hasil: "duplikat" });
    expect((await buat(() => Response.json({ status: "ditolak", alasan: "x" }, { status: 422 })).kirim(a)).hasil).toBe("ditolak");
    expect(await buat(() => new Response("", { status: 503 })).kirim(a)).toEqual({ hasil: "sementara", alasan: "HTTP 503" });
    expect(await buat(() => new Response("", { status: 429 })).kirim(a)).toEqual({ hasil: "sementara", alasan: "HTTP 429" });
    expect((await buat(() => { throw new Error("jaringan putus"); }).kirim(a)).hasil).toBe("sementara");
  });
});
