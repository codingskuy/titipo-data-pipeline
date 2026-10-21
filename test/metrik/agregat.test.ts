import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BarisPesananMetrik, SinkMetrikBerkas, SinkMetrikMemori, hitungMetrikHarian, jalankanJobMetrikHarian, jendelaBaca } from "../../src/metrik/agregat.ts";

const HARI = new Date("2026-10-21T05:00:00.000Z"); // 12:00 WIB, 2026-10-21
const jam = (h: number, m = 0, hariOffset = 0) => new Date(Date.UTC(2026, 9, 21 + hariOffset, h, m)); // jam UTC

let n = 0;
const p = (o: Partial<BarisPesananMetrik> & { id_rumah_tangga: string }): BarisPesananMetrik => ({
  kode_pesanan: `T-2026-${String(++n).padStart(6, "0")}`,
  status: "selesai",
  dibuat_pada: jam(0, 0, -1),
  dikonfirmasi_pada: null,
  diserahkan_pada: null,
  janji_serah_pada: null,
  ...o,
});

describe("repeat 28 hari", () => {
  test("contoh dokumen: 84 dari 200 rumah tangga ulang = 42%", () => {
    const data: BarisPesananMetrik[] = [];
    for (let i = 0; i < 200; i++) {
      const ulang = i < 84;
      data.push(p({ id_rumah_tangga: `rt_${i}`, diserahkan_pada: jam(1, 0, -3) }));
      if (ulang) data.push(p({ id_rumah_tangga: `rt_${i}`, diserahkan_pada: jam(1, 0, -10) }));
    }
    const m = hitungMetrikHarian(HARI, data);
    expect(m.repeat_28h).toEqual({ pembilang: 84, penyebut: 200, nilai: 0.42 });
  });

  test("pesanan di luar 28 hari atau bukan selesai tidak dihitung; tanpa data -> null", () => {
    const m = hitungMetrikHarian(HARI, [
      p({ id_rumah_tangga: "a", diserahkan_pada: jam(1, 0, -3) }),
      p({ id_rumah_tangga: "a", diserahkan_pada: jam(1, 0, -29) }), // di luar jendela
      p({ id_rumah_tangga: "b", status: "dibatalkan_vendor", diserahkan_pada: jam(1, 0, -2) }),
    ]);
    expect(m.repeat_28h).toEqual({ pembilang: 0, penyebut: 1, nilai: 0 });
    expect(hitungMetrikHarian(HARI, []).repeat_28h.nilai).toBeNull();
  });
});

describe("tepat serah, batal vendor, median konfirmasi", () => {
  test("tepat serah +-15 menit (batas inklusif) pada hari berjalan saja", () => {
    const janji = jam(23, 0, -1); // 06:00 WIB 21 Okt
    const mk = (menitGeser: number, rt: string) => p({ id_rumah_tangga: rt, janji_serah_pada: janji, diserahkan_pada: new Date(janji.getTime() + menitGeser * 60_000) });
    const m = hitungMetrikHarian(HARI, [mk(15, "a"), mk(-15, "b"), mk(16, "c"), mk(0, "d")]);
    expect(m.tepat_serah).toEqual({ pembilang: 3, penyebut: 4, nilai: 0.75 });
  });

  test("batal vendor = dibatalkan_vendor / pesanan dibuat hari ini", () => {
    const hariIni = (st: BarisPesananMetrik["status"], rt: string) => p({ id_rumah_tangga: rt, status: st, dibuat_pada: jam(2) });
    const m = hitungMetrikHarian(HARI, [hariIni("dibatalkan_vendor", "a"), hariIni("selesai", "b"), hariIni("selesai", "c"), hariIni("lainnya", "d"), p({ id_rumah_tangga: "e", status: "dibatalkan_vendor", dibuat_pada: jam(2, 0, -1) })]);
    expect(m.batal_vendor).toEqual({ pembilang: 1, penyebut: 4, nilai: 0.25 });
  });

  test("median konfirmasi: ganjil, genap, kosong", () => {
    const k = (menit: number, rt: string) => p({ id_rumah_tangga: rt, dibuat_pada: jam(2), dikonfirmasi_pada: new Date(jam(2).getTime() + menit * 60_000) });
    expect(hitungMetrikHarian(HARI, [k(5, "a"), k(30, "b"), k(13, "c")]).median_konfirmasi_menit).toEqual({ nilai: 13, jumlah_sampel: 3 });
    expect(hitungMetrikHarian(HARI, [k(10, "a"), k(15, "b")]).median_konfirmasi_menit).toEqual({ nilai: 12.5, jumlah_sampel: 2 });
    expect(hitungMetrikHarian(HARI, []).median_konfirmasi_menit).toEqual({ nilai: null, jumlah_sampel: 0 });
  });

  test("tanggal dan batas hari memakai WIB", () => {
    expect(hitungMetrikHarian(new Date("2026-10-20T18:00:00Z"), []).tanggal).toBe("2026-10-21");
    const w = jendelaBaca(HARI);
    expect(w.akhir.toISOString()).toBe("2026-10-21T17:00:00.000Z");
    expect(w.mulai.toISOString()).toBe("2026-09-23T17:00:00.000Z");
  });
});

describe("sink dan job", () => {
  test("job menulis agregat; sink berkas idempoten (tulis ulang menimpa)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "metrik-"));
    const pembaca = { bacaPesanan: async () => [p({ id_rumah_tangga: "a", diserahkan_pada: jam(1, 0, -3) })] };
    const sink = new SinkMetrikBerkas(dir);
    const m = await jalankanJobMetrikHarian(pembaca, sink, HARI);
    await jalankanJobMetrikHarian(pembaca, sink, HARI);
    const isi = JSON.parse(await readFile(join(dir, "2026-10-21.json"), "utf8"));
    expect(isi).toEqual(JSON.parse(JSON.stringify(m)));
    const mem = new SinkMetrikMemori();
    await jalankanJobMetrikHarian(pembaca, mem, HARI);
    expect(mem.data.size).toBe(1);
  });
});
