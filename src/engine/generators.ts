import { CatObj } from "../data/catalog";
import { DEG, Rng, gauss, hashStr, makeNoise, mulberry32, smoothstep } from "../lib/math";

export interface Layer {
  kind: "glow" | "star" | "dust";
  pos: number[];
  col: number[]; // rgba (star: rgb + 絶対等級)
  size: number[];
  sharp: number;
  gain: number;
}
export interface Model {
  layers: Layer[];
  R: number;
  frame: "disc" | "sky";
}

type C3 = [number, number, number];

class Buf {
  pos: number[] = [];
  col: number[] = [];
  size: number[] = [];
  constructor(public kind: Layer["kind"], public sharp = 0, public target = 0.8) {}
  add(x: number, y: number, z: number, r: number, g: number, b: number, a: number, s: number) {
    this.pos.push(x, y, z);
    this.col.push(r, g, b, a);
    this.size.push(s);
  }
  get n() {
    return this.size.length;
  }
  done(R: number): Layer {
    let gain = 1;
    if (this.kind !== "star") {
      let s2 = 0;
      for (const s of this.size) s2 += s * s;
      gain = Math.min(1, Math.max(0.003, (this.target * R * R) / Math.max(s2, 1e-12)));
    }
    return { kind: this.kind, pos: this.pos, col: this.col, size: this.size, sharp: this.sharp, gain };
  }
}

const mix = (a: C3, b: C3, t: number): C3 => {
  t = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
};
const sphereDir = (rnd: Rng): C3 => {
  const z = rnd() * 2 - 1;
  const t = rnd() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return [s * Math.cos(t), s * Math.sin(t), z];
};
const hernquistR = (rnd: Rng, a: number, R: number) => {
  const umax = (R / (R + a)) ** 2;
  const su = Math.sqrt(rnd() * umax);
  return (a * su) / (1 - su);
};
const plummerR = (rnd: Rng, a: number, R: number) => {
  for (let i = 0; i < 20; i++) {
    const u = Math.max(rnd(), 1e-4);
    const r = a / Math.sqrt(Math.pow(u, -2 / 3) - 1);
    if (r <= R) return r;
  }
  return rnd() * R;
};
const N = (n: number, Q: number, min = 30) => Math.max(min, Math.round(n * Q));

const WARM: C3 = [1.0, 0.82, 0.57];
const COOL: C3 = [0.62, 0.76, 1.0];
const HA: C3 = [1.0, 0.24, 0.32];
const OIII: C3 = [0.22, 0.78, 0.82];

// ---------------- 渦巻銀河 ----------------
interface SpiralParams {
  arms: number; pitch: number; bar: boolean; bulge: number; dust: number; smooth: boolean; flocc: boolean;
  hii: number; comp: boolean; phase?: number; r0?: number; barLen?: number; barAngle?: number;
  sizeMul?: number; nDisc?: number; starSize?: number;
}

function genSpiral(R: number, rnd: Rng, Q: number, p: SpiralParams): Layer[] {
  const glow = new Buf("glow", 0, 0.85);
  const stars = new Buf("glow", 1, 0.9);
  const dust = new Buf("dust", 0, 0.35 * Math.min(Math.max(p.dust, 0.2), 3));
  const sm = p.sizeMul ?? 1;
  const arms = p.smooth ? 0 : Math.max(1, p.arms);
  const k = 1 / Math.tan(p.pitch * DEG);
  const armFrac = p.smooth ? 0 : p.flocc ? 0.45 : 0.72;
  const barLen = p.barLen ?? 0.3 * R;
  const r0 = p.r0 ?? (p.bar ? barLen : 0.08 * R);
  const phase = p.phase ?? 0;
  const barAng = p.barAngle ?? 0;
  const h = R * 0.3;
  const sampleR = () => Math.max(-h * Math.log(1 - rnd() * (1 - Math.exp(-R / h))), 0.02 * R);
  const armTheta = (r: number, a: number) => phase + (a * 2 * Math.PI) / arms + k * Math.log(Math.max(r, r0 * 0.2) / r0);
  const armSig = (r: number) => Math.min(0.55, Math.max(0.05, (0.075 * R) / r)) * (p.flocc ? 1.5 : 1);
  const armStart = p.bar ? barLen * 0.9 : 0.05 * R;

  const disc = () => {
    const r = sampleR();
    let inArm = false;
    let th: number;
    if (arms > 0 && r > armStart && rnd() < armFrac) {
      inArm = true;
      th = armTheta(r, Math.floor(rnd() * arms)) + gauss(rnd) * armSig(r);
    } else th = rnd() * Math.PI * 2;
    const z = gauss(rnd) * 0.012 * R * (1 + (0.8 * r) / R);
    return { x: r * Math.cos(th), y: r * Math.sin(th), z, r, inArm };
  };

  const nd = p.nDisc ?? N(26000, Q);
  for (let i = 0; i < nd; i++) {
    const d = disc();
    const t = d.r / R;
    const c = mix(WARM, COOL, t * 1.4 + (d.inArm ? 0.28 : 0) - 0.15);
    glow.add(d.x, d.y, d.z, c[0], c[1], c[2], d.inArm ? 1 : 0.55, R * sm * (0.022 + 0.03 * rnd()));
  }
  // バルジ
  const Rb = R * (0.25 + 0.25 * p.bulge);
  const ab = R * (0.025 + 0.05 * p.bulge);
  const nb = N(9000 * (0.4 + p.bulge), Q);
  for (let i = 0; i < nb; i++) {
    const r = Math.min(hernquistR(rnd, ab, Rb), Rb);
    const d = sphereDir(rnd);
    const c = mix([1, 0.8, 0.52], [1, 0.9, 0.72], r / Rb);
    glow.add(d[0] * r, d[1] * r, d[2] * r * 0.75, c[0], c[1], c[2], 1, R * sm * (0.01 + 0.03 * (r / Rb)));
  }
  // 棒状構造
  if (p.bar) {
    const nbar = N(5000, Q);
    const ca = Math.cos(barAng), sa = Math.sin(barAng);
    for (let i = 0; i < nbar; i++) {
      const x = Math.max(-barLen, Math.min(barLen, gauss(rnd) * 0.45 * barLen));
      const y = gauss(rnd) * 0.06 * R;
      glow.add(x * ca - y * sa, x * sa + y * ca, gauss(rnd) * 0.02 * R, 1, 0.82, 0.55, 0.9, R * sm * 0.03);
    }
  }
  // HII領域
  if (arms > 0) {
    const nh = N(350 * p.hii, Q, 0);
    for (let i = 0; i < nh; i++) {
      const r = R * (0.25 + 0.7 * rnd());
      const th = armTheta(r, Math.floor(rnd() * arms)) + gauss(rnd) * armSig(r) * 0.5;
      const c = mix([1, 0.35, 0.55], [1, 0.7, 0.85], rnd() * 0.6);
      glow.add(r * Math.cos(th), r * Math.sin(th), gauss(rnd) * 0.008 * R, c[0], c[1], c[2], 0.9, R * sm * (0.008 + 0.012 * rnd()));
    }
  }
  // 伴銀河
  if (p.comp) {
    const nc = N(2500, Q);
    for (let i = 0; i < nc; i++) {
      const r = Math.abs(gauss(rnd)) * 0.1 * R;
      const d = sphereDir(rnd);
      glow.add(0.82 * R + d[0] * r, 0.25 * R + d[1] * r, 0.05 * R + d[2] * r * 0.6, 1, 0.85, 0.65, 0.9, R * 0.02);
    }
  }
  // 点状の星
  const ns = N(9000, Q);
  for (let i = 0; i < ns; i++) {
    let x: number, y: number, z: number, blue: boolean;
    if (rnd() < 0.25) {
      const r = Math.min(hernquistR(rnd, ab, Rb), Rb);
      const d = sphereDir(rnd);
      x = d[0] * r; y = d[1] * r; z = d[2] * r * 0.75; blue = false;
    } else {
      const d = disc();
      x = d.x; y = d.y; z = d.z; blue = d.inArm;
    }
    const c = blue ? mix([0.8, 0.88, 1], [1, 1, 1], rnd()) : mix([1, 0.95, 0.8], [1, 0.85, 0.65], rnd());
    stars.add(x, y, z, c[0], c[1], c[2], 0.5 + 0.5 * rnd(), R * sm * (p.starSize ?? 1) * (0.003 + 0.004 * rnd()));
  }
  // ダストレーン
  const ndu = N(4500 * Math.pow(Math.max(p.dust, 0.3), 0.7), Q);
  for (let i = 0; i < ndu; i++) {
    let x: number, y: number;
    if (arms > 0 && rnd() < 0.85) {
      const r = sampleR() * 0.85;
      const th = armTheta(r, Math.floor(rnd() * arms)) - 0.16 + gauss(rnd) * armSig(r) * 0.6;
      x = r * Math.cos(th); y = r * Math.sin(th);
    } else {
      const r = R * ((p.smooth ? 0.3 : 0.15) + (p.smooth ? 0.5 : 0.65) * rnd());
      const th = rnd() * Math.PI * 2;
      x = r * Math.cos(th); y = r * Math.sin(th);
    }
    dust.add(x, y, gauss(rnd) * 0.004 * R, 0.03, 0.015, 0.005, 1, R * sm * (0.03 + 0.035 * rnd()));
  }
  return [glow.done(R), dust.done(R), stars.done(R)];
}

