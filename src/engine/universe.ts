import * as THREE from "three";
import { CATALOG, CAT_BY_ID, CatObj, TYPE_LABEL, TypeCode } from "../data/catalog";
import { generate, genLocalStars, Layer, Model } from "./generators";
import { GlobalUniforms, makeGlowMaterial, makeImageMaterial, makeImpostorMaterial, makeStarMaterial } from "./shaders";
import { radecToVec, smoothstep, tangents } from "../lib/math";

const RMAX = 1e5; // これ以上遠い天体は角サイズを保ったまま RMAX に投影（フローティングオリジン）

export function labelOf(c: CatObj): string {
  const mc = c.group === "M" || c.group === "C";
  if (c.name) return mc ? `${c.id} ${c.name}` : c.name;
  return mc ? `${c.id} ${TYPE_LABEL[c.type]}` : c.id;
}

// ---------------- Wikipedia 実画像取得 ----------------
interface ImgRes { tex: THREE.Texture; aspect: number }
const imgCache = new Map<string, Promise<ImgRes | null>>();
let active = 0;
const waiters: (() => void)[] = [];
async function acquire() {
  if (active < 3) { active++; return; }
  await new Promise<void>((r) => waiters.push(r));
  active++;
}
function release() {
  active--;
  const w = waiters.shift();
  if (w) w();
}
function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("img"));
    im.src = url;
  });
}
function wikiTexture(title: string): Promise<ImgRes | null> {
  let p = imgCache.get(title);
  if (p) return p;
  p = (async () => {
    await acquire();
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=1000&titles=${encodeURIComponent(title)}`;
      const r = await fetch(url);
      const j = await r.json();
      const pages = j?.query?.pages;
      if (!pages) return null;
      let src: string | undefined;
      for (const k of Object.keys(pages)) src = pages[k]?.thumbnail?.source;
      if (!src || /\.svg/i.test(src)) return null;
      const im = await loadImg(src);
      const aspect = im.width / im.height;
      if (aspect > 3 || aspect < 1 / 3) return null;
      // 背景が暗い天体写真のみ採用（チャート・図版を除外）
      try {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 48;
        const cx = cv.getContext("2d")!;
        cx.drawImage(im, 0, 0, 48, 48);
        const d = cx.getImageData(0, 0, 48, 48).data;
        let sb = 0, nb = 0, sa = 0;
        for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
          const i = (y * 48 + x) * 4;
          const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
          sa += l;
          if (x < 2 || y < 2 || x > 45 || y > 45) { sb += l; nb++; }
        }
        if (sb / nb > 0.2 || sa / 2304 > 0.5) return null;
      } catch {
        return null;
      }
      const tex = new THREE.Texture(im);
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      return { tex, aspect };
    } catch {
      return null;
    } finally {
      release();
    }
  })();
  imgCache.set(title, p);
  return p;
}

// ---------------- 型 ----------------
interface Detail {
  group: THREE.Group;
  orient: THREE.Group;
  opacity: { value: number };
  imgOpacity: { value: number };
  view: { value: number };
  thin: boolean;
  layers: THREE.Points[];
  mats: THREE.Material[];
  geoms: THREE.BufferGeometry[];
  img?: THREE.Mesh;
  imgReady: boolean;
  imgRadius: number;
  disposed: boolean;
  lastUsed: number;
}
interface Obj {
  c: CatObj;
  p: THREE.Vector3;
  u: THREE.Vector3;
  N: THREE.Vector3;
  E: THREE.Vector3;
  m: THREE.Vector3;
  axis: THREE.Vector3;
  impType: number;
  q: number;
  col: [number, number, number];
  bright: number;
  stop: number;
  d: number;
  prPx: number;
  score: number;
  sx: number;
  sy: number;
  onScreen: boolean;
  dir: THREE.Vector3;
  detail?: Detail;
  detailAlpha: number;
}

export interface HudState {
  speed: number;
  auto: boolean;
  logSpeed: number;
  autoMul: number;
  context: string;
  sunDist: number;
  nearestName: string;
  nearestEdge: number;
  warping: boolean;
  warpName: string;
  warpRemain: number;
  selId: string | null;
  selDist: number;
  fps: number;
  cruise: boolean;
}

export interface UniverseOptions {
  container: HTMLElement;
  mode: "pc" | "mobile";
  quality: number;
  onHud: (h: HudState) => void;
  onSelect: (o: CatObj | null) => void;
}

const IMP_TYPE: Record<TypeCode, number> = {
  SA: 0, SB: 0, PE: 0, MW: 0, EL: 1, S0: 1, GC: 2, OC: 3, EM: 3, RF: 3, PN: 3, SN: 3, DK: 3, SC: 3, IR: 3, CL: 3,
  ST: 4, BH: 4, QS: 5, HZ: 6,
};
const IMP_Q: Partial<Record<TypeCode, number>> = { SA: 0.12, SB: 0.12, PE: 0.14, MW: 0.04, S0: 0.25, EL: 0.55, IR: 0.4, QS: 0.5 };
const IMP_BRIGHT: Record<TypeCode, number> = {
  SA: 0.85, SB: 0.85, EL: 0.85, S0: 0.85, IR: 0.7, PE: 0.85, GC: 0.9, OC: 0.75, EM: 0.8, RF: 0.6, PN: 0.95, SN: 0.7,
  DK: 0, SC: 0.6, ST: 1, QS: 1, HZ: 0.75, CL: 0.8, BH: 0.9, MW: 0.5,
};
const IMP_COL: Partial<Record<TypeCode, [number, number, number]>> = {
  SA: [0.92, 0.9, 0.85], SB: [0.92, 0.9, 0.85], PE: [0.9, 0.9, 0.9], MW: [0.92, 0.9, 0.85], EL: [1, 0.85, 0.65], S0: [1, 0.85, 0.68],
  IR: [0.8, 0.87, 1], GC: [1, 0.92, 0.75], OC: [0.75, 0.85, 1], EM: [1, 0.4, 0.5], RF: [0.5, 0.65, 1], PN: [0.4, 1, 0.85],
  SN: [1, 0.55, 0.5], SC: [1, 0.95, 0.85], QS: [0.8, 0.88, 1], HZ: [0.78, 0.86, 1], CL: [1, 0.85, 0.65], BH: [1, 0.7, 0.4],
};
const THIN_TYPES = new Set<TypeCode>(["SA", "SB", "PE", "S0", "MW"]);
const IMG_TYPES = new Set<TypeCode>(["SA", "SB", "EL", "S0", "IR", "PE", "GC", "OC", "EM", "RF", "PN", "SN", "DK", "SC"]);
const IMG_K: Partial<Record<TypeCode, number>> = { SA: 1.7, SB: 1.7, EL: 1.6, S0: 1.7, IR: 1.6, PE: 1.7, GC: 2.2, OC: 2.2, EM: 1.5, RF: 1.6, PN: 2.2, SN: 1.5, DK: 1.5, SC: 1.5 };

const V = THREE.Vector3;
const home = new THREE.Vector3(0.035, 0.012, 0.03);

export class Universe {
  private o: UniverseOptions;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private g: GlobalUniforms;
  private objs: Obj[] = [];
  private byId = new Map<string, Obj>();
  private impGeom!: THREE.InstancedBufferGeometry;
  private impPos!: Float32Array;
  private impPar!: Float32Array;
  private impAxis!: Float32Array;
  private impCol!: Float32Array;
  private localGroup = new THREE.Group();
  private localMat?: THREE.ShaderMaterial;
  private localOpacity = { value: 1 };
  private mwQuat = new THREE.Quaternion();
  private labelCv: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private raf = 0;
  private last = performance.now();
  private hudT = 0;
  private frameNo = 0;
  private fpsAcc = 0;
  private fpsCnt = 0;
  private fps = 60;
  private W = 1;
  private H = 1;
  private dpr = 1;
  private Q: number;
  private fov = 65;

  camPos = new THREE.Vector3().copy(home);
  private vel = new THREE.Vector3();
  private keys: Record<string, boolean> = {};
  private joy = { x: 0, z: 0 };
  private vert = 0;
  private rollIn = 0;
  private boostOn = false;
  private cruise = false;
  private labels = true;
  private auto = true;
  private logSpeed = 3;
  private autoMul = 1;
  private nearestEdge = 1;
  private nearestName = "";
  private speedNow = 0;
  private warp: Obj | null = null;
  private selected: Obj | null = null;
  private building = 0;
  private maxPx = 80;
  private disposed = false;
  private ptr: { id: number; x: number; y: number; t: number; moved: number } | null = null;
  private cleanup: (() => void)[] = [];

  constructor(opts: UniverseOptions) {
    this.o = opts;
    this.Q = opts.quality;
    const cont = opts.container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.dpr = Math.min(window.devicePixelRatio || 1, opts.mode === "mobile" ? 1.5 : 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setClearColor(0x000003, 1);
    const cv = this.renderer.domElement;
    cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;touch-action:none;display:block";
    cont.appendChild(cv);
    this.labelCv = document.createElement("canvas");
    this.labelCv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    cont.appendChild(this.labelCv);
    this.lctx = this.labelCv.getContext("2d")!;

    const gl = this.renderer.getContext();
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array;
    this.maxPx = Math.max(16, Math.min(90, range[1] / 2 - 1));

    this.g = {
      uPx: { value: 1000 }, uExp: { value: 1 }, uMaxPx: { value: this.maxPx },
      uViewport: { value: new THREE.Vector2(1, 1) },
    };
    this.camera = new THREE.PerspectiveCamera(this.fov, 1, 1e-4, 1e7);

    this.initObjects();
    this.initImpostors();
    this.initLocalStars();
    this.resize();
    const mw = this.byId.get("MW");
    if (mw) mw.detail = this.buildDetail(mw) ?? undefined;
    this.camera.up.set(0, 1, 0);
    const gcv = radecToVec(17.761, -28.936);
    this.camera.lookAt(gcv[0], gcv[1], gcv[2]);

    this.bindEvents();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------------- 初期化 ----------------
  private initObjects() {
    const ngp = radecToVec(192.859 / 15, 27.128);
    const gc = radecToVec(266.405 / 15, -28.936);
    {
      const z = new V(ngp[0], ngp[1], ngp[2]);
      const x = new V(gc[0], gc[1], gc[2]);
      x.addScaledVector(z, -x.dot(z)).normalize();
      const y = new V().crossVectors(z, x);
      this.mwQuat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    }
    for (const c of CATALOG) {
      const p = new V(c.pos[0], c.pos[1], c.pos[2]);
      const len = p.length();
      const u = len > 0 ? p.clone().divideScalar(len) : new V(1, 0, 0);
      const tg = tangents(c.ra, c.dec);
      const N = new V(tg.N[0], tg.N[1], tg.N[2]);
      const E = new V(tg.E[0], tg.E[1], tg.E[2]);
      const pa = c.pa * (Math.PI / 180);
      const m = N.clone().multiplyScalar(Math.cos(pa)).addScaledVector(E, Math.sin(pa)).normalize();
      const q = IMP_Q[c.type] ?? 1;
      let axis = u.clone();
      const discLike = IMP_Q[c.type] !== undefined && c.type !== "QS";
      if (discLike && c.type !== "MW") {
        let cosI: number;
        const ratio = Math.min(1, Math.max(0.01, c.ratio));
        if (ratio <= q) cosI = 0;
        else cosI = Math.sqrt((ratio * ratio - q * q) / (1 - q * q));
        const sinI = Math.sqrt(Math.max(0, 1 - cosI * cosI));
        const w = new V().crossVectors(u, m);
        const sgn = (c.idx * 7919) % 2 === 0 ? 1 : -1;
        axis = u.clone().multiplyScalar(cosI).addScaledVector(w, sinI * sgn).normalize();
      } else if (c.type === "MW") {
        axis = new V(ngp[0], ngp[1], ngp[2]);
      } else if (c.type === "QS") {
        const w = new V().crossVectors(u, m);
        axis = u.clone().multiplyScalar(0.6).addScaledVector(w, 0.8).normalize();
      }
      const R = c.radius;
      let stop: number;
      if (c.type === "ST") stop = c.id === "SUN" ? 0.05 : 2;
      else if (c.type === "BH") stop = Math.max(R * 3, 4);
      else stop = Math.max(R * 2.4, 0.3);
      const col = c.type === "ST" ? c.color : IMP_COL[c.type] ?? [1, 1, 1];
      const obj: Obj = {
        c, p, u, N, E, m, axis, impType: IMP_TYPE[c.type], q: c.type === "MW" ? 0.04 : q,
        col, bright: IMP_BRIGHT[c.type], stop, d: 1, prPx: 0, score: 0, sx: 0, sy: 0, onScreen: false,
        dir: new V(), detailAlpha: 0,
      };
      this.objs.push(obj);
      this.byId.set(c.id, obj);
    }
  }

  private initImpostors() {
    const n = this.objs.length;
    this.impPos = new Float32Array(n * 3);
    this.impPar = new Float32Array(n * 4);
    this.impAxis = new Float32Array(n * 3);
    this.impCol = new Float32Array(n * 3);
    this.objs.forEach((o, i) => {
      this.impAxis.set([o.axis.x, o.axis.y, o.axis.z], i * 3);
      this.impCol.set(o.col, i * 3);
      this.impPar[i * 4 + 1] = o.q;
      this.impPar[i * 4 + 3] = o.impType;
    });
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute("aPos", new THREE.InstancedBufferAttribute(this.impPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aPar", new THREE.InstancedBufferAttribute(this.impPar, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aAxis", new THREE.InstancedBufferAttribute(this.impAxis, 3));
    geo.setAttribute("aCol", new THREE.InstancedBufferAttribute(this.impCol, 3));
    geo.instanceCount = n;
    this.impGeom = geo;
    const mesh = new THREE.Mesh(geo, makeImpostorMaterial(this.g));
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    this.scene.add(mesh);
  }

  private initLocalStars() {
    const layer = genLocalStars(this.Q);
    const geo = this.layerGeometry(layer);
    this.localMat = makeStarMaterial(this.g, this.localOpacity, 1);
    const pts = new THREE.Points(geo, this.localMat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    const orient = new THREE.Group();
    orient.quaternion.copy(this.mwQuat);
    orient.add(pts);
    this.localGroup.add(orient);
    this.scene.add(this.localGroup);
  }

  private layerGeometry(l: Layer): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(l.pos, 3));
    geo.setAttribute("aCol", new THREE.Float32BufferAttribute(l.col, 4));
    if (l.kind !== "star") geo.setAttribute("aSize", new THREE.Float32BufferAttribute(l.size, 1));
    return geo;
  }

  // ---------------- 詳細モデル ----------------
  private frameQuat(o: Obj, model: Model): THREE.Quaternion {
    const x = o.m.clone();
    let z: THREE.Vector3;
    if (o.c.type === "MW") return this.mwQuat.clone();
    if (model.frame === "disc") z = o.axis.clone();
    else z = o.u.clone().negate();
    const y = new V().crossVectors(z, x).normalize();
    const x2 = new V().crossVectors(y, z).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x2, y, z));
  }

  private buildDetail(o: Obj): Detail | null {
    const model = generate(o.c, this.Q);
    if (!model) return null;
    const group = new THREE.Group();
    const orient = new THREE.Group();
    orient.quaternion.copy(this.frameQuat(o, model));
    group.add(orient);
    const opacity = { value: 0 };
    const imgOpacity = { value: 0 };
    const view = { value: 1 };
    const one = { value: 1 };
    const thin = THIN_TYPES.has(o.c.type);
    const layers: THREE.Points[] = [];
    const mats: THREE.Material[] = [];
    const geoms: THREE.BufferGeometry[] = [];
    for (const l of model.layers) {
      if (l.size.length === 0) continue;
      const geo = this.layerGeometry(l);
      const vw = thin && l.kind === "glow" && l.sharp === 0 ? view : one;
      const mat = l.kind === "star" ? makeStarMaterial(this.g, opacity, l.gain) : makeGlowMaterial(this.g, opacity, l.gain, l.sharp, l.kind === "dust", vw);
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = l.kind === "dust" ? 2 : l.kind === "star" || l.sharp > 0 ? 3 : 1;
      orient.add(pts);
      layers.push(pts);
      mats.push(mat);
      geoms.push(geo);
    }
    const det: Detail = {
      group, orient, opacity, imgOpacity, view, thin, layers, mats, geoms, imgReady: false, imgRadius: o.c.radius, disposed: false, lastUsed: this.frameNo,
    };
    group.visible = false;
    this.scene.add(group);
    this.attachImage(o, det);
    return det;
  }

  private attachImage(o: Obj, det: Detail) {
    const title = o.c.wiki;
    if (!title || !IMG_TYPES.has(o.c.type)) return;
    wikiTexture(title).then((res) => {
      if (!res || det.disposed || this.disposed) return;
      const k = IMG_K[o.c.type] ?? 1.6;
      const diam = o.c.diamLy * k;
      const w = res.aspect >= 1 ? diam : diam * res.aspect;
      const h = res.aspect >= 1 ? diam / res.aspect : diam;
      const mat = makeImageMaterial(this.g, res.tex, det.imgOpacity);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.scale.set(w, h, 1);
      const right = new V().crossVectors(o.u, o.N).normalize();
      const up = o.N.clone();
      const zz = o.u.clone().negate();
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, zz));
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      det.group.add(mesh);
      det.img = mesh;
      det.mats.push(mat);
      det.geoms.push(mesh.geometry);
      det.imgRadius = Math.max(w, h) / 2;
      det.imgReady = true;
    });
  }

  private disposeDetail(o: Obj) {
    const d = o.detail;
    if (!d) return;
    d.disposed = true;
    this.scene.remove(d.group);
    d.geoms.forEach((g) => g.dispose());
    d.mats.forEach((m) => m.dispose());
    o.detail = undefined;
    o.detailAlpha = 0;
  }

  // ---------------- 入力 ----------------
  private bindEvents() {
    const cv = this.renderer.domElement;
    const kd = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (["Space", "ArrowUp", "ArrowDown", "Tab"].includes(e.code)) e.preventDefault();
      this.keys[e.code] = true;
      if (e.code === "KeyG" && this.selected) this.warpTo(this.selected.c.id);
      if (e.code === "KeyX") { this.vel.set(0, 0, 0); this.stopWarp(); this.cruise = false; }
      if (e.code === "KeyZ") this.cruise = !this.cruise;
    };
    const ku = (e: KeyboardEvent) => { this.keys[e.code] = false; };
    const blur = () => { this.keys = {}; };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    const rs = () => this.resize();
    window.addEventListener("resize", rs);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const dv = -Math.sign(e.deltaY) * 0.12;
      this.adjustSpeed(dv);
    };
    cv.addEventListener("wheel", wheel, { passive: false });
    const pd = (e: PointerEvent) => {
      if (this.ptr) return;
      this.ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
      try { cv.setPointerCapture(e.pointerId); } catch { /* noop */ }
    };
    const pm = (e: PointerEvent) => {
      if (!this.ptr || this.ptr.id !== e.pointerId) return;
      const dx = e.clientX - this.ptr.x, dy = e.clientY - this.ptr.y;
      this.ptr.x = e.clientX; this.ptr.y = e.clientY;
      this.ptr.moved += Math.abs(dx) + Math.abs(dy);
      this.look(dx, dy);
    };
    const pu = (e: PointerEvent) => {
      if (!this.ptr || this.ptr.id !== e.pointerId) return;
      const p = this.ptr;
      this.ptr = null;
      if (p.moved < 8 && performance.now() - p.t < 600) this.pick(e.clientX, e.clientY);
    };
    cv.addEventListener("pointerdown", pd);
    cv.addEventListener("pointermove", pm);
    cv.addEventListener("pointerup", pu);
    cv.addEventListener("pointercancel", pu);
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    this.cleanup.push(() => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", rs);
      cv.removeEventListener("wheel", wheel);
      cv.removeEventListener("pointerdown", pd);
      cv.removeEventListener("pointermove", pm);
      cv.removeEventListener("pointerup", pu);
      cv.removeEventListener("pointercancel", pu);
    });
  }

  look(dx: number, dy: number) {
    const s = (this.o.mode === "mobile" ? 0.0032 : 0.0022) * (this.fov / 60);
    this.camera.rotateY(-dx * s);
    this.camera.rotateX(-dy * s);
  }

  private adjustSpeed(dv: number) {
    if (this.auto) this.autoMul = Math.min(30, Math.max(0.03, this.autoMul * Math.exp(dv * 2.3)));
    else this.logSpeed = Math.min(10, Math.max(-3, this.logSpeed + dv));
  }

  setMode(m: "pc" | "mobile") { this.o.mode = m; }
  setMove(x: number, z: number) { this.joy.x = x; this.joy.z = z; }
  setVertical(v: number) { this.vert = v; }
  setRoll(r: number) { this.rollIn = r; }
  setBoost(b: boolean) { this.boostOn = b; }
  setCruise(b: boolean) { this.cruise = b; }
  setLabels(b: boolean) { this.labels = b; }
  setExposure(v: number) { this.g.uExp.value = v; }
  setAuto(b: boolean) { this.auto = b; }
  setLogSpeed(v: number) { this.logSpeed = v; }
  setAutoMul(v: number) { this.autoMul = v; }
  setFov(v: number) { this.fov = v; this.camera.fov = v; this.resize(); }
  brake() { this.vel.set(0, 0, 0); this.stopWarp(); this.cruise = false; }

  setQuality(q: number) {
    this.Q = q;
    for (const o of this.objs) this.disposeDetail(o);
    if (this.localMat) {
      this.localGroup.clear();
      this.initLocalStars();
    }
  }

  select(id: string | null) {
    this.selected = id ? this.byId.get(id) ?? null : null;
    this.o.onSelect(this.selected ? this.selected.c : null);
  }

  warpTo(id: string) {
    const o = this.byId.get(id);
    if (!o) return;
    this.warp = o;
    this.cruise = false;
  }
  stopWarp() { this.warp = null; }

  private pick(cx: number, cy: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = cx - rect.left, y = cy - rect.top;
    let best: Obj | null = null;
    let bs = 1e9;
    const thr = this.o.mode === "mobile" ? 40 : 28;
    for (const o of this.objs) {
      if (!o.onScreen) continue;
      const dd = Math.hypot(o.sx - x, o.sy - y);
      const inside = o.prPx > 6 && dd < o.prPx;
      if (dd > thr && !inside) continue;
      const sc = (inside ? dd * 0.5 : dd) - Math.min(o.score, 30) * 0.4;
      if (sc < bs) { bs = sc; best = o; }
    }
    this.select(best ? best.c.id : null);
  }

  // ---------------- メインループ ----------------
  private resize() {
    const cont = this.renderer.domElement.parentElement!;
    const w = cont.clientWidth || window.innerWidth;
    const h = cont.clientHeight || window.innerHeight;
    this.W = w; this.H = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const ph = h * this.dpr;
    this.g.uPx.value = ph / (2 * Math.tan((this.fov * Math.PI) / 360));
    this.g.uViewport.value.set(w * this.dpr, ph);
    this.labelCv.width = w * this.dpr;
    this.labelCv.height = h * this.dpr;
  }

  private loop = (t: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.frameNo++;
    this.fpsAcc += dt; this.fpsCnt++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsCnt / this.fpsAcc; this.fpsAcc = 0; this.fpsCnt = 0; }
    this.updateControls(dt);
    this.updateObjects();
    this.updateLocal();
    this.renderer.render(this.scene, this.camera);
    this.drawLabels();
    this.hudT += dt;
    if (this.hudT > 0.12) { this.hudT = 0; this.o.onHud(this.hudState()); }
  };

  private tmpA = new V();
  private tmpB = new V();
  private tmpC = new V();

  private updateControls(dt: number) {
    const k = this.keys;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const ix = clamp((k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) + this.joy.x);
    let iz = clamp((k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0) + this.joy.z);
    const iy = clamp((k.KeyR || k.Space ? 1 : 0) - (k.KeyF || k.KeyC ? 1 : 0) + this.vert);
    const roll = clamp((k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0) + this.rollIn);
    const userMove = ix !== 0 || iy !== 0 || iz !== 0;
    if (this.cruise && iz <= 0 && !k.KeyS && !k.ArrowDown) iz = 1;
    const boost = this.boostOn || k.ShiftLeft || k.ShiftRight;
    if (userMove && this.warp) this.stopWarp();
    if (roll) this.camera.rotateZ(-roll * dt * 1.1);

    const speed = this.auto ? Math.min(1e10, Math.max(1e-3, this.nearestEdge * 0.2 * this.autoMul)) : Math.pow(10, this.logSpeed);
    this.speedNow = speed * (boost ? 8 : 1);

    const q = this.camera.quaternion;
    if (this.warp) {
      const o = this.warp;
      const rel = this.tmpA.copy(o.p).sub(this.camPos);
      const d = rel.length();
      const rem = d - o.stop;
      const dirv = rel.clone().divideScalar(Math.max(d, 1e-12));
      const m = new THREE.Matrix4().lookAt(new V(0, 0, 0), dirv, new V(0, 1, 0).applyQuaternion(q));
      const qt = new THREE.Quaternion().setFromRotationMatrix(m);
      this.camera.quaternion.slerp(qt, 1 - Math.exp(-dt * 3.2));
      const fwd = this.tmpB.set(0, 0, -1).applyQuaternion(q);
      const ang = Math.acos(Math.min(1, Math.max(-1, fwd.dot(dirv))));
      const fac = Math.max(0, 1 - ang / 0.9);
      if (rem <= Math.max(o.stop * 0.02, 1e-3)) {
        this.warp = null;
        this.vel.set(0, 0, 0);
      } else {
        const v = rem * 1.4 * fac;
        this.vel.copy(dirv).multiplyScalar(v);
        this.speedNow = v;
      }
    } else {
      const right = this.tmpA.set(1, 0, 0).applyQuaternion(q);
      const up = this.tmpB.set(0, 1, 0).applyQuaternion(q);
      const fwd = this.tmpC.set(0, 0, -1).applyQuaternion(q);
      const target = new V().addScaledVector(right, ix).addScaledVector(up, iy).addScaledVector(fwd, iz);
      if (target.length() > 1) target.normalize();
      target.multiplyScalar(this.speedNow);
      const moving = ix !== 0 || iy !== 0 || iz !== 0;
      this.vel.lerp(target, 1 - Math.exp(-dt * (moving ? 4 : 7)));
      if (!moving && this.vel.length() < this.speedNow * 1e-3) this.vel.set(0, 0, 0);
    }
    this.camPos.addScaledVector(this.vel, dt);
  }

  private updateObjects() {
    const cam = this.camPos;
    const px = this.g.uPx.value;
    const qInv = this.camera.quaternion.clone().invert();
    const tanY = Math.tan((this.fov * Math.PI) / 360);
    const tanX = tanY * this.camera.aspect;
    let nearEdge = 1e12;
    let nearName = "";
    this.building = 0;
    const W = this.W, H = this.H;
    const v = this.tmpC;

    for (let i = 0; i < this.objs.length; i++) {
      const o = this.objs[i];
      const c = o.c;
      const dx = o.p.x - cam.x, dy = o.p.y - cam.y, dz = o.p.z - cam.z;
      let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) d = 1e-9;
      o.d = d;
      o.dir.set(dx / d, dy / d, dz / d);
      const R = d < RMAX ? d : RMAX;
      const s = R / d;
      const radius = c.radius;
      const prPx = (radius / d) * px;
      o.prPx = prPx;
      this.impPos[i * 3] = o.dir.x * R;
      this.impPos[i * 3 + 1] = o.dir.y * R;
      this.impPos[i * 3 + 2] = o.dir.z * R;

      // 画面座標
      v.copy(o.dir).applyQuaternion(qInv);
      const zf = -v.z;
      if (zf > 1e-6) {
        o.sx = (0.5 + (0.5 * v.x) / zf / tanX) * W;
        o.sy = (0.5 - (0.5 * v.y) / zf / tanY) * H;
        o.onScreen = o.sx > -60 && o.sx < W + 60 && o.sy > -60 && o.sy < H + 60;
      } else o.onScreen = false;

      // 最近傍（天体の縁までの距離）
      const edge = d - radius;
      if (edge > 0 && edge < nearEdge && c.id !== "MW") { nearEdge = edge; nearName = labelOf(c); }
      else if (edge > 0 && c.id === "MW" && edge < nearEdge) { nearEdge = edge; nearName = labelOf(c); }

      // インポスター
      let par0 = 0, par2 = o.bright;
      if (c.type === "ST") {
        const dd = Math.max(d, 0.02);
        let m = c.absMag + 5 * Math.log10(dd / 32.616);
        m = Math.min(m, 7.2);
        const f = Math.pow(10, -0.4 * (m - 6));
        par0 = Math.min(30, 1.1 + 1.6 * Math.log10(1 + 5 * f));
        par2 = Math.min(1, Math.max(0, 0.25 + 0.75 * Math.sqrt(f)));
        o.score = par0 * 1.3;
        o.detailAlpha = 0;
      } else {
        const diamPx = prPx * 2;
        let da = 0;
        if (diamPx > 16 || (c.type === "MW" && d < radius * 1.2)) {
          da = smoothstep(16, 44, diamPx);
          if (c.type === "MW" && d < radius * 1.2) da = 1;
        }
        // 詳細モデルの生成・破棄
        if (da > 0) {
          if (!o.detail && this.building < 1) {
            o.detail = this.buildDetail(o) ?? undefined;
            this.building++;
          }
          if (!o.detail) da = 0;
        }
        o.detailAlpha = da;
        o.score = prPx;
        if (c.type === "BH") par0 = 3.2;
        else if (c.type === "QS") par0 = Math.min(300, Math.max(prPx, 3.6));
        else par0 = radius * s;
        par2 = o.bright * (1 - da);
        if (c.type === "DK") par2 = 0;
        if (prPx > 2500 || d < radius * 0.5) par2 = 0;
      }
      this.impPar[i * 4] = par0;
      this.impPar[i * 4 + 2] = par2;

      // 詳細モデルの配置
      const det = o.detail;
      if (det) {
        if (o.detailAlpha > 0.002) {
          det.lastUsed = this.frameNo;
          det.group.visible = true;
          det.group.position.set(o.dir.x * R, o.dir.y * R, o.dir.z * R);
          det.group.scale.setScalar(s);
          let imgA = 0;
          if (det.imgReady) {
            const cs = o.dir.dot(o.u);
            imgA = smoothstep(0.5, 0.88, cs) * smoothstep(0.7, 1.8, d / det.imgRadius);
          }
          det.imgOpacity.value = o.detailAlpha * imgA;
          det.opacity.value = o.detailAlpha * (1 - 0.8 * imgA);
          if (det.thin) {
            // 円盤を真横から見るほど視線方向の積分が増えるため明るさを補正
            const cosI = Math.abs(o.dir.dot(o.axis));
            det.view.value = (cosI + 0.15) / 1.15;
          }
        } else det.group.visible = false;
      }
    }
    this.nearestEdge = nearEdge < 1e11 ? nearEdge : 1;
    this.nearestName = nearName;
    const ia = this.impGeom.attributes;
    (ia.aPos as THREE.BufferAttribute).needsUpdate = true;
    (ia.aPar as THREE.BufferAttribute).needsUpdate = true;

    // 詳細モデルの LRU 破棄
    if (this.frameNo % 30 === 0) {
      const built = this.objs.filter((o) => o.detail);
      if (built.length > 14) {
        built.sort((a, b) => a.detail!.lastUsed - b.detail!.lastUsed);
        for (let i = 0; i < built.length - 14; i++) {
          const o = built[i];
          if (o.detailAlpha === 0 && o.c.type !== "MW") this.disposeDetail(o);
        }
      }
    }
  }

  private updateLocal() {
    const d = this.camPos.length();
    const R = d < RMAX ? d : RMAX;
    const s = d > 0 ? R / d : 1;
    const op = 1 - smoothstep(6000, 40000, d);
    this.localOpacity.value = op;
    this.localGroup.visible = op > 0.003;
    if (d > 1e-9) {
      this.localGroup.position.set((-this.camPos.x / d) * R, (-this.camPos.y / d) * R, (-this.camPos.z / d) * R);
    } else this.localGroup.position.set(0, 0, 0);
    this.localGroup.scale.setScalar(s);
  }

  // ---------------- ラベル ----------------
  private drawLabels() {
    const ctx = this.lctx;
    const W = this.W, H = this.H;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = "12px 'Hiragino Sans','Noto Sans JP',system-ui,sans-serif";
    ctx.textBaseline = "middle";
    const placed: [number, number, number, number][] = [];
    const overlap = (x: number, y: number, w: number, h: number) => {
      for (const r of placed) if (x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1]) return true;
      return false;
    };
    const sel = this.selected;
    if (this.labels) {
      const cands: { o: Obj; s: number }[] = [];
      for (const o of this.objs) {
        if (!o.onScreen || o === sel) continue;
        const dc = Math.hypot(o.sx - W / 2, o.sy - H / 2);
        const score = o.score + 12 * Math.max(0, 1 - dc / (0.3 * H));
        if (score < 3.2) continue;
        if (o.c.type === "DK" && o.prPx < 4) continue;
        cands.push({ o, s: score });
      }
      cands.sort((a, b) => b.s - a.s);
      let n = 0;
      for (const { o } of cands) {
        if (n > 42) break;
        const text = labelOf(o.c);
        const w = ctx.measureText(text).width + 6;
        const big = o.prPx > 30 && o.c.type !== "ST";
        const x = big ? o.sx - w / 2 : o.sx + 9;
        const y = big ? o.sy - Math.min(o.prPx, H * 0.3) - 6 : o.sy - 9;
        if (x < 0 || x + w > W || y < 8 || y > H - 8) continue;
        if (overlap(x, y - 8, w, 16)) continue;
        placed.push([x, y - 8, w, 16]);
        n++;
        if (!big) {
          ctx.strokeStyle = "rgba(160,200,255,0.55)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(o.sx, o.sy, Math.max(3, Math.min(o.prPx, 18)), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(0,0,10,0.55)";
        ctx.fillRect(x - 2, y - 8, w, 16);
        ctx.fillStyle = "rgba(205,226,255,0.95)";
        ctx.fillText(text, x + 1, y);
      }
    }
    if (sel) {
      const tanY = Math.tan((this.fov * Math.PI) / 360);
      const tanX = tanY * this.camera.aspect;
      if (sel.onScreen) {
        const r = Math.max(14, Math.min(sel.prPx + 8, H * 0.45));
        ctx.strokeStyle = "rgba(255,200,90,0.95)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(sel.sx, sel.sy, r, 0, Math.PI * 2);
        ctx.stroke();
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2 + Math.PI / 4;
          ctx.beginPath();
          ctx.moveTo(sel.sx + Math.cos(a) * (r + 3), sel.sy + Math.sin(a) * (r + 3));
          ctx.lineTo(sel.sx + Math.cos(a) * (r + 10), sel.sy + Math.sin(a) * (r + 10));
          ctx.stroke();
        }
        ctx.font = "bold 13px 'Hiragino Sans','Noto Sans JP',system-ui,sans-serif";
        const text = labelOf(sel.c);
        const w = ctx.measureText(text).width + 8;
        const x = Math.min(W - w - 4, Math.max(4, sel.sx - w / 2));
        const y = Math.max(14, sel.sy - r - 14);
        ctx.fillStyle = "rgba(20,12,0,0.7)";
        ctx.fillRect(x, y - 9, w, 18);
        ctx.fillStyle = "rgb(255,214,120)";
        ctx.fillText(text, x + 4, y);
      } else {
        const v = this.tmpC.copy(sel.dir).applyQuaternion(this.camera.quaternion.clone().invert());
        let ax = v.x, ay = -v.y;
        const l = Math.hypot(ax, ay) || 1;
        ax /= l; ay /= l;
        const sc = Math.min((W / 2 - 34) / Math.max(Math.abs(ax), 1e-4), (H / 2 - 34) / Math.max(Math.abs(ay), 1e-4));
        const px = W / 2 + ax * sc, py = H / 2 + ay * sc;
        const ang = Math.atan2(ay, ax);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang);
        ctx.fillStyle = "rgba(255,200,90,0.95)";
        ctx.beginPath();
        ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        void tanX;
      }
    }
  }

  // ---------------- HUD ----------------
  private contextName(): string {
    const mw = this.byId.get("MW")!;
    const dMW = this.camPos.distanceTo(mw.p);
    const dSun = this.camPos.length();
    if (dSun < 30) return "太陽系近傍";
    if (dMW < 60000) return "天の川銀河の内部";
    if (dMW < 1.2e6) return "天の川銀河ハロー・局所銀河群";
    if (dMW < 1e7) return "局所銀河群〜近傍銀河";
    if (dMW < 1e8) return "近傍銀河間空間";
    if (dMW < 1e9) return "銀河間空間（大規模構造）";
    if (dMW < 6e9) return "遠方宇宙";
    return "宇宙論的スケール（初期宇宙）";
  }

  private hudState(): HudState {
    const sel = this.selected;
    return {
      speed: this.vel.length() > 0 ? this.vel.length() : this.speedNow,
      auto: this.auto,
      logSpeed: this.logSpeed,
      autoMul: this.autoMul,
      context: this.contextName(),
      sunDist: this.camPos.length(),
      nearestName: this.nearestName,
      nearestEdge: this.nearestEdge,
      warping: !!this.warp,
      warpName: this.warp ? labelOf(this.warp.c) : "",
      warpRemain: this.warp ? Math.max(0, this.warp.d - this.warp.stop) : 0,
      selId: sel ? sel.c.id : null,
      selDist: sel ? sel.d : 0,
      fps: this.fps,
      cruise: this.cruise,
    };
  }

  getObject(id: string) { return CAT_BY_ID[id]; }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    for (const o of this.objs) this.disposeDetail(o);
    this.renderer.dispose();
    const cv = this.renderer.domElement;
    cv.parentElement?.removeChild(cv);
    this.labelCv.parentElement?.removeChild(this.labelCv);
  }
}
