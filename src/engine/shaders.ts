import * as THREE from "three";

export interface GlobalUniforms {
  uPx: { value: number };
  uExp: { value: number };
  uMaxPx: { value: number };
  uViewport: { value: THREE.Vector2 };
}

// ---- 拡散光スプライト（銀河・星雲・ダスト） ----
const glowVert = /* glsl */ `
attribute vec4 aCol;
attribute float aSize;
uniform float uPx, uOpacity, uGain, uExp, uMaxPx, uView;
varying vec4 vCol;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float sc = length(modelMatrix[0].xyz);
  float rpx = aSize * sc * uPx / max(-mv.z, 1e-6);
  float a = aCol.a * uGain * uOpacity * uExp * uView;
  if (rpx < 1.0) { a *= rpx * rpx; rpx = 1.0; }
  if (rpx > uMaxPx) { a *= uMaxPx / rpx; rpx = uMaxPx; }
  // 極小アルファは8bit量子化で消えるため、確率的に間引いて明るさを保存する
  float h = fract(sin(float(gl_VertexID & 65535) * 12.9898 + float(gl_VertexID >> 16) * 78.233) * 43758.5453);
  const float THR = 0.04;
  if (a < THR) {
    if (h > a / THR) a = 0.0; else a = THR;
  }
  if (mv.z > -1e-6 || a <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vCol = vec4(0.0);
    return;
  }
  gl_PointSize = 2.0 * rpx;
  vCol = vec4(aCol.rgb, a);
  gl_Position = projectionMatrix * mv;
}`;
const glowFrag = /* glsl */ `
uniform float uSharp;
varying vec4 vCol;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float soft = exp(-3.5 * r2) * (1.0 - r2 * r2);
  float sharp = exp(-8.0 * r2);
  float f = mix(soft, sharp, uSharp);
  gl_FragColor = vec4(vCol.rgb, vCol.a * f);
}`;

// ---- 恒星（絶対等級から見かけの明るさを計算） ----
const starVert = /* glsl */ `
attribute vec4 aCol;
uniform float uPx, uOpacity, uGain, uExp;
varying vec4 vCol;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float sc = length(modelMatrix[0].xyz);
  float d = length(mv.xyz) / sc;
  float m = aCol.w + 2.1715 * log(max(d, 0.02) / 32.616);
  float f = exp(-0.9210 * (m - 6.0));
  float rpx = 0.85 + 0.9 * 0.4343 * log(1.0 + 5.0 * f);
  rpx = min(rpx, 12.0);
  float a = clamp(sqrt(3.0 * f), 0.0, 1.0) * uGain * uOpacity * uExp;
  float h = fract(sin(float(gl_VertexID & 65535) * 12.9898 + float(gl_VertexID >> 16) * 78.233) * 43758.5453);
  const float THR = 0.05;
  if (a < THR) {
    if (h > a / THR) a = 0.0; else a = THR;
  }
  if (mv.z > -1e-6 || a <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vCol = vec4(0.0);
    return;
  }
  gl_PointSize = 2.0 * rpx;
  vCol = vec4(aCol.rgb, a);
  gl_Position = projectionMatrix * mv;
}`;
const starFrag = /* glsl */ `
varying vec4 vCol;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float f = exp(-6.0 * r2) + 0.18 * exp(-2.0 * r2);
  gl_FragColor = vec4(vCol.rgb, vCol.a * f);
}`;