// ---------------- 楕円・レンズ状銀河 ----------------
interface EllParams {
  q: number; disc: boolean; dust: number; jet: number; lobes: boolean; gc: boolean; fil: boolean; seed: number;
}
function genElliptical(R: number, rnd: Rng, Q: number, p: EllParams): Layer[] {
  const glow = new Buf("glow", 0, 0.8);
  const stars = new Buf("glow", 1, 0.9);
  const dust = new Buf("dust", 0, 0.3 * Math.min(Math.max(p.dust, 0.2), 3));
  const a = R * (p.disc ? 0.12 : 0.2);
  const n = N(24000, Q);
  for (let i = 0; i < n; i++) {
    const r = Math.min(hernquistR(rnd, a, R), R);
    const d = sphereDir(rnd);
    const c = mix([1, 0.76, 0.48], [1, 0.88, 0.7], r / R);
    glow.add(d[0] * r, d[1] * r, d[2] * r * p.q, c[0], c[1], c[2], 1, R * (0.01 + 0.045 * Math.pow(r / R, 0.8)));
  }
  const nst = N(3000, Q);
  for (let i = 0; i < nst; i++) {
    const r = Math.min(hernquistR(rnd, a, R), R);
    const d = sphereDir(rnd);
    stars.add(d[0] * r, d[1] * r, d[2] * r * p.q, 1, 0.92, 0.78, 0.4 + 0.6 * rnd(), R * 0.004);
  }
  if (p.disc) {
    const h = 0.3 * R;
    const nd = N(12000, Q);
    for (let i = 0; i < nd; i++) {
      const r = Math.max(-h * Math.log(1 - rnd() * (1 - Math.exp(-R / h))), 0.02 * R);
      const th = rnd() * Math.PI * 2;
      glow.add(r * Math.cos(th), r * Math.sin(th), gauss(rnd) * 0.015 * R, 0.95, 0.82, 0.62, 0.6, R * (0.02 + 0.02 * rnd()));
    }
  }
  if (p.dust > 0) {
    const nd = N(3500 * Math.pow(p.dust, 0.6), Q);
    for (let i = 0; i < nd; i++) {
      const r = R * (0.04 + 0.45 * rnd());
      const th = rnd() * Math.PI * 2;
      dust.add(r * Math.cos(th), r * Math.sin(th), gauss(rnd) * 0.01 * R, 0.04, 0.02, 0.01, 1, R * (0.03 + 0.03 * rnd()));
    }
  }
  if (p.gc) {
    const ng = N(260, Q);
    for (let i = 0; i < ng; i++) {
      const r = Math.min(hernquistR(rnd, 0.6 * R, 1.3 * R), 1.3 * R);
      const d = sphereDir(rnd);
      stars.add(d[0] * r, d[1] * r, d[2] * r, 1, 0.9, 0.7, 0.8, R * 0.004);
    }
  }
  if (p.jet > 0) addJet(glow, stars, R, rnd, Q, p.jet, p.lobes);
  if (p.fil) {
    const nz = makeNoise(p.seed);
    const nf = N(3500, Q);
    let got = 0, tries = 0;
    while (got < nf && tries < nf * 40) {
      tries++;
      const d = sphereDir(rnd);
      const r = R * (0.3 + 1.1 * Math.pow(rnd(), 0.6));
      const v = nz.fbm((d[0] * r) / R * 3, (d[1] * r) / R * 3, (d[2] * r) / R * 3, 3);
      if (Math.abs(v - 0.5) > 0.045) continue;
      got++;
      glow.add(d[0] * r, d[1] * r, d[2] * r, 1, 0.35, 0.35, 0.7, R * (0.012 + 0.02 * rnd()));
    }
  }
  return [glow.done(R), dust.done(R), stars.done(R)];
}

