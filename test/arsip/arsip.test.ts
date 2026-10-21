import { describe, expect, test } from "bun:test";
import { type PesananSelesai, batasArsip, jalankanJobArsip, ledgerMasihWajibSimpan, pilihUntukArsip } from "../../src/arsip/arsip.ts";
import { JADWAL, type KondisiJadwal, type Pekerjaan, jalankanJatuhTempo } from "../../src/jadwal.ts";

const SEKARANG = new Date("2026-10-31T19:00:00.000Z"); // 1 Nov 2026 02:00 WIB

describe("arsip > 2 tahun", () => {
  test("batas tepat 2 tahun; hanya yang lebih tua diarsipkan", () => {
    expect(batasArsip(SEKARANG).toISOString()).toBe("2024-10-31T19:00:00.000Z");
    const data: PesananSelesai[] = [
      { kode_pesanan: "T-2024-000001", selesai_pada: new Date("2024-10-31T18:59:59Z") },
      { kode_pesanan: "T-2024-000002", selesai_pada: new Date("2024-10-31T19:00:00Z") }, // tepat 2 tahun: belum
      { kode_pesanan: "T-2026-000003", selesai_pada: new Date("2026-10-01T00:00:00Z") },
    ];
    expect(pilihUntukArsip(data, SEKARANG).map((x) => x.kode_pesanan)).toEqual(["T-2024-000001"]);
  });

  test("ledger audit wajib disimpan 2 tahun", () => {
    expect(ledgerMasihWajibSimpan(new Date("2025-01-01Z"), SEKARANG)).toBe(true);
    expect(ledgerMasihWajibSimpan(new Date("2024-10-31T18:00:00Z"), SEKARANG)).toBe(false);
  });

  test("job: simpan dulu baru tandai, per batch, berhenti saat habis", async () => {
    const tua = (i: number): PesananSelesai => ({ kode_pesanan: `T-2023-${String(i).padStart(6, "0")}`, selesai_pada: new Date("2023-05-01Z") });
    const antre = [1, 2, 3, 4, 5].map(tua);
    const urutan: string[] = [];
    const sumber = {
      daftarSelesaiSebelum: async (_b: Date, limit: number) => antre.slice(0, limit),
      tandaiDiarsipkan: async (k: readonly string[]) => { urutan.push(`tandai:${k.length}`); antre.splice(0, k.length); },
    };
    const tujuan = { simpan: async (p: readonly PesananSelesai[]) => void urutan.push(`simpan:${p.length}`) };
    const h = await jalankanJobArsip(sumber, tujuan, SEKARANG, 2);
    expect(h.diarsipkan).toBe(5);
    expect(urutan).toEqual(["simpan:2", "tandai:2", "simpan:2", "tandai:2", "simpan:1", "tandai:1"]);
  });

  test("gagal simpan: tidak ada yang ditandai", async () => {
    const tandai: string[][] = [];
    const sumber = {
      daftarSelesaiSebelum: async () => [{ kode_pesanan: "T-2023-000001", selesai_pada: new Date("2023-05-01Z") }],
      tandaiDiarsipkan: async (k: readonly string[]) => void tandai.push([...k]),
    };
    await expect(jalankanJobArsip(sumber, { simpan: async () => { throw new Error("disk penuh"); } }, SEKARANG)).rejects.toThrow("disk penuh");
    expect(tandai.length).toBe(0);
  });
});

describe("jadwal WIB", () => {
  test("rekonsiliasi: Senin 09.00 WIB berikutnya", () => {
    // Rabu 21 Okt -> Senin 26 Okt 09:00 WIB = 02:00Z
    expect(JADWAL.rekonsiliasiSenin(new Date("2026-10-21T05:00:00Z")).toISOString()).toBe("2026-10-26T02:00:00.000Z");
    // tepat Senin 09:00 -> pekan depan
    expect(JADWAL.rekonsiliasiSenin(new Date("2026-10-26T02:00:00Z")).toISOString()).toBe("2026-11-02T02:00:00.000Z");
    // Senin 08:59 WIB -> hari itu
    expect(JADWAL.rekonsiliasiSenin(new Date("2026-10-26T01:59:00Z")).toISOString()).toBe("2026-10-26T02:00:00.000Z");
  });

  test("arsip: tanggal 1 jam 02.00 WIB; harian 01.00 WIB", () => {
    expect(JADWAL.arsipBulanan(new Date("2026-10-21T05:00:00Z")).toISOString()).toBe("2026-10-31T19:00:00.000Z");
    expect(JADWAL.arsipBulanan(new Date("2026-10-31T19:00:00Z")).toISOString()).toBe("2026-11-30T19:00:00.000Z");
    expect(JADWAL.arsipBulanan(new Date("2026-12-15T00:00:00Z")).toISOString()).toBe("2026-12-31T19:00:00.000Z");
    expect(JADWAL.metrikHarian(new Date("2026-10-21T05:00:00Z")).toISOString()).toBe("2026-10-21T18:00:00.000Z");
  });

  test("pelaksana: jalan sekali saat jatuh tempo, catch-up satu kali, galat terisolasi", async () => {
    const jalan: string[] = [];
    const kerja = (nama: string, f: (s: Date) => Date, galat = false): Pekerjaan => ({
      nama,
      berikutnya: f,
      jalankan: async (d) => {
        jalan.push(`${nama}@${d.toISOString()}`);
        if (galat) throw new Error("boom");
      },
    });
    const jobs = [kerja("rekon", JADWAL.rekonsiliasiSenin), kerja("rusak", JADWAL.metrikHarian, true), kerja("arsip", JADWAL.arsipBulanan)];
    const k: KondisiJadwal = { berikutnya: new Map() };
    expect(await jalankanJatuhTempo(jobs, k, new Date("2026-10-21T05:00:00Z"))).toEqual([]); // inisialisasi
    // lompat 3 pekan (proses mati): rekon hanya sekali
    const r = await jalankanJatuhTempo(jobs, k, new Date("2026-11-12T10:00:00Z"));
    expect(r.find((x) => x.nama === "rusak")?.galat).toBe("boom");
    expect(jalan.filter((j) => j.startsWith("rekon")).length).toBe(1);
    expect(jalan.some((j) => j.startsWith("arsip"))).toBe(true);
    // jadwal berikutnya sudah maju melewati sekarang
    expect(k.berikutnya.get("rekon")!.getTime()).toBeGreaterThan(new Date("2026-11-12T10:00:00Z").getTime());
    expect(await jalankanJatuhTempo(jobs, k, new Date("2026-11-12T10:01:00Z"))).toEqual([]);
  });
});
