import { memo, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CATALOG, CatObj, TYPE_LABEL, AGE_UNIVERSE_GYR } from "../data/catalog";
import type { HudState } from "../engine/universe";
import { labelOf } from "../engine/universe";
import { fmtDistance, fmtYears } from "../lib/math";

export const glass = "bg-slate-950/55 backdrop-blur-md border border-white/10 shadow-lg shadow-black/40";

export function fmtBig(n: number): string {
  if (n < 1e4) return n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 2 : n < 100 ? 1 : 0 });
  if (n < 1e8) return `${(n / 1e4).toFixed(1)}万`;
  if (n < 1e12) return `${(n / 1e8).toFixed(1)}億`;
  if (n < 1e16) return `${(n / 1e12).toFixed(1)}兆`;
  return n.toExponential(1);
}

export function fmtSpeed(lyPerSec: number): { a: string; b: string } {
  const c = lyPerSec * 31557600;
  let a: string;
  if (lyPerSec < 1e-3) a = `${(lyPerSec * 63241).toFixed(1)} AU/秒`;
  else a = `${fmtBig(lyPerSec)} 光年/秒`;
  const b = c < 1 ? `光速の ${c.toFixed(3)} 倍` : `光速の ${fmtBig(c)} 倍`;
  return { a, b };
}