function addJet(glow: Buf, stars: Buf, R: number, rnd: Rng, Q: number, len: number, lobes: boolean) {
  const L = len * R;
  const nj = N(700, Q);
  for (let i = 0; i < nj; i++) {
    const t = Math.pow(rnd(), 1.4) * L;
    const sgn = rnd() < 0.8 ? 1 : -1;
    const w = 0.006 * R + 0.02 * t;
    const al = sgn > 0 ? 0.4 + 0.6 * rnd() : 0.25;
    glow.add(sgn * t, gauss(rnd) * w, gauss(rnd) * w, 0.6, 0.78, 1, al, R * (0.008 + 0.012 * rnd()));
  }
  for (let i = 0; i < 8; i++) {
    const t = ((i + 1) / 9) * L;
    stars.add(t, 0, 0, 0.75, 0.88, 1, 1, R * 0.012);
  }
  if (lobes) {
    for (const sgn of [-1, 1]) {
      const nl = N(3500, Q);
      for (let i = 0; i < nl; i++) {
        const x = sgn * L * (1 + gauss(rnd) * 0.22);
        glow.add(x, gauss(rnd) * 0.4 * R, gauss(rnd) * 0.4 * R, 1, 0.45, 0.25, 0.45, R * (0.04 + 0.05 * rnd()));
      }
      stars.add(sgn * L * 1.3, 0.05 * R, 0, 0.8, 0.95, 1, 1, R * 0.02);
      stars.add(sgn * L * 1.3, 0.05 * R, 0, 0.8, 0.95, 1, 1, R * 0.05);
    }
  }
}

// ---------------- 不規則・矮小銀河 ----------------
function genIrregular(R: number, rnd: Rng, Q: number, bar: boolean, hii: number): Layer[] {
  const glow = new Buf("glow", 0, 0.8);
  const stars = new Buf("glow", 1, 0.9);
  const dust = new Buf("dust", 0, 0.2);
  const K = 7;
  const cx: number[] = [], cy: number[] = [], cz: number[] = [], cs: number[] = [];
  for (let k = 0; k < K; k++) {
    cx.push(gauss(rnd) * 0.38 * R); cy.push(gauss(rnd) * 0.38 * R); cz.push(gauss(rnd) * 0.05 * R);
    cs.push(R * (0.1 + 0.12 * rnd()));
  }
  const pt = () => {
    const k = Math.floor(rnd() * K);
    let x = cx[k] + gauss(rnd) * cs[k], y = cy[k] + gauss(rnd) * cs[k];
    const z = cz[k] + gauss(rnd) * cs[k] * 0.4;
    const r = Math.hypot(x, y);
    if (r > 1.1 * R) { x *= (1.1 * R) / r; y *= (1.1 * R) / r; }
    return [x, y, z];
  };
  const n = N(22000, Q);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = pt();
    const c = mix([0.7, 0.8, 1], [1, 0.9, 0.8], rnd());
    glow.add(x, y, z, c[0], c[1], c[2], 0.8, R * (0.02 + 0.035 * rnd()));
  }
  if (bar) {
    const nb = N(7000, Q);
    const ca = Math.cos(0.5), sa = Math.sin(0.5);
    for (let i = 0; i < nb; i++) {
      const x = gauss(rnd) * 0.28 * R, y = gauss(rnd) * 0.06 * R;
      glow.add(x * ca - y * sa, x * sa + y * ca, gauss(rnd) * 0.03 * R, 1, 0.86, 0.65, 0.9, R * 0.03);
    }
  }
  const nh = N(300 * Math.max(hii, 1), Q);
  for (let i = 0; i < nh; i++) {
    const [x, y, z] = pt();
    const c = mix([1, 0.35, 0.5], [1, 0.75, 0.85], rnd() * 0.7);
    glow.add(x, y, z, c[0], c[1], c[2], 0.9, R * (0.008 + 0.014 * rnd()));
  }
  const ns = N(7000, Q);
  for (let i = 0; i < ns; i++) {
    const [x, y, z] = pt();
    stars.add(x, y, z, 0.85, 0.9, 1, 0.5 + 0.5 * rnd(), R * 0.004);
  }
  for (let i = 0; i < N(1200, Q); i++) {
    const [x, y, z] = pt();
    dust.add(x, y, z, 0.03, 0.015, 0.01, 1, R * (0.03 + 0.03 * rnd()));
  }
  return [glow.done(R), dust.done(R), stars.done(R)];
}

// ---------------- 相互作用銀河・リング銀河・M82 ----------------
function genAntennae(R: number, rnd: Rng, Q: number): Layer[] {
  const glow = new Buf("glow", 0, 0.8);
  const stars = new Buf("glow", 1, 0.9);
  const dust = new Buf("dust", 0, 0.25);
  const centers: C3[] = [[-0.22 * R, -0.05 * R, 0], [0.2 * R, 0.12 * R, 0.02 * R]];
  const Rg = 0.22 * R;
  for (const c of centers) {
    const n = N(9000, Q);
    for (let i = 0; i < n; i++) {
      const r = -0.3 * Rg * Math.log(1 - rnd() * 0.97);
      const th = rnd() * Math.PI * 2;
      const col = mix([1, 0.82, 0.58], [0.65, 0.78, 1], (r / Rg) * 1.3);
      glow.add(c[0] + r * Math.cos(th), c[1] + r * Math.sin(th), c[2] + gauss(rnd) * 0.03 * Rg, col[0], col[1], col[2], 1, R * (0.015 + 0.02 * rnd()));
    }
  }
  const tails: [number, number, C3][] = [[Math.PI, 1.3, centers[0]], [0, 1.3, centers[1]]];
  for (const [phi0, sweep, c] of tails) {
    const n = N(6000, Q);
    for (let i = 0; i < n; i++) {
      const t = rnd();
      const phi = phi0 + sweep * t;
      const rad = (0.12 + 0.75 * t) * R;
      const sg = R * 0.035 * (1 - 0.7 * t);
      glow.add(c[0] + rad * Math.cos(phi) + gauss(rnd) * sg, c[1] + rad * Math.sin(phi) * 0.6 + gauss(rnd) * sg, c[2] + gauss(rnd) * sg * 0.4,
        0.7, 0.8, 1, 0.9 * (1 - 0.6 * t), R * (0.015 + 0.02 * rnd()));
    }
  }
  const nk = N(1500, Q);
  for (let i = 0; i < nk; i++) {
    const c = mix([1, 0.4, 0.6], [1, 0.9, 0.95], rnd() * 0.8);
    glow.add(gauss(rnd) * 0.08 * R, 0.05 * R + gauss(rnd) * 0.08 * R, gauss(rnd) * 0.02 * R, c[0], c[1], c[2], 0.9, R * (0.007 + 0.01 * rnd()));
  }
  for (let i = 0; i < N(800, Q); i++) {
    dust.add(gauss(rnd) * 0.1 * R, 0.04 * R + gauss(rnd) * 0.1 * R, gauss(rnd) * 0.02 * R, 0.03, 0.015, 0.01, 1, R * (0.03 + 0.03 * rnd()));
  }
  for (let i = 0; i < N(6000, Q); i++) {
    const c = centers[i % 2];
    const r = Math.abs(gauss(rnd)) * 0.12 * R;
    const d = sphereDir(rnd);
    stars.add(c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r * 0.3, 1, 0.95, 0.9, 0.5 + 0.5 * rnd(), R * 0.004);
  }
  return [glow.done(R), dust.done(R), stars.done(R)];
}