export function makeGlowMaterial(g: GlobalUniforms, opacity: { value: number }, gain: number, sharp: number, dust: boolean, view: { value: number }) {
  return new THREE.ShaderMaterial({
    vertexShader: glowVert,
    fragmentShader: glowFrag,
    uniforms: {
      uPx: g.uPx, uExp: g.uExp, uMaxPx: g.uMaxPx,
      uOpacity: opacity, uGain: { value: gain }, uSharp: { value: sharp }, uView: view,
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: dust ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
}

export function makeStarMaterial(g: GlobalUniforms, opacity: { value: number }, gain: number) {
  return new THREE.ShaderMaterial({
    vertexShader: starVert,
    fragmentShader: starFrag,
    uniforms: { uPx: g.uPx, uExp: g.uExp, uOpacity: opacity, uGain: { value: gain } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ---- 遠方インポスター（楕円スプライト）。視点に応じた傾き・扁平率を再現 ----
const impVert = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aPar;   // x: radius(world) / star px, y: thickness q, z: brightness, w: type
attribute vec3 aAxis;
attribute vec3 aCol;
uniform float uPx;
uniform vec2 uViewport;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
varying float vType;
varying float vSeed;
void main(){
  vec4 mv = viewMatrix * vec4(aPos, 1.0);
  float dist = length(mv.xyz);
  float type = aPar.w;
  bool starLike = type > 3.5 && type < 5.5;
  float pr = starLike ? aPar.x : aPar.x / max(dist, 1e-6) * uPx;
  float minPx = (type > 5.5) ? 2.2 : 2.6;
  float rpx = starLike ? pr * 2.6 : max(pr, minPx);
  float flux = starLike ? 1.0 : pow(clamp(pr / rpx, 0.3, 1.0), 0.5);
  vec3 n = normalize((viewMatrix * vec4(aAxis, 0.0)).xyz);
  vec3 v = -mv.xyz / max(dist, 1e-6);
  float cosi = abs(dot(n, v));
  float q = aPar.y;
  float ratio = sqrt(cosi*cosi + q*q*(1.0 - cosi*cosi));
  vec2 np = n.xy;
  float nl = length(np);
  vec2 minorDir = nl > 1e-4 ? np / nl : vec2(0.0, 1.0);
  vec2 majorDir = vec2(-minorDir.y, minorDir.x);
  if (starLike) ratio = 1.0;
  float rminor = max(rpx * ratio, 1.6);
  float ratioEff = rminor / rpx;
  vec2 c = position.xy;
  vec2 off = (majorDir * c.x * rpx + minorDir * c.y * rminor) * 1.25;
  vec4 clip = projectionMatrix * mv;
  clip.xy += off * 2.0 / uViewport * clip.w;
  gl_Position = clip;
  vUv = vec2(c.x, c.y / ratioEff * ratioEff) * 1.25;
  vUv.y = c.y * 1.25;
  vCol = aCol;
  vA = aPar.z * flux;
  vType = type;
  vSeed = fract(aPos.x * 0.0137 + aPos.y * 0.0071 + aPos.z * 0.0053) * 50.0;
}`;
const impFrag = /* glsl */ `
uniform float uExp;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
varying float vType;
varying float vSeed;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void main(){
  float r = length(vUv);
  float I = 0.0;
  float t = vType;
  if (t < 0.5) {            // 円盤銀河
    I = 0.8*exp(-4.5*r) + 1.3*exp(-80.0*r*r);
    I *= 1.0 - smoothstep(0.75, 1.05, r);
  } else if (t < 1.5) {     // 楕円銀河
    I = exp(-7.67*(pow(r/0.3 + 0.05, 0.25) - 1.0)) * 0.3;
    I *= 1.0 - smoothstep(0.7, 1.05, r);
  } else if (t < 2.5) {     // 球状星団
    I = 1.6 / pow(1.0 + pow(r/0.13, 2.0), 1.0);
    I *= 1.0 - smoothstep(0.6, 1.05, r);
  } else if (t < 3.5) {     // 星雲・散開星団など
    float n = vnoise(vUv*3.5 + vSeed);
    I = 0.9 * (1.0 - smoothstep(0.0, 1.0, r)) * (0.55 + 0.6*n);
  } else if (t < 4.5) {     // 恒星
    I = exp(-r*r*70.0) + 0.16*exp(-r*7.0);
    I *= 1.0 - smoothstep(0.8, 1.0, r);
  } else if (t < 5.5) {     // クエーサー
    float sp = 0.35*exp(-abs(vUv.y)*45.0)*exp(-abs(vUv.x)*4.0) + 0.35*exp(-abs(vUv.x)*45.0)*exp(-abs(vUv.y)*4.0);
    I = exp(-r*r*90.0) + 0.22*exp(-r*7.0) + sp;
    I *= 1.0 - smoothstep(0.85, 1.0, r);
  } else {                  // コンパクト天体 (遠方銀河)
    I = exp(-r*r*7.0);
  }
  I = 1.0 - exp(-I);
  gl_FragColor = vec4(vCol, I * vA * uExp);
}`;

export function makeImpostorMaterial(g: GlobalUniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: impVert,
    fragmentShader: impFrag,
    uniforms: { uPx: g.uPx, uExp: g.uExp, uViewport: { value: g.uViewport.value } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ---- 実観測画像（Wikipedia 等）のクワッド ----
const imgVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const imgFrag = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity, uExp;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(uMap, vUv).rgb;
  c = max(c - 0.035, 0.0) * 1.08;
  vec2 q = abs(vUv - 0.5) * 2.0;
  float edge = (1.0 - smoothstep(0.78, 1.0, q.x)) * (1.0 - smoothstep(0.78, 1.0, q.y));
  gl_FragColor = vec4(c, uOpacity * edge * min(uExp, 1.6));
}`;

export function makeImageMaterial(g: GlobalUniforms, tex: THREE.Texture, opacity: { value: number }) {
  return new THREE.ShaderMaterial({
    vertexShader: imgVert,
    fragmentShader: imgFrag,
    uniforms: { uMap: { value: tex }, uOpacity: opacity, uExp: g.uExp },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}
