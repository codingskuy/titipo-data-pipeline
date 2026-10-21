import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buatCsvBeritaAcara, jalankanJobRekon, namaBerkasRekon, selCsv } from "../../src/rekon/csv.ts";
import { type BarisLedgerPokok, hitungRekonsiliasi, periodeMingguLalu } from "../../src/rekon/rekonsiliasi.ts";

// Senin 2026-10-26 09:00 WIB
const SENIN = new Date("2026-10-26T02:00:00.000Z");
const P = periodeMingguLalu(SENIN);
const dalam = new Date("2026-10-21T03:00:00.000Z");

const baris = (kode: string, pokok: number, susut: number, selesai = dalam, vendor = "vnd_1"): BarisLedgerPokok => ({
  kode_pesanan: kode,
  id_vendor: vendor,
  selesai_pada: selesai,
  pokok_rupiah: pokok,
  susut_rupiah: susut,
});

describe("periode minggu lalu", () => {
  test("Senin 09.00 WIB -> Senin-Minggu sebelumnya", () => {
    expect(P.labelMulai).toBe("2026-10-19");
    expect(P.labelAkhir).toBe("2026-10-25");
    expect(P.mulai.toISOString()).toBe("2026-10-18T17:00:00.000Z");
    expect(P.akhir.toISOString()).toBe("2026-10-25T17:00:00.000Z");
  });
  test("jalan di hari lain dalam minggu yang sama memberi periode sama", () => {
    expect(periodeMingguLalu(new Date("2026-10-28T10:00:00Z")).labelMulai).toBe("2026-10-19");
    expect(periodeMingguLalu(new Date("2026-10-25T16:59:00Z")).labelMulai).toBe("2026-10-12"); // Minggu 23:59 WIB
  });
});

describe("selisih susut > 2% dibagi 50:50 maks Rp200.000", () => {
  test("susut <= 2% tidak ada selisih", () => {
    const h = hitungRekonsiliasi(P, [baris("T-2026-000001", 10_000_000, 200_000)]);
    expect(h).toMatchObject({ selisihSusutRupiah: 0, dibagiRupiah: 0, bagianLumbungRupiah: 0, bagianTitipoRupiah: 0, kelebihanDitanggungTitipoRupiah: 0, transferTunggalRupiah: 10_000_000 });
  });

  test("selisih tepat di batas Rp200.000 dibagi 100.000 : 100.000", () => {
    const h = hitungRekonsiliasi(P, [baris("T-2026-000001", 10_000_000, 400_000)]);
    expect(h).toMatchObject({ selisihSusutRupiah: 200_000, dibagiRupiah: 200_000, bagianLumbungRupiah: 100_000, bagianTitipoRupiah: 100_000, kelebihanDitanggungTitipoRupiah: 0 });
    expect(h.susutPersen).toBe(4);
  });

  test("selisih di atas batas: kelebihan ditanggung TitipO", () => {
    const h = hitungRekonsiliasi(P, [baris("T-2026-000001", 10_000_000, 1_000_000)]);
    expect(h).toMatchObject({ selisihSusutRupiah: 800_000, dibagiRupiah: 200_000, kelebihanDitanggungTitipoRupiah: 600_000 });
  });

  test("pembulatan rupiah ganjil: sisa 1 rupiah ke TitipO", () => {
    const h = hitungRekonsiliasi(P, [baris("T-2026-000001", 1_000_000, 20_001)]);
    expect(h).toMatchObject({ selisihSusutRupiah: 1, bagianLumbungRupiah: 0, bagianTitipoRupiah: 1 });
  });

  test("agregasi banyak baris, transfer tunggal, nol baris", () => {
    const h = hitungRekonsiliasi(P, [baris("T-2026-000001", 6_000_000, 100_000), baris("T-2026-000002", 4_000_000, 300_000)]);
    expect(h.jumlahPesanan).toBe(2);
    expect(h.totalPokokRupiah).toBe(10_000_000);
    expect(h.transferTunggalRupiah).toBe(10_000_000 - h.bagianLumbungRupiah);
    const kosong = hitungRekonsiliasi(P, []);
    expect(kosong).toMatchObject({ jumlahPesanan: 0, totalPokokRupiah: 0, transferTunggalRupiah: 0, susutPersen: 0 });
  });

  test("ambang dan batas konfigurabel; baris di luar periode atau non-integer ditolak", () => {
    const h = hitungRekonsiliasi(P, [baris("T-2026-000001", 10_000_000, 400_000)], { ambangSusutPersen: 3, batasBagiMingguanRupiah: 50_000 });
    expect(h).toMatchObject({ selisihSusutRupiah: 100_000, dibagiRupiah: 50_000, kelebihanDitanggungTitipoRupiah: 50_000 });
    expect(() => hitungRekonsiliasi(P, [baris("T-2026-000009", 1, 0, P.akhir)])).toThrow(/di_luar_periode/);
    expect(() => hitungRekonsiliasi(P, [baris("T-2026-000009", 10.5, 0)])).toThrow(/pokok_rupiah/);
  });
});

describe("CSV berita acara", () => {
  test("escape CSV dan netralisasi rumus", () => {
    expect(selCsv('a,"b"')).toBe('"a,""b"""');
    expect(selCsv("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(selCsv(42)).toBe("42");
    expect(selCsv(-5)).toBe("-5");
  });

  test("isi deterministik: header, baris terurut, ringkasan", () => {
    const l = [baris("T-2026-000002", 4_000_000, 300_000), baris("T-2026-000001", 6_000_000, 100_000)];
    const csv = buatCsvBeritaAcara(hitungRekonsiliasi(P, l), l);
    const baris_ = csv.split("\r\n");
    expect(baris_[0]).toBe("jenis_baris,kunci,id_vendor,tanggal_selesai_wib,pokok_rupiah,susut_rupiah,nilai");
    expect(baris_[1]).toBe("pesanan,T-2026-000001,vnd_1,2026-10-21,6000000,100000,");
    expect(baris_[2]).toBe("pesanan,T-2026-000002,vnd_1,2026-10-21,4000000,300000,");
    expect(csv).toContain("ringkasan,periode_mulai,,,,,2026-10-19\r\n");
    expect(csv).toContain("ringkasan,transfer_tunggal_rupiah,,,,,");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  test("job Senin: tulis berkas, jalan ulang tidak menimpa (idempoten)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rekon-"));
    let dipanggil: [Date, Date] | null = null;
    const pembaca = { bacaPokokSelesai: async (m: Date, a: Date) => { dipanggil = [m, a]; return [baris("T-2026-000001", 6_000_000, 100_000)]; } };
    const r1 = await jalankanJobRekon(pembaca, dir, SENIN);
    expect(r1.status).toBe("ditulis");
    expect(dipanggil![0].toISOString()).toBe(P.mulai.toISOString());
    expect(dipanggil![1].toISOString()).toBe(P.akhir.toISOString());
    expect(r1.jalur).toBe(join(dir, "rekonsiliasi-pokok-lumbung_2026-10-19_2026-10-25.csv"));
    expect(namaBerkasRekon(r1.hasil)).toBe("rekonsiliasi-pokok-lumbung_2026-10-19_2026-10-25.csv");
    const isi = await readFile(r1.jalur, "utf8");
    const r2 = await jalankanJobRekon(pembaca, dir, new Date(SENIN.getTime() + 3600_000));
    expect(r2.status).toBe("sudah_ada");
    expect(await readFile(r2.jalur, "utf8")).toBe(isi);
  });
});