function genRingGalaxy(R: number, rnd: Rng, Q: number, inner: boolean): Layer[] {
  const glow = new Buf("glow", 0, 0.8);
  const stars = new Buf("glow", 1, 0.9);
  const n = N(16000, Q);
  for (let i = 0; i < n; i++) {
    const r = Math.min(R, Math.max(0.3 * R, R * (0.82 + 0.07 * gauss(rnd))));
    const th = rnd() * Math.PI * 2;
    glow.add(r * Math.cos(th), r * Math.sin(th), gauss(rnd) * 0.02 * R, 0.7, 0.8, 1, 0.8, R * (0.012 + 0.02 * rnd()));
  }
  for (let i = 0; i < N(1500, Q); i++) {
    const r = R * (0.82 + 0.07 * gauss(rnd));
    const th = rnd() * Math.PI * 2;
    glow.add(r * Math.cos(th), r * Math.sin(th), 0, 1, 0.4, 0.6, 0.9, R * (0.008 + 0.01 * rnd()));
  }
  const a = R * (inner ? 0.05 : 0.14);
  for (let i = 0; i < N(6000, Q); i++) {
    const r = Math.min(hernquistR(rnd, a, 0.6 * R), 0.6 * R);
    const d = sphereDir(rnd);
    glow.add(d[0] * r, d[1] * r, d[2] * r * 0.8, 1, 0.8, 0.52, 1, R * (0.01 + 0.03 * (r / R)));
  }
  if (inner) {
    for (let i = 0; i < N(4000, Q); i++) {
      const r = R * (0.4 + 0.04 * gauss(rnd));
      const th = rnd() * Math.PI * 2;
      glow.add(r * Math.cos(th), r * Math.sin(th), gauss(rnd) * 0.02 * R, 1, 0.85, 0.65, 0.6, R * 0.02);
    }
    for (let s = 0; s < 8; s++) {
      const th = (s / 8) * Math.PI * 2;
      for (let i = 0; i < N(350, Q, 10); i++) {
        const r = R * (0.1 + 0.72 * rnd());
        glow.add(r * Math.cos(th) + gauss(rnd) * 0.01 * R, r * Math.sin(th) + gauss(rnd) * 0.01 * R, 0, 0.9, 0.85, 0.8, 0.5, R * 0.012);
      }
    }
  }
  for (let i = 0; i < N(5000, Q); i++) {
    const rr = rnd() < 0.7 ? R * (0.82 + 0.08 * gauss(rnd)) : R * rnd();
    const th = rnd() * Math.PI * 2;
    stars.add(rr * Math.cos(th), rr * Math.sin(th), gauss(rnd) * 0.02 * R, 0.85, 0.9, 1, 0.5 + 0.5 * rnd(), R * 0.004);
  }
  return [glow.done(R), stars.done(R)];
}

function addOutflow(layers: Layer[], R: number, rnd: Rng, Q: number) {
  const g = new Buf("glow", 0, 0.5);
  for (const sgn of [-1, 1]) {
    const n = N(3500, Q);
    for (let i = 0; i < n; i++) {
      const zt = R * (0.05 + 0.85 * rnd());
      const rho = R * (0.04 + 0.28 * Math.pow(zt / R, 0.8)) * (0.8 + 0.4 * rnd());
      const th = rnd() * Math.PI * 2;
      g.add(rho * Math.cos(th), rho * Math.sin(th), sgn * zt, 1, 0.25, 0.3, 0.6 * (1 - 0.6 * (zt / R)), R * (0.015 + 0.02 * rnd()));
    }
  }
  layers.push(g.done(R));
}

// ---------------- 球状星団・散開星団 ----------------
function starColor(M: number, old: boolean): C3 {
  if (!old) {
    if (M < -0.5) return [0.65, 0.78, 1];
    if (M < 1.5) return [0.85, 0.9, 1];
  }
  if (M < 4) return [1, 0.96, 0.88];
  return [1, 0.85, 0.65];
}

function genGlobular(R: number, rnd: Rng, Q: number, n: number): Layer[] {
  const st = new Buf("star");
  const gl = new Buf("glow", 0, 0.45);
  const cnt = N(n, Q, 500);
  for (let i = 0; i < cnt; i++) {
    const r = plummerR(rnd, 0.16 * R, R);
    const d = sphereDir(rnd);
    const u = rnd();
    let M: number, c: C3;
    if (u < 0.02) { M = -2.5 + gauss(rnd) * 0.5; c = [1, 0.62, 0.32]; }
    else if (u < 0.1) { M = 0.6 + gauss(rnd) * 0.3; c = rnd() < 0.5 ? [0.75, 0.85, 1] : [1, 0.95, 0.75]; }
    else if (u < 0.12) { M = 2 + gauss(rnd) * 0.4; c = [0.7, 0.8, 1]; }
    else { M = 2.5 + 3.8 * Math.pow(rnd(), 0.8); c = mix([1, 0.92, 0.75], [1, 0.8, 0.55], (M - 2.5) / 4); }
    st.add(d[0] * r, d[1] * r, d[2] * r, c[0], c[1], c[2], M, 0);
  }
  for (let i = 0; i < N(1800, Q); i++) {
    const r = plummerR(rnd, 0.18 * R, R);
    const d = sphereDir(rnd);
    gl.add(d[0] * r, d[1] * r, d[2] * r, 1, 0.9, 0.72, 1, R * (0.04 + 0.06 * rnd()));
  }
  return [gl.done(R), st.done(R)];
}