// ---------------- 仮想ジョイスティック ----------------
export function Joystick({ onMove }: { onMove: (x: number, z: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pid = useRef<number | null>(null);
  const [k, setK] = useState({ x: 0, y: 0 });
  const upd = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const R = r.width / 2 - 22;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    setK({ x: dx, y: dy });
    const nx = dx / R, nz = -dy / R;
    onMove(Math.abs(nx) < 0.08 ? 0 : nx, Math.abs(nz) < 0.08 ? 0 : nz);
  };
  const end = () => { pid.current = null; setK({ x: 0, y: 0 }); onMove(0, 0); };
  return (
    <div
      ref={ref}
      className="relative h-32 w-32 touch-none select-none rounded-full border border-white/20 bg-white/5 backdrop-blur-sm"
      onPointerDown={(e) => { pid.current = e.pointerId; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); upd(e); }}
      onPointerMove={(e) => { if (pid.current === e.pointerId) upd(e); }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="absolute left-1/2 top-1 -translate-x-1/2 text-[10px] text-white/40">前進</div>
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-white/40">後退</div>
      <div
        className="absolute h-14 w-14 rounded-full border border-cyan-200/60 bg-cyan-300/25 shadow-[0_0_18px_rgba(120,220,255,0.4)]"
        style={{ left: `calc(50% - 28px + ${k.x}px)`, top: `calc(50% - 28px + ${k.y}px)` }}
      />
    </div>
  );
}

export function HoldButton({ children, onDown, onUp, className = "" }: { children: ReactNode; onDown: () => void; onUp: () => void; className?: string }) {
  return (
    <button
      className={`touch-none select-none rounded-2xl border border-white/20 bg-white/10 px-3 py-3 text-sm font-semibold text-white backdrop-blur-sm active:bg-cyan-400/40 ${className}`}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onDown(); }}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

// ---------------- 速度パネル ----------------
const PRESETS = [
  { label: "恒星間", sub: "1 光年/秒", v: 0 },
  { label: "銀河内", sub: "千 光年/秒", v: 3 },
  { label: "銀河間", sub: "1千万 光年/秒", v: 7 },
  { label: "宇宙規模", sub: "20億 光年/秒", v: 9.3 },
];

export function SpeedPanel({ hud, onAuto, onLog, onMul, onPreset, compact }: {
  hud: HudState; onAuto: (b: boolean) => void; onLog: (v: number) => void; onMul: (v: number) => void;
  onPreset: (v: number) => void; compact: boolean;
}) {
  const sp = fmtSpeed(hud.speed);
  return (
    <div className={`${glass} pointer-events-auto w-full rounded-2xl px-3 py-2 ${compact ? "max-w-md" : "max-w-xl"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-bold tabular-nums text-cyan-200">{sp.a}</div>
          <div className="truncate text-[11px] text-white/55">{sp.b}</div>
        </div>
        <button
          onClick={() => onAuto(!hud.auto)}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${hud.auto ? "border-emerald-300/70 bg-emerald-400/20 text-emerald-200" : "border-white/25 bg-white/5 text-white/70"}`}
        >
          {hud.auto ? "オート速度 ON" : "手動速度"}
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="w-8 shrink-0 text-[10px] text-white/50">{hud.auto ? "倍率" : "速度"}</span>
        {hud.auto ? (
          <input type="range" min={-1.5} max={1.5} step={0.02} value={Math.log10(hud.autoMul)} onChange={(e) => onMul(Math.pow(10, parseFloat(e.target.value)))} className="h-6 w-full accent-emerald-300" />
        ) : (
          <input type="range" min={-3} max={10} step={0.02} value={hud.logSpeed} onChange={(e) => onLog(parseFloat(e.target.value))} className="h-6 w-full accent-cyan-300" />
        )}
      </div>
      {!compact && (
        <div className="mt-1 text-[10px] text-white/45">
          {hud.auto ? "近くの天体との距離に応じて自動で加減速します（ホイールで倍率変更）" : "ホイール / スライダーで 0.001〜100億 光年/秒"}
        </div>
      )}
      <div className="mt-1.5 grid grid-cols-4 gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => onPreset(p.v)} className="rounded-lg border border-white/15 bg-white/5 px-1 py-1 text-center hover:bg-white/15 active:bg-cyan-400/30">
            <div className="text-[11px] font-semibold text-white/90">{p.label}</div>
            {!compact && <div className="text-[9px] text-white/45">{p.sub}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- 天体情報 ----------------
function fmtRA(ra: number) {
  const h = Math.floor(ra);
  const m = (ra - h) * 60;
  return `${h}h ${m.toFixed(1)}m`;
}

export function InfoCard({ obj, hud, onWarp, onStop, onClose, compact }: {
  obj: CatObj; hud: HudState; onWarp: () => void; onStop: () => void; onClose: () => void; compact: boolean;
}) {
  const lb = obj.lookbackYears;
  const warpingThis = hud.warping && hud.warpName === labelOf(obj);
  const isStar = obj.type === "ST";
  const rows: [string, string][] = [];
  if (obj.id === "SUN") rows.push(["距離", "0 (太陽系)"]);
  else {
    rows.push(["太陽系からの距離", fmtDistance(obj.distLy)]);
    rows.push(["光が届くまで (look-back)", `${fmtYears(lb)} 前の姿`]);
  }
  if (obj.z !== undefined) {
    rows.push(["赤方偏移", `z = ${obj.z}`]);
    rows.push(["その時の宇宙の年齢", `誕生から約 ${(AGE_UNIVERSE_GYR - lb / 1e9).toFixed(2)} Gyr (${(((AGE_UNIVERSE_GYR - lb / 1e9) / AGE_UNIVERSE_GYR) * 100).toFixed(1)}%)`]);
  }
  if (!isStar) rows.push(["大きさ (直径)", fmtDistance(obj.diamLy)]);
  if (!isStar && obj.angArcmin > 0) rows.push(["見かけの大きさ", obj.angArcmin >= 60 ? `${(obj.angArcmin / 60).toFixed(2)}°` : obj.angArcmin >= 1 ? `${obj.angArcmin.toFixed(1)}′` : `${(obj.angArcmin * 60).toFixed(2)}″`]);
  rows.push(["赤経 / 赤緯", `${fmtRA(obj.ra)} / ${obj.dec >= 0 ? "+" : "−"}${Math.abs(obj.dec).toFixed(2)}°`]);
  rows.push(["現在地からの距離", `${fmtDistance(hud.selDist)}（光で ${fmtYears(hud.selDist)}）`]);
  return (
    <div className={`${glass} pointer-events-auto w-full rounded-2xl p-3 ${compact ? "max-h-[38vh] overflow-y-auto" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/80">{TYPE_LABEL[obj.type]}</div>
          <div className="truncate text-base font-bold text-white">{labelOf(obj)}</div>
          {obj.wiki && obj.wiki !== obj.id && <div className="truncate text-[11px] text-white/50">{obj.wiki}</div>}
        </div>
        <button onClick={onClose} className="shrink-0 rounded-md px-2 text-lg leading-none text-white/60 hover:bg-white/10">×</button>
      </div>
      <dl className="mt-2 space-y-0.5 text-[12px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="shrink-0 text-white/50">{k}</dt>
            <dd className="text-right tabular-nums text-white/90">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex gap-2">
        {warpingThis ? (
          <button onClick={onStop} className="flex-1 rounded-lg border border-rose-300/60 bg-rose-500/20 py-1.5 text-sm font-semibold text-rose-100">停止</button>
        ) : (
          <button onClick={onWarp} className="flex-1 rounded-lg border border-amber-300/60 bg-amber-400/20 py-1.5 text-sm font-semibold text-amber-100 hover:bg-amber-400/30">▶ ここへ向かう</button>
        )}
        {obj.wiki && (
          <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(obj.wiki.replace(/ /g, "_"))}`} target="_blank" rel="noreferrer" className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white/80 hover:bg-white/15">Wiki</a>
        )}
      </div>
    </div>
  );
}

// ---------------- 天体カタログ ----------------
const FILTERS: { key: string; label: string; test: (c: CatObj) => boolean }[] = [
  { key: "all", label: "すべて", test: () => true },
  { key: "M", label: "メシエ", test: (c) => c.group === "M" },
  { key: "C", label: "コールドウェル", test: (c) => c.group === "C" },
  { key: "gal", label: "銀河", test: (c) => ["SA", "SB", "EL", "S0", "IR", "PE", "MW"].includes(c.type) },
  { key: "clu", label: "星団", test: (c) => ["GC", "OC", "SC"].includes(c.type) },
  { key: "neb", label: "星雲", test: (c) => ["EM", "RF", "PN", "SN", "DK"].includes(c.type) },
  { key: "star", label: "恒星・BH", test: (c) => c.type === "ST" || c.type === "BH" },
  { key: "far", label: "クエーサー・初期宇宙", test: (c) => ["QS", "HZ", "CL"].includes(c.type) },
];

export const CatalogPanel = memo(function CatalogPanel({ selId, onPick, onWarp, onClose, compact }: {
  selId: string | null; onPick: (id: string) => void; onWarp: (id: string) => void; onClose: () => void; compact: boolean;
}) {
  const [q, setQ] = useState("");
  const [f, setF] = useState("all");
  const [sort, setSort] = useState<"dist" | "name">("dist");
  const list = useMemo(() => {
    const flt = FILTERS.find((x) => x.key === f)!;
    const qq = q.trim().toLowerCase();
    const arr = CATALOG.filter((c) => flt.test(c) && (!qq || (c.id + " " + c.name + " " + (c.wiki ?? "") + " " + TYPE_LABEL[c.type]).toLowerCase().includes(qq)));
    arr.sort((a, b) => (sort === "dist" ? a.distLy - b.distLy : a.id.localeCompare(b.id, undefined, { numeric: true })));
    return arr;
  }, [q, f, sort]);
  return (
    <div className={`${glass} pointer-events-auto flex flex-col rounded-2xl ${compact ? "h-[62vh] w-full" : "h-[78vh] w-[380px]"}`}>
      <div className="flex items-center justify-between px-3 pt-3">
        <div className="text-sm font-bold text-white">天体カタログ <span className="text-xs font-normal text-white/50">{list.length} / {CATALOG.length}</span></div>
        <button onClick={onClose} className="rounded-md px-2 text-lg leading-none text-white/60 hover:bg-white/10">×</button>
      </div>
      <div className="px-3 pt-2">
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="検索（M31 / アンドロメダ / NGC 253 / クエーサー…）" className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-300/60" />
        <div className="mt-2 flex flex-wrap gap-1">
          {FILTERS.map((x) => (
            <button key={x.key} onClick={() => setF(x.key)} className={`rounded-full border px-2 py-0.5 text-[11px] ${f === x.key ? "border-cyan-300/70 bg-cyan-400/20 text-cyan-100" : "border-white/15 text-white/60"}`}>{x.label}</button>
          ))}
        </div>
        <div className="mt-1.5 flex gap-2 text-[11px] text-white/50">
          並び順:
          <button onClick={() => setSort("dist")} className={sort === "dist" ? "text-cyan-200" : ""}>距離順</button>
          <button onClick={() => setSort("name")} className={sort === "name" ? "text-cyan-200" : ""}>番号順</button>
        </div>
      </div>
      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
        {list.map((c) => (
          <div key={c.id} onClick={() => onPick(c.id)} className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/10 ${selId === c.id ? "bg-amber-400/15" : ""}`}>
            <div className="min-w-0">
              <div className="truncate text-[13px] text-white/95">{labelOf(c)}</div>
              <div className="truncate text-[10px] text-white/45">{TYPE_LABEL[c.type]} · {c.id === "SUN" ? "—" : fmtDistance(c.distLy)}</div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); onWarp(c.id); }} className="shrink-0 rounded-md border border-amber-300/50 bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-100">向かう</button>
          </div>
        ))}
      </div>
    </div>
  );
});

// ---------------- 設定 ----------------
export function SettingsPanel(p: {
  exposure: number; setExposure: (v: number) => void; fov: number; setFov: (v: number) => void;
  quality: number; setQuality: (v: number) => void; labels: boolean; setLabels: (b: boolean) => void;
  mode: "pc" | "mobile"; setMode: (m: "pc" | "mobile") => void; fps: number; onClose: () => void; compact: boolean;
}) {
  const row = "mb-3";
  return (
    <div className={`${glass} pointer-events-auto rounded-2xl p-4 ${p.compact ? "w-full" : "w-[340px]"}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-bold text-white">設定</div>
        <button onClick={p.onClose} className="rounded-md px-2 text-lg leading-none text-white/60 hover:bg-white/10">×</button>
      </div>
      <div className={row}>
        <div className="mb-1 flex justify-between text-xs text-white/70"><span>操作モード</span></div>
        <div className="grid grid-cols-2 gap-2">
          {(["pc", "mobile"] as const).map((m) => (
            <button key={m} onClick={() => p.setMode(m)} className={`rounded-lg border py-1.5 text-sm ${p.mode === m ? "border-cyan-300/70 bg-cyan-400/20 text-cyan-100" : "border-white/15 text-white/60"}`}>{m === "pc" ? "PCモード" : "スマホモード"}</button>
          ))}
        </div>
      </div>
      <div className={row}>
        <div className="mb-1 flex justify-between text-xs text-white/70"><span>露出（明るさ）</span><span>{p.exposure.toFixed(2)}</span></div>
        <input type="range" min={0.3} max={3} step={0.05} value={p.exposure} onChange={(e) => p.setExposure(parseFloat(e.target.value))} className="w-full accent-cyan-300" />
      </div>
      <div className={row}>
        <div className="mb-1 flex justify-between text-xs text-white/70"><span>視野角</span><span>{p.fov}°</span></div>
        <input type="range" min={35} max={100} step={1} value={p.fov} onChange={(e) => p.setFov(parseInt(e.target.value))} className="w-full accent-cyan-300" />
      </div>
      <div className={row}>
        <div className="mb-1 text-xs text-white/70">描画品質（粒子数）</div>
        <div className="grid grid-cols-3 gap-2">
          {[{ l: "軽量", v: 0.4 }, { l: "標準", v: 0.75 }, { l: "高品質", v: 1.2 }].map((o) => (
            <button key={o.l} onClick={() => p.setQuality(o.v)} className={`rounded-lg border py-1 text-sm ${p.quality === o.v ? "border-cyan-300/70 bg-cyan-400/20 text-cyan-100" : "border-white/15 text-white/60"}`}>{o.l}</button>
          ))}
        </div>
      </div>
      <div className={row}>
        <label className="flex items-center justify-between text-xs text-white/70">
          天体ラベルを表示
          <input type="checkbox" checked={p.labels} onChange={(e) => p.setLabels(e.target.checked)} className="h-4 w-4 accent-cyan-300" />
        </label>
      </div>
      <div className="text-[11px] text-white/40">FPS: {p.fps.toFixed(0)}　／　実際の天体写真は Wikipedia(Wikimedia Commons) から読み込み、地球から見た向きに重ね合わせます（オフライン時は観測データに基づく3Dモデルのみ）。</div>
    </div>
  );
}

// ---------------- ヘルプ ----------------
export function HelpPanel({ mode, onClose, compact }: { mode: "pc" | "mobile"; onClose: () => void; compact: boolean }) {
  const kb = (t: string) => <kbd className="rounded border border-white/25 bg-white/10 px-1.5 py-0.5 text-[11px] text-white">{t}</kbd>;
  return (
    <div className={`${glass} pointer-events-auto max-h-[75vh] overflow-y-auto rounded-2xl p-4 text-[12px] leading-relaxed text-white/80 ${compact ? "w-full" : "w-[400px]"}`}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-bold text-white">操作方法（{mode === "pc" ? "PCモード" : "スマホモード"}）</div>
        <button onClick={onClose} className="rounded-md px-2 text-lg leading-none text-white/60 hover:bg-white/10">×</button>
      </div>
      {mode === "pc" ? (
        <ul className="space-y-1.5">
          <li>{kb("ドラッグ")} 視点を回転 ／ {kb("クリック")} 天体を選択</li>
          <li>{kb("W")}{kb("S")} 前進・後退　{kb("A")}{kb("D")} 左右　{kb("R")}{kb("F")} 上昇・下降　{kb("Q")}{kb("E")} ロール</li>
          <li>{kb("Shift")} ブースト(×8)　{kb("X")} 急停止　{kb("Z")} オートクルーズ</li>
          <li>{kb("ホイール")} 速度（手動）/ 倍率（オート）を変更</li>
          <li>{kb("G")} 選択天体へオートパイロット　{kb("H")} 太陽へ帰還</li>
          <li>{kb("L")} ラベル切替　{kb("M")} カタログ　{kb("1")}〜{kb("4")} 速度プリセット</li>
        </ul>
      ) : (
        <ul className="space-y-1.5">
          <li>画面ドラッグ：視点を回転 ／ タップ：天体を選択</li>
          <li>左下のスティック：前進・後退・左右移動</li>
          <li>右下ボタン：▲上昇 ▼下降 ／ ブースト ／ 停止 ／ ロール</li>
          <li>下部の速度パネル：オート速度・スライダー・プリセット</li>
          <li>天体を選んで「ここへ向かう」でオートパイロット</li>
        </ul>
      )}
      <div className="mt-3 rounded-lg bg-white/5 p-2 text-[11px] text-white/60">
        速度のヒント：恒星間は「1〜1000 光年/秒」、銀河間は「100万〜1億 光年/秒」、宇宙初期の銀河までは「10億 光年/秒」以上が目安。オート速度は最寄りの天体までの距離に応じて自動調整されます。
        各天体は RA/Dec と距離（光行時間 = look-back time）に基づき配置されています。遠方の天体ほど「過去の姿」を見ています。
      </div>
    </div>
  );
}
