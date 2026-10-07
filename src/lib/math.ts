// 乱数・ノイズ・宇宙論・座標変換ユーティリティ
export const DEG = Math.PI / 180;
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function gauss(r: Rng): number {
  let u = 0;
  while (u === 0) u = r();
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function makeNoise(seed: number) {
  const hash = (x: number, y: number, z: number) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(seed | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  };
  const sm = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number, z: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = sm(x - xi), v = sm(y - yi), w = sm(z - zi);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    const c000 = hash(xi, yi, zi), c100 = hash(xi + 1, yi, zi);
    const c010 = hash(xi, yi + 1, zi), c110 = hash(xi + 1, yi + 1, zi);
    const c001 = hash(xi, yi, zi + 1), c101 = hash(xi + 1, yi, zi + 1);
    const c011 = hash(xi, yi + 1, zi + 1), c111 = hash(xi + 1, yi + 1, zi + 1);
    return l(l(l(c000, c100, u), l(c010, c110, u), v), l(l(c001, c101, u), l(c011, c111, u), v), w);
  };
  const fbm = (x: number, y: number, z: number, oct = 4) => {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * noise(x * f, y * f, z * f);
      n += a;
      a *= 0.5;
      f *= 2.03;
    }
    return s / n;
  };
  return { noise, fbm };
}

// 平坦ΛCDM (Planck 2018近似) による look-back time [Gyr]
export function lookbackGyr(z: number): number {
  const H0 = 67.7, Om = 0.31, OL = 0.69;
  const tH = 977.8 / H0;
  const f = (x: number) => 1 / ((1 + x) * Math.sqrt(Om * Math.pow(1 + x, 3) + OL));
  const N = 600;
  const h = z / N;
  let s = f(0) + f(z);
  for (let i = 1; i < N; i++) s += (i % 2 ? 4 : 2) * f(i * h);
  return (tH * s * h) / 3;
}

export const AGE_UNIVERSE_GYR = 13.8;

// 赤道座標(X,Y,Z) -> three.js座標 (x=X, y=Z, z=-Y)  右手系を保つ
export function eq2three(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

export function radecToVec(raH: number, decD: number): [number, number, number] {
  const a = raH * 15 * DEG, d = decD * DEG;
  return eq2three(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
}

// 天の北(N)・東(E)の接ベクトル (three座標)
export function tangents(raH: number, decD: number) {
  const a = raH * 15 * DEG, d = decD * DEG;
  const E = eq2three(-Math.sin(a), Math.cos(a), 0);
  const N = eq2three(-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d));
  return { E, N };
}

export function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function fmtDistance(ly: number): string {
  if (ly < 0.0001) return `${(ly * 63241).toFixed(1)} AU`;
  if (ly < 0.1) return `${(ly * 63241).toFixed(0)} AU`;
  if (ly < 10) return `${ly.toFixed(2)} 光年`;
  if (ly < 10000) return `${Math.round(ly).toLocaleString()} 光年`;
  if (ly < 1e8) return `${(ly / 1e4).toLocaleString(undefined, { maximumFractionDigits: ly < 1e6 ? 1 : 0 })} 万光年`;
  return `${(ly / 1e8).toLocaleString(undefined, { maximumFractionDigits: 2 })} 億光年`;
}

export function fmtYears(y: number): string {
  if (y < 1) return `${(y * 365.25).toFixed(1)} 日`;
  if (y < 10000) return `${Math.round(y).toLocaleString()} 年`;
  if (y < 1e8) return `${(y / 1e4).toLocaleString(undefined, { maximumFractionDigits: y < 1e6 ? 1 : 0 })} 万年`;
  return `${(y / 1e8).toLocaleString(undefined, { maximumFractionDigits: 2 })} 億年`;
}