function genOpen(R: number, rnd: Rng, Q: number, n: number, old: boolean): Layer[] {
  const st = new Buf("star");
  const gl = new Buf("glow", 0, 0.25);
  const cnt = N(n, Q, 40);
  for (let i = 0; i < cnt; i++) {
    const r = plummerR(rnd, 0.35 * R, 1.2 * R);
    const d = sphereDir(rnd);
    const u = rnd();
    let M: number, c: C3;
    if (u < 0.05) { M = -0.5 + gauss(rnd) * 0.5; c = [1, 0.65, 0.35]; }
    else {
      M = old ? 0.5 + 6 * Math.pow(rnd(), 0.9) : -3 + 9 * Math.pow(rnd(), 1.4);
      c = starColor(M, old);
    }
    st.add(d[0] * r, d[1] * r, d[2] * r, c[0], c[1], c[2], M, 0);
  }
  for (let i = 0; i < N(120, Q, 20); i++) {
    const r = plummerR(rnd, 0.3 * R, R);
    const d = sphereDir(rnd);
    gl.add(d[0] * r, d[1] * r, d[2] * r, old ? 1 : 0.8, old ? 0.9 : 0.88, old ? 0.75 : 1, 1, R * (0.12 + 0.12 * rnd()));
  }
  return [gl.done(R), st.done(R)];
}

// ---------------- 散光・反射星雲 ----------------
interface NebParams { refl: boolean; hollow: boolean; cl: boolean; trap: boolean; seed: number; }
function genNebula(R: number, rnd: Rng, Q: number, p: NebParams): Layer[] {
  const nz = makeNoise(p.seed);
  const glow = new Buf("glow", 0, p.refl ? 0.55 : 0.8);
  const dust = new Buf("dust", 0, 0.3);
  const st = new Buf("star");
  const target = N(p.refl ? 8000 : 13000, Q);
  let got = 0, tries = 0;
  while (got < target && tries < target * 60) {
    tries++;
    const x = rnd() * 2 - 1, y = rnd() * 2 - 1, z = rnd() * 2 - 1;
    const r = Math.sqrt(x * x + y * y + z * z);
    if (r > 1) continue;
    const dens = nz.fbm(x * 2.2 + 3.1, y * 2.2, z * 2.2, 5);
    let pr = smoothstep(0.38, 0.72, dens) * (1 - Math.pow(r, 1.5));
    if (p.hollow) pr *= smoothstep(0.25, 0.55, r);
    if (rnd() > pr) continue;
    got++;
    const n2 = nz.fbm(x * 3.1 + 9.2, y * 3.1 + 1.3, z * 3.1, 3);
    let c: C3;
    if (p.refl) c = mix([0.45, 0.6, 1], [0.7, 0.8, 1], n2);
    else c = mix(HA, OIII, smoothstep(0.52, 0.72, n2));
    if (!p.refl && pr > 0.55) c = mix(c, [1, 0.75, 0.8], (pr - 0.55) * 0.8);
    glow.add(x * R, y * R, z * R * 0.7, c[0], c[1], c[2], 0.35 + 0.65 * pr, R * (0.035 + 0.07 * (1 - pr) * rnd() + 0.02 * rnd()));
  }
  // ダスト
  tries = 0; got = 0;
  const nd = N(2600, Q);
  while (got < nd && tries < nd * 60) {
    tries++;
    const x = rnd() * 2 - 1, y = rnd() * 2 - 1, z = (rnd() * 2 - 1) * 0.5;
    const r = Math.sqrt(x * x + y * y + z * z);
    if (r > 1) continue;
    const v = nz.fbm(x * 2.8 + 20, y * 2.8 + 7, z * 2.8, 4);
    if (rnd() > smoothstep(0.55, 0.8, v)) continue;
    got++;
    dust.add(x * R, y * R, z * R, 0.03, 0.015, 0.01, 1, R * (0.05 + 0.06 * rnd()));
  }
  // 励起星
  const ns = p.refl ? N(12, Q, 3) : p.cl ? N(220, Q, 40) : N(40, Q, 12);
  for (let i = 0; i < ns; i++) {
    const r = plummerR(rnd, 0.22 * R, R);
    const d = sphereDir(rnd);
    const M = p.refl ? -3 + 3 * rnd() : -5.5 + 6 * Math.pow(rnd(), 0.7);
    const c = mix([0.6, 0.75, 1], [1, 1, 1], rnd());
    st.add(d[0] * r, d[1] * r, d[2] * r * 0.7, c[0], c[1], c[2], M, 0);
  }
  if (p.trap) {
    for (let i = 0; i < 4; i++) st.add(gauss(rnd) * 0.03 * R, gauss(rnd) * 0.03 * R, gauss(rnd) * 0.03 * R, 0.8, 0.9, 1, -5.5 - rnd(), 0);
  }
  return [glow.done(R), dust.done(R), st.done(R)];
}

function genDark(R: number, rnd: Rng, Q: number, seed: number, bg: boolean): Layer[] {
  const nz = makeNoise(seed);
  const dust = new Buf("dust", 0, 0.45);
  const glow = new Buf("glow", 0, 0.4);
  const target = N(4500, Q);
  let got = 0, tries = 0;
  while (got < target && tries < target * 60) {
    tries++;
    const x = rnd() * 2 - 1, y = rnd() * 2 - 1, z = (rnd() * 2 - 1) * 0.5;
    const r = Math.sqrt(x * x + y * y + z * z);
    if (r > 1) continue;
    const v = nz.fbm(x * 2.0 + 5, y * 2.0, z * 2, 4);
    if (rnd() > smoothstep(0.42, 0.7, v) * (1 - r * r)) continue;
    got++;
    dust.add(x * R, y * R, z * R, 0.02, 0.01, 0.008, 1, R * (0.06 + 0.07 * rnd()));
  }
  if (bg) {
    for (let i = 0; i < N(3500, Q); i++) {
      const x = gauss(rnd) * 1.1 * R, y = gauss(rnd) * 0.8 * R + 0.2 * R;
      glow.add(x, y, -0.6 * R, 1, 0.2, 0.25, 0.5, R * (0.1 + 0.12 * rnd()));
    }
  }
  return [glow.done(R), dust.done(R)];
}

