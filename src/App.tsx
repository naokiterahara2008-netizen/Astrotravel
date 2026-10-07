import { useCallback, useEffect, useRef, useState } from "react";
import { Universe, HudState } from "./engine/universe";
import { CATALOG, CatObj } from "./data/catalog";
import { fmtDistance } from "./lib/math";
import { CatalogPanel, HelpPanel, HoldButton, InfoCard, Joystick, SettingsPanel, SpeedPanel, glass } from "./components/ui";

type Mode = "pc" | "mobile";
type Panel = null | "list" | "settings" | "help";

function detectMode(): Mode {
  if (typeof window === "undefined") return "pc";
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  return coarse || window.innerWidth < 720 ? "mobile" : "pc";
}

export default function App() {
  const [phase, setPhase] = useState<"start" | "play">("start");
  const [mode, setMode] = useState<Mode>(detectMode);
  const [hud, setHud] = useState<HudState | null>(null);
  const [sel, setSel] = useState<CatObj | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [labels, setLabels] = useState(true);
  const [exposure, setExposure] = useState(1);
  const [fov, setFov] = useState(65);
  const [quality, setQuality] = useState<number>(() => (detectMode() === "mobile" ? 0.4 : 0.75));
  const [toast, setToast] = useState<string | null>(null);
  const contRef = useRef<HTMLDivElement>(null);
  const eng = useRef<Universe | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const qualityRef = useRef(quality);
  qualityRef.current = quality;

  const compact = mode === "mobile";

  useEffect(() => {
    if (phase !== "play" || !contRef.current) return;
    const u = new Universe({
      container: contRef.current,
      mode: modeRef.current,
      quality: qualityRef.current,
      onHud: setHud,
      onSelect: setSel,
    });
    eng.current = u;
    setToast(modeRef.current === "pc" ? "WASDで移動 / ドラッグで視点 / 天体をクリックして「ここへ向かう」" : "スティックで移動 / 画面ドラッグで視点 / 天体をタップして選択");
    const t = setTimeout(() => setToast(null), 6000);
    return () => {
      clearTimeout(t);
      u.dispose();
      eng.current = null;
    };
  }, [phase]);

  useEffect(() => { eng.current?.setExposure(exposure); }, [exposure, phase]);
  useEffect(() => { eng.current?.setFov(fov); }, [fov, phase]);
  useEffect(() => { eng.current?.setLabels(labels); }, [labels, phase]);
  useEffect(() => { eng.current?.setMode(mode); }, [mode, phase]);

  const goWarp = useCallback((id: string) => {
    eng.current?.select(id);
    eng.current?.warpTo(id);
  }, []);
  const pickCb = useCallback((id: string) => { eng.current?.select(id); }, []);
  const closePanel = useCallback(() => setPanel(null), []);
  const listWarp = useCallback((id: string) => {
    goWarp(id);
    if (modeRef.current === "mobile") setPanel(null);
  }, [goWarp]);

  useEffect(() => {
    if (phase !== "play") return;
    const kd = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.code === "KeyL") setLabels((v) => !v);
      else if (e.code === "KeyH") goWarp("SUN");
      else if (e.code === "KeyM") setPanel((p) => (p === "list" ? null : "list"));
      else if (e.code === "Escape") { setPanel(null); eng.current?.select(null); }
      else if (e.code === "Digit1") { eng.current?.setAuto(false); eng.current?.setLogSpeed(0); }
      else if (e.code === "Digit2") { eng.current?.setAuto(false); eng.current?.setLogSpeed(3); }
      else if (e.code === "Digit3") { eng.current?.setAuto(false); eng.current?.setLogSpeed(7); }
      else if (e.code === "Digit4") { eng.current?.setAuto(false); eng.current?.setLogSpeed(9.3); }
    };
    window.addEventListener("keydown", kd);
    return () => window.removeEventListener("keydown", kd);
  }, [phase, goWarp]);

  // ---------------- スタート画面 ----------------
  if (phase === "start") {
    const counts = {
      m: CATALOG.filter((c) => c.group === "M").length,
      c: CATALOG.filter((c) => c.group === "C").length,
      q: CATALOG.filter((c) => c.type === "QS").length,
      h: CATALOG.filter((c) => c.type === "HZ").length,
    };
    return (
      <div className="stars-bg relative flex h-full w-full items-center justify-center overflow-y-auto p-4">
        <div className="fade-up w-full max-w-2xl py-6 text-center">
          <div className="text-xs tracking-[0.5em] text-cyan-300/70">UNIVERSE FLIGHT SIMULATOR</div>
          <h1 className="mt-2 bg-gradient-to-b from-white to-cyan-200 bg-clip-text text-4xl font-black tracking-wider text-transparent sm:text-6xl">COSMIC VOYAGER</h1>
          <p className="mt-2 text-lg font-semibold text-white/90 sm:text-xl">138億光年の宇宙を、自由に旅しよう。</p>
          <p className="mx-auto mt-4 max-w-xl text-[13px] leading-relaxed text-white/60">
            メシエ天体 {counts.m}・コールドウェル天体 {counts.c}・著名なNGC天体・クエーサー {counts.q}・宇宙初期の銀河 {counts.h} などを、
            実際の赤経・赤緯と距離（光行時間 = look-back time）に基づいて配置。恒星間から宇宙論的スケールまで、
            状況に応じて速度を変えながら飛び回れます。天体は観測写真（Wikimedia）と形態データに基づいて描画します。
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4">
            {([
              { m: "pc" as const, t: "PCモード", d: "キーボード + マウス", i: "🖥️" },
              { m: "mobile" as const, t: "スマホモード", d: "タッチ操作 + 仮想スティック", i: "📱" },
            ]).map((o) => (
              <button
                key={o.m}
                onClick={() => { setMode(o.m); setQuality(o.m === "mobile" ? 0.4 : 0.75); }}
                className={`rounded-2xl border p-4 text-left transition ${mode === o.m ? "border-cyan-300/80 bg-cyan-400/15 shadow-[0_0_30px_rgba(80,200,255,0.25)]" : "border-white/15 bg-white/5 hover:bg-white/10"}`}
              >
                <div className="text-2xl">{o.i}</div>
                <div className="mt-1 text-base font-bold text-white">{o.t}</div>
                <div className="text-xs text-white/55">{o.d}</div>
              </button>
            ))}
          </div>
          <button
            onClick={() => setPhase("play")}
            className="mt-6 rounded-full border border-cyan-200/70 bg-gradient-to-r from-cyan-500/40 to-indigo-500/40 px-10 py-3 text-lg font-bold tracking-widest text-white shadow-[0_0_40px_rgba(90,180,255,0.35)] transition hover:scale-105"
          >
            出発する
          </button>
          <div className="mt-4 text-[11px] text-white/35">起動時に銀河系モデルを生成します（数秒かかる場合があります）</div>
        </div>
      </div>
    );
  }

  // ---------------- プレイ画面 ----------------
  const E = () => eng.current;
  const iconBtn = "pointer-events-auto rounded-xl border border-white/15 bg-slate-950/55 px-3 py-2 text-xs font-semibold text-white/85 backdrop-blur-md hover:bg-white/15 active:bg-cyan-400/30";
  const panelNode =
    panel === "list" ? (
      <CatalogPanel
        selId={sel?.id ?? null}
        compact={compact}
        onClose={closePanel}
        onPick={pickCb}
        onWarp={listWarp}
      />
    ) : panel === "settings" ? (
      <SettingsPanel
        exposure={exposure} setExposure={setExposure} fov={fov} setFov={setFov}
        quality={quality} setQuality={(v) => { setQuality(v); E()?.setQuality(v); }}
        labels={labels} setLabels={setLabels} mode={mode} setMode={setMode} fps={hud?.fps ?? 0}
        onClose={() => setPanel(null)} compact={compact}
      />
    ) : panel === "help" ? (
      <HelpPanel mode={mode} onClose={() => setPanel(null)} compact={compact} />
    ) : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <div ref={contRef} className="absolute inset-0" />

      {/* 照準 */}
      {mode === "pc" && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="h-5 w-5 rounded-full border border-white/25" />
          <div className="absolute left-1/2 top-1/2 h-0.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" />
        </div>
      )}

      {/* 左上: 現在地 */}
      <div className="pointer-events-none absolute left-2 top-2 max-w-[62%] sm:left-3 sm:top-3 sm:max-w-[340px]">
        <div className={`${glass} rounded-xl px-3 py-2`}>
          <div className="text-[10px] tracking-widest text-cyan-300/70">COSMIC VOYAGER</div>
          <div className="text-sm font-bold text-white">{hud?.context ?? "…"}</div>
          {hud && (
            <div className="mt-0.5 space-y-0.5 text-[11px] text-white/60">
              <div>太陽から {fmtDistance(hud.sunDist)}</div>
              {hud.nearestName && <div className="truncate">最寄り: {hud.nearestName}（{fmtDistance(hud.nearestEdge)}）</div>}
              {hud.warping && <div className="truncate text-amber-300">▶ オートパイロット: {hud.warpName}（残り {fmtDistance(hud.warpRemain)}）</div>}
              {hud.cruise && <div className="text-emerald-300">オートクルーズ中</div>}
            </div>
          )}
        </div>
        {!compact && sel && hud && (
          <div className="mt-2 w-[320px]">
            <InfoCard obj={sel} hud={hud} compact={false} onClose={() => E()?.select(null)} onWarp={() => goWarp(sel.id)} onStop={() => E()?.stopWarp()} />
          </div>
        )}
      </div>

      {/* 右上: メニュー */}
      <div className="absolute right-2 top-2 flex flex-wrap justify-end gap-1.5 sm:right-3 sm:top-3">
        <button className={iconBtn} onClick={() => setPanel(panel === "list" ? null : "list")}>🔭 天体</button>
        <button className={iconBtn} onClick={() => goWarp("SUN")}>🌍 帰還</button>
        <button className={`${iconBtn} ${labels ? "!border-cyan-300/50" : ""}`} onClick={() => setLabels(!labels)}>🏷️</button>
        <button className={iconBtn} onClick={() => setPanel(panel === "settings" ? null : "settings")}>⚙️</button>
        <button className={iconBtn} onClick={() => setPanel(panel === "help" ? null : "help")}>？</button>
      </div>

      {/* PCのパネル */}
      {!compact && panelNode && <div className="absolute right-3 top-14">{panelNode}</div>}

      {/* スマホのパネル（ボトムシート） / 情報カード */}
      {compact && panelNode && <div className="absolute inset-x-0 bottom-0 z-30 p-2">{panelNode}</div>}
      {compact && !panel && sel && hud && (
        <div className="absolute inset-x-2 top-24 z-20">
          <InfoCard obj={sel} hud={hud} compact onClose={() => E()?.select(null)} onWarp={() => goWarp(sel.id)} onStop={() => E()?.stopWarp()} />
        </div>
      )}

      {/* 下部: 速度パネル */}
      {hud && (
        <div className={`pointer-events-none absolute inset-x-0 flex justify-center px-2 ${compact ? "bottom-40" : "bottom-3"}`}>
          <SpeedPanel
            hud={hud} compact={compact}
            onAuto={(b) => E()?.setAuto(b)}
            onLog={(v) => E()?.setLogSpeed(v)}
            onMul={(v) => E()?.setAutoMul(v)}
            onPreset={(v) => { E()?.setAuto(false); E()?.setLogSpeed(v); }}
          />
        </div>
      )}

      {/* スマホ操作 */}
      {compact && !panel && (
        <>
          <div className="absolute bottom-4 left-4 z-10"><Joystick onMove={(x, z) => E()?.setMove(x, z)} /></div>
          <div className="absolute bottom-4 right-3 z-10 grid grid-cols-2 gap-2">
            <HoldButton onDown={() => E()?.setVertical(1)} onUp={() => E()?.setVertical(0)}>▲ 上昇</HoldButton>
            <HoldButton onDown={() => E()?.setBoost(true)} onUp={() => E()?.setBoost(false)} className="!border-amber-300/50 !bg-amber-400/15">🚀 ブースト</HoldButton>
            <HoldButton onDown={() => E()?.setVertical(-1)} onUp={() => E()?.setVertical(0)}>▼ 下降</HoldButton>
            <button className="select-none rounded-2xl border border-rose-300/40 bg-rose-500/15 px-3 py-3 text-sm font-semibold text-rose-100 active:bg-rose-500/40" onClick={() => E()?.brake()}>■ 停止</button>
            <HoldButton onDown={() => E()?.setRoll(-1)} onUp={() => E()?.setRoll(0)}>⟲ ロール</HoldButton>
            <HoldButton onDown={() => E()?.setRoll(1)} onUp={() => E()?.setRoll(0)}>ロール ⟳</HoldButton>
          </div>
        </>
      )}

      {/* PCヒント */}
      {!compact && (
        <div className="pointer-events-none absolute bottom-3 left-3 hidden text-[10px] leading-relaxed text-white/35 lg:block">
          WASD 移動 ・ R/F 上下 ・ Q/E ロール ・ Shift ブースト ・ ホイール 速度 ・ G 選択天体へ ・ H 帰還 ・ M カタログ ・ L ラベル
        </div>
      )}

      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-40 -translate-x-1/2 rounded-full border border-white/15 bg-black/60 px-4 py-2 text-center text-xs text-white/85 backdrop-blur-md fade-up">
          {toast}
        </div>
      )}
    </div>
  );
}
