// ULID (Crockford base32, 26 karakter): 48 bit waktu ms + 80 bit acak, monotonik dalam ms yang sama.
const ALFABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type SumberAcak = (n: number) => Uint8Array;

const acakBawaan: SumberAcak = (n) => crypto.getRandomValues(new Uint8Array(n));

export function kodeWaktu(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > 0xffffffffffff) throw new RangeError("waktu ULID di luar rentang");
  let sisa = ms;
  let hasil = "";
  for (let i = 0; i < 10; i++) {
    hasil = ALFABET[sisa % 32]! + hasil;
    sisa = Math.floor(sisa / 32);
  }
  return hasil;
}

function kodeAcak(bytes: Uint8Array): string {
  // 10 byte -> 16 karakter (80 bit)
  let bit = 0n;
  for (const b of bytes) bit = (bit << 8n) | BigInt(b);
  let hasil = "";
  for (let i = 0; i < 16; i++) {
    hasil = ALFABET[Number(bit & 31n)]! + hasil;
    bit >>= 5n;
  }
  return hasil;
}

export function buatPembuatUlid(acak: SumberAcak = acakBawaan): (ms?: number) => string {
  let waktuTerakhir = -1;
  let acakTerakhir = "";
  return (ms = Date.now()) => {
    if (ms <= waktuTerakhir) {
      // monotonik: naikkan bagian acak sebelumnya
      ms = waktuTerakhir;
      acakTerakhir = naikkan(acakTerakhir);
    } else {
      waktuTerakhir = ms;
      acakTerakhir = kodeAcak(acak(10));
    }
    return kodeWaktu(ms) + acakTerakhir;
  };
}

function naikkan(s: string): string {
  const arr = s.split("");
  for (let i = arr.length - 1; i >= 0; i--) {
    const idx = ALFABET.indexOf(arr[i]!);
    if (idx < 31) {
      arr[i] = ALFABET[idx + 1]!;
      return arr.join("");
    }
    arr[i] = ALFABET[0]!;
  }
  throw new Error("luapan ULID monotonik");
}

export const ulid = buatPembuatUlid();
export const POLA_ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