// ---------------- 惑星状星雲 ----------------
function genPlanetary(R: number, rnd: Rng, Q: number, shape: string, seed: number): Layer[] {
  const nz = makeNoise(seed);
  const glow = new Buf("glow", 0, 0.8);
  const col = (rr: number): C3 => mix([0.3, 0.92, 0.85], [1, 0.3, 0.32], smoothstep(0.35, 0.95, rr));
  const n = N(14000, Q);
  if (shape === "ring") {
    let got = 0, tries = 0;
    while (got < n && tries < n * 30) {
      tries++;
      const th = rnd() * Math.PI * 2, ph = rnd() * Math.PI * 2;
      const Rm = 0.62 * R, rm = 0.26 * R * Math.sqrt(rnd());
      const x = (Rm + rm * Math.cos(ph)) * Math.cos(th), y = (Rm + rm * Math.cos(ph)) * Math.sin(th), z = rm * Math.sin(ph) * 0.8;
      const v = nz.fbm(x / R * 4, y / R * 4, z / R * 4, 3);
      if (v < 0.32 + 0.1 * rnd()) continue;
      got++;
      const c = col(Math.hypot(x, y) / R * 1.1);
      glow.add(x, y, z, c[0], c[1], c[2], 0.9, R * (0.02 + 0.03 * rnd()));
    }
    for (let i = 0; i < N(3000, Q); i++) {
      const d = sphereDir(rnd);
      const r = R * 0.5 * Math.cbrt(rnd());
      glow.add(d[0] * r, d[1] * r, d[2] * r * 0.5, 0.3, 0.8, 0.9, 0.25, R * 0.05);
    }
    for (let i = 0; i < N(2500, Q); i++) {
      const d = sphereDir(rnd);
      const r = R * (0.95 + 0.4 * rnd());
      glow.add(d[0] * r, d[1] * r, d[2] * r * 0.8, 1, 0.3, 0.3, 0.22, R * 0.06);
    }
  } else if (shape === "bipolar") {
    let got = 0, tries = 0;
    while (got < n && tries < n * 30) {
      tries++;
      const sgn = rnd() < 0.5 ? -1 : 1;
      const d = sphereDir(rnd);
      const shellT = rnd() < 0.75 ? 1 : 0.4 + 0.6 * rnd();
      const x = sgn * 0.42 * R + 0.5 * R * d[0] * shellT, y = 0.38 * R * d[1] * shellT, z = 0.38 * R * d[2] * shellT;
      const v = nz.fbm(x / R * 4 + 2, y / R * 4, z / R * 4, 3);
      if (v < 0.36 + 0.08 * rnd()) continue;
      got++;
      const c = col(Math.hypot(x, y, z) / R * 1.1);
      glow.add(x, y, z, c[0], c[1], c[2], 0.9, R * (0.02 + 0.03 * rnd()));
    }
  } else {
    let got = 0, tries = 0;
    while (got < n && tries < n * 30) {
      tries++;
      const d = sphereDir(rnd);
      const r = R * (0.55 + 0.4 * Math.pow(rnd(), 0.7));
      const v = nz.fbm(d[0] * 3 + 4, d[1] * 3, d[2] * 3, 4);
      if (v < 0.4 + 0.1 * rnd()) continue;
      got++;
      const c = col(r / R);
      glow.add(d[0] * r, d[1] * r, d[2] * r, c[0], c[1], c[2], 0.9, R * (0.02 + 0.03 * rnd()));
    }
    for (let i = 0; i < N(3000, Q); i++) {
      const d = sphereDir(rnd);
      const r = R * (0.95 + 0.45 * rnd());
      glow.add(d[0] * r, d[1] * r, d[2] * r, 1, 0.3, 0.3, 0.22, R * 0.06);
    }
  }
  // 中心星（高温の白色矮星）
  glow.add(0, 0, 0, 0.85, 0.92, 1, 1, R * 0.03);
  glow.add(0, 0, 0, 0.85, 0.92, 1, 0.6, R * 0.08);
  return [glow.done(R)];
}

// ---------------- 超新星残骸 ----------------
function genSNR(R: number, rnd: Rng, Q: number, seed: number, vol: boolean, arc: boolean): Layer[] {
  const nz = makeNoise(seed);
  const glow = new Buf("glow", 0, 0.7);
  const stars = new Buf("glow", 1, 0.9);
  const target = N(16000, Q);
  let got = 0, tries = 0;
  while (got < target && tries < target * 50) {
    tries++;
    const d = sphereDir(rnd);
    if (arc && !(d[0] > 0.55 && Math.abs(d[2]) < 0.6)) continue;
    const r = vol ? R * Math.cbrt(rnd()) * 0.95 : R * (0.82 + 0.18 * rnd());
    const v = nz.fbm((d[0] * r) / R * 3, (d[1] * r) / R * 3, (d[2] * r) / R * 3, 4);
    if (Math.abs(v - 0.5) > (vol ? 0.06 : 0.07)) continue;
    got++;
    const n2 = nz.fbm((d[0] * r) / R * 2 + 8, (d[1] * r) / R * 2, (d[2] * r) / R * 2, 3);
    const c = mix([1, 0.4, 0.28], [0.35, 0.85, 1], smoothstep(0.45, 0.65, n2));
    glow.add(d[0] * r, d[1] * r, d[2] * r, c[0], c[1], c[2], 0.5 + 0.4 * rnd(), R * (0.012 + 0.02 * rnd()));
  }
  if (vol) {
    for (let i = 0; i < N(2500, Q); i++) {
      const d = sphereDir(rnd);
      const r = Math.abs(gauss(rnd)) * 0.3 * R;
      glow.add(d[0] * r, d[1] * r, d[2] * r * 0.8, 0.5, 0.62, 1, 0.3, R * 0.08);
    }
    stars.add(0, 0, 0, 0.8, 0.9, 1, 1, R * 0.015);
  }
  return [glow.done(R), stars.done(R)];
}

// ---------------- 恒星雲 ----------------
function genStarCloud(R: number, rnd: Rng, Q: number, seed: number): Layer[] {
  const nz = makeNoise(seed);
  const st = new Buf("star");
  const gl = new Buf("glow", 0, 0.5);
  const dust = new Buf("dust", 0, 0.4);
  for (let i = 0; i < N(18000, Q); i++) {
    const r = plummerR(rnd, 0.45 * R, R);
    const d = sphereDir(rnd);
    const M = 0 + 6 * Math.pow(rnd(), 0.8);
    const c = starColor(M, false);
    st.add(d[0] * r, d[1] * r, d[2] * r * 0.5, c[0], c[1], c[2], M, 0);
  }
  for (let i = 0; i < N(2500, Q); i++) {
    const r = plummerR(rnd, 0.45 * R, R);
    const d = sphereDir(rnd);
    gl.add(d[0] * r, d[1] * r, d[2] * r * 0.5, 1, 0.95, 0.85, 1, R * (0.05 + 0.05 * rnd()));
  }
  let got = 0, tries = 0;
  const nd = N(2000, Q);
  while (got < nd && tries < nd * 60) {
    tries++;
    const x = rnd() * 2 - 1, y = rnd() * 2 - 1, z = (rnd() * 2 - 1) * 0.5;
    if (x * x + y * y + z * z > 1) continue;
    if (rnd() > smoothstep(0.5, 0.75, nz.fbm(x * 3, y * 3, z * 3, 4))) continue;
    got++;
    dust.add(x * R, y * R, z * R, 0.03, 0.015, 0.01, 1, R * (0.04 + 0.05 * rnd()));
  }
  return [gl.done(R), dust.done(R), st.done(R)];
}

