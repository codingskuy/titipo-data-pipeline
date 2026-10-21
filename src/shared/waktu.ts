// WIB = UTC+7 tetap (tanpa DST). Semua nilai disimpan/dikembalikan sebagai Date (instan UTC).
export const WIB_MS = 7 * 3600_000;
export const HARI_MS = 24 * 3600_000;

/** Date yang field UTC-nya menunjukkan jam dinding WIB. */
export const keWibGeser = (d: Date): Date => new Date(d.getTime() + WIB_MS);
export const dariWibGeser = (d: Date): Date => new Date(d.getTime() - WIB_MS);

export function tanggalIsoWib(d: Date): string {
  return keWibGeser(d).toISOString().slice(0, 10);
}

/** Awal hari WIB (00:00) untuk instan d. */
export function awalHariWib(d: Date): Date {
  const g = keWibGeser(d);
  return dariWibGeser(new Date(Date.UTC(g.getUTCFullYear(), g.getUTCMonth(), g.getUTCDate())));
}

/** Waktu berikutnya (> sejak) pada jam:menit WIB tertentu, setiap hari. */
export function berikutnyaHarian(sejak: Date, jam: number, menit = 0): Date {
  const g = keWibGeser(sejak);
  let c = Date.UTC(g.getUTCFullYear(), g.getUTCMonth(), g.getUTCDate(), jam, menit);
  if (c <= g.getTime()) c += HARI_MS;
  return dariWibGeser(new Date(c));
}

/** Waktu berikutnya (> sejak) pada hari Senin jam:menit WIB. */
export function berikutnyaSenin(sejak: Date, jam: number, menit = 0): Date {
  const g = keWibGeser(sejak);
  let c = Date.UTC(g.getUTCFullYear(), g.getUTCMonth(), g.getUTCDate(), jam, menit);
  if (c <= g.getTime()) c += HARI_MS;
  while (new Date(c).getUTCDay() !== 1) c += HARI_MS;
  return dariWibGeser(new Date(c));
}

/** Waktu berikutnya (> sejak) pada tanggal 1 tiap bulan jam:menit WIB. */
export function berikutnyaTanggalSatu(sejak: Date, jam: number, menit = 0): Date {
  const g = keWibGeser(sejak);
  let c = Date.UTC(g.getUTCFullYear(), g.getUTCMonth(), 1, jam, menit);
  if (c <= g.getTime()) c = Date.UTC(g.getUTCFullYear(), g.getUTCMonth() + 1, 1, jam, menit);
  return dariWibGeser(new Date(c));
}

export function kurangiTahun(d: Date, tahun: number): Date {
  const x = new Date(d.getTime());
  x.setUTCFullYear(x.getUTCFullYear() - tahun);
  return x;
}