// ---------------- クエーサー・ブラックホール ----------------
function genQuasar(R: number, rnd: Rng, Q: number, jet: number, lobes: boolean): Layer[] {
  const glow = new Buf("glow", 0, 0.8);
  const stars = new Buf("glow", 1, 0.9);
  for (let i = 0; i < N(7000, Q); i++) {
    const r = Math.min(hernquistR(rnd, 0.18 * R, R), R);
    const d = sphereDir(rnd);
    glow.add(d[0] * r, d[1] * r, d[2] * r * 0.7, 1, 0.88, 0.7, 0.35, R * (0.02 + 0.05 * (r / R)));
  }
  const sizes = [0.01, 0.02, 0.04, 0.08, 0.16, 0.26];
  for (const s of sizes) glow.add(0, 0, 0, 0.8, 0.88, 1, 1, R * s);
  stars.add(0, 0, 0, 1, 1, 1, 1, R * 0.006);
  if (jet > 0) addJet(glow, stars, R, rnd, Q, jet, lobes);
  else if (lobes) addJet(glow, stars, R, rnd, Q, 3, true);
  return [glow.done(R), stars.done(R)];
}

function genBlackHole(R: number, rnd: Rng, Q: number): Layer[] {
  const glow = new Buf("glow", 0, 0.9);
  for (let i = 0; i < N(9000, Q); i++) {
    const r = R * (0.12 + 0.5 * Math.pow(rnd(), 1.6));
    const th = rnd() * Math.PI * 2;
    const c = mix([0.85, 0.92, 1], [1, 0.45, 0.15], (r / R - 0.1) * 2.2);
    glow.add(r * Math.cos(th), r * Math.sin(th), gauss(rnd) * 0.01 * R * (r / R) * 4, c[0], c[1], c[2], 0.5 + 0.5 * (1 - r / R), R * (0.012 + 0.02 * rnd()));
  }
  for (let i = 0; i < N(1200, Q); i++) {
    const th = rnd() * Math.PI * 2;
    const r = R * 0.115 * (1 + 0.05 * gauss(rnd));
    glow.add(r * Math.cos(th), r * Math.sin(th), 0, 1, 0.9, 0.7, 0.9, R * 0.008);
  }
  return [glow.done(R)];
}

// ---------------- 遠方初期銀河 ----------------
function genHighZ(R: number, rnd: Rng, Q: number): Layer[] {
  const glow = new Buf("glow", 0, 0.9);
  const stars = new Buf("glow", 1, 0.9);
  const K = 3 + Math.floor(rnd() * 3);
  const cx: number[] = [], cy: number[] = [], cz: number[] = [];
  for (let k = 0; k < K; k++) { cx.push(gauss(rnd) * 0.35 * R); cy.push(gauss(rnd) * 0.35 * R); cz.push(gauss(rnd) * 0.15 * R); }
  for (let i = 0; i < N(2600, Q); i++) {
    const k = Math.floor(rnd() * K);
    const s = R * 0.18;
    const c = rnd() < 0.15 ? ([1, 0.6, 0.8] as C3) : mix([0.7, 0.82, 1], [0.9, 0.93, 1], rnd());
    glow.add(cx[k] + gauss(rnd) * s, cy[k] + gauss(rnd) * s, cz[k] + gauss(rnd) * s * 0.7, c[0], c[1], c[2], 0.9, R * (0.04 + 0.08 * rnd()));
  }
  for (let i = 0; i < N(600, Q); i++) {
    const k = Math.floor(rnd() * K);
    stars.add(cx[k] + gauss(rnd) * R * 0.2, cy[k] + gauss(rnd) * R * 0.2, cz[k] + gauss(rnd) * R * 0.1, 0.85, 0.92, 1, 0.8, R * 0.012);
  }
  return [glow.done(R), stars.done(R)];
}

// ---------------- 銀河団 ----------------
function genGalCluster(R: number, rnd: Rng, Q: number, lens: boolean, few: number): Layer[] {
  const glow = new Buf("glow", 0, 0.8);
  const cores = new Buf("glow", 1, 0.9);
  const icl = new Buf("glow", 0, 0.12);
  const ng = few > 0 ? few : N(110, Q, 40);
  for (let i = 0; i < ng; i++) {
    let x: number, y: number, z: number;
    if (few > 0) {
      x = gauss(rnd) * 0.35 * R; y = gauss(rnd) * 0.35 * R; z = gauss(rnd) * 0.2 * R;
    } else {
      const r = plummerR(rnd, 0.3 * R, 1.1 * R);
      const d = sphereDir(rnd);
      x = d[0] * r; y = d[1] * r; z = d[2] * r;
    }
    const spiral = rnd() < (few > 0 ? 0.7 : 0.25);
    const c: C3 = spiral ? mix([0.7, 0.82, 1], [0.9, 0.9, 0.95], rnd()) : mix([1, 0.8, 0.55], [1, 0.9, 0.72], rnd());
    const rg = R * (few > 0 ? 0.08 + 0.06 * rnd() : 0.012 + 0.03 * Math.pow(rnd(), 2));
    glow.add(x, y, z, c[0], c[1], c[2], 1, rg);
    cores.add(x, y, z, 1, 0.95, 0.85, 0.9, rg * 0.35);
  }
  if (few === 0) {
    for (const s of [0.06, 0.035, 0.02]) glow.add(0, 0, 0, 1, 0.82, 0.58, 1, R * s);
    for (let i = 0; i < N(600, Q); i++) {
      const r = plummerR(rnd, 0.35 * R, 1.2 * R);
      const d = sphereDir(rnd);
      icl.add(d[0] * r, d[1] * r, d[2] * r, 1, 0.9, 0.7, 1, R * 0.25);
    }
  }
  if (lens) {
    for (let a = 0; a < 10; a++) {
      const rho = R * (0.12 + 0.22 * rnd());
      const a0 = rnd() * Math.PI * 2;
      const span = 0.25 + 0.55 * rnd();
      const c: C3 = rnd() < 0.7 ? [0.6, 0.75, 1] : [1, 0.6, 0.55];
      for (let i = 0; i < N(70, Q, 10); i++) {
        const th = a0 + span * rnd();
        cores.add(rho * Math.cos(th) + gauss(rnd) * 0.004 * R, rho * Math.sin(th) + gauss(rnd) * 0.004 * R, 0, c[0], c[1], c[2], 0.9, R * (0.004 + 0.003 * rnd()));
      }
    }
  }
  return [icl.done(R), glow.done(R), cores.done(R)];
}

// ---------------- 天の川銀河 ----------------
export function genMilkyWay(Q: number): Model {
  const rnd = mulberry32(777);
  const R = 50000;
  const layers = genSpiral(R, rnd, Q, {
    arms: 4, pitch: 12, bar: true, bulge: 0.9, dust: 2.2, smooth: false, flocc: false, hii: 3, comp: false,
    phase: Math.PI, r0: 32400, barLen: 14000, barAngle: -27 * DEG, sizeMul: 0.55, nDisc: N(90000, Q), starSize: 0.25,
  });
  return { layers, R, frame: "disc" };
}

// 太陽近傍の恒星（銀河座標系: x=銀河中心方向, z=銀河北極）。原点は太陽
export function genLocalStars(Q: number): Layer {
  const rnd = mulberry32(4242);
  const st = new Buf("star");
  const n = N(26000, Q, 3000);
  for (let i = 0; i < n; i++) {
    const rho = -900 * Math.log(Math.max(1e-6, 1 - rnd() * 0.999));
    const th = rnd() * Math.PI * 2;
    const z = (rnd() < 0.5 ? -1 : 1) * -290 * Math.log(Math.max(1e-6, rnd()));
    const M = -3 + 11 * Math.pow(rnd(), 0.55);
    const c: C3 = M < 0 ? mix([0.62, 0.76, 1], [0.9, 0.93, 1], (M + 3) / 3) : M < 4 ? mix([0.95, 0.95, 1], [1, 0.9, 0.72], M / 4) : mix([1, 0.85, 0.65], [1, 0.6, 0.4], (M - 4) / 7);
    st.add(rho * Math.cos(th), rho * Math.sin(th), z, c[0], c[1], c[2], M, 0);
  }
  return st.done(1);
}

// ---------------- ディスパッチ ----------------
export function generate(o: CatObj, Q: number): Model | null {
  const R = o.radius;
  const seed = hashStr(o.id);
  const rnd = mulberry32(seed);
  const t = o.tags;
  const num = (k: string, d: number) => (t[k] !== undefined ? parseFloat(t[k]) : d);
  const has = (k: string) => t[k] !== undefined;
  const seedN = (seed % 1000) + 1;

  switch (o.type) {
    case "SA":
    case "SB":
      return {
        R, frame: "disc",
        layers: genSpiral(R, rnd, Q, {
          arms: has("flocc") ? 5 : num("arms", 2), pitch: num("pitch", 18), bar: o.type === "SB" || has("bar"),
          bulge: num("bulge", 0.35), dust: num("dust", 1), smooth: has("smooth"), flocc: has("flocc"),
          hii: num("hii", 1), comp: has("comp"),
        }),
      };
    case "EL":
    case "S0":
      return {
        R, frame: "disc",
        layers: genElliptical(R, rnd, Q, {
          q: o.type === "S0" ? 0.7 : 0.6, disc: o.type === "S0", dust: num("dust", 0), jet: num("jet", 0),
          lobes: has("lobes"), gc: has("gc"), fil: has("fil"), seed: seedN,
        }),
      };
    case "IR":
      return { R, frame: "disc", layers: genIrregular(R, rnd, Q, has("bar"), num("hii", 1)) };
    case "PE": {
      if (has("outflow")) {
        const layers = genSpiral(R, rnd, Q, { arms: 2, pitch: 15, bar: false, bulge: 0.6, dust: 2.5, smooth: true, flocc: false, hii: 3, comp: false });
        addOutflow(layers, R, rnd, Q);
        return { R, frame: "disc", layers };
      }
      if (has("ring")) return { R, frame: "disc", layers: genRingGalaxy(R, rnd, Q, has("inner")) };
      return { R, frame: "disc", layers: genAntennae(R, rnd, Q) };
    }
    case "GC":
      return { R, frame: "sky", layers: genGlobular(R, rnd, Q, has("big") ? 80000 : 26000) };
    case "OC":
      return {
        R, frame: "sky",
        layers: [
          ...genOpen(R, rnd, Q, num("n", 450), has("old")),
          ...(has("refl") ? genNebula(R * 1.6, rnd, Q, { refl: true, hollow: false, cl: false, trap: false, seed: seedN }) : []),
        ],
      };
    case "EM":
      if (has("shell")) return { R, frame: "sky", layers: genSNR(R, rnd, Q, seedN, false, false) };
      return { R, frame: "sky", layers: genNebula(R, rnd, Q, { refl: false, hollow: has("hollow"), cl: has("cl"), trap: has("trap"), seed: seedN }) };
    case "RF":
      return { R, frame: "sky", layers: genNebula(R, rnd, Q, { refl: true, hollow: false, cl: false, trap: false, seed: seedN }) };
    case "PN":
      return { R, frame: "sky", layers: genPlanetary(R, rnd, Q, has("ring") ? "ring" : has("bipolar") ? "bipolar" : "shell", seedN) };
    case "SN":
      return { R, frame: "sky", layers: genSNR(R, rnd, Q, seedN, has("vol"), has("arc")) };
    case "DK":
      return { R, frame: "sky", layers: genDark(R, rnd, Q, seedN, has("bg")) };
    case "SC":
      return { R, frame: "sky", layers: genStarCloud(R, rnd, Q, seedN) };
    case "QS":
      return { R, frame: "disc", layers: genQuasar(R, rnd, Q, num("jet", 0), has("lobes")) };
    case "BH":
      return { R, frame: "disc", layers: genBlackHole(R, rnd, Q) };
    case "HZ":
      return { R, frame: "sky", layers: genHighZ(R, rnd, Q) };
    case "CL":
      return { R, frame: "sky", layers: genGalCluster(R, rnd, Q, has("lens"), num("few", 0)) };
    case "MW":
      return genMilkyWay(Q);
    default:
      return null;
  }
}
