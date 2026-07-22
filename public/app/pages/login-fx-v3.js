// 登录页背景特效 v3：QUANTUM CORE / 量子黑洞
//
// 场景：深空星云 + 事件视界球 + 光子环 + GLSL 吸积盘（差速旋转 + 多普勒偏色 + FBM 湍流）+
//       GPU 螺旋下落粒子云 + 弯曲物质流。
// 后处理：Bloom + 屏幕中心径向引力扭曲 + 色差 + 暗角 + 胶片颗粒。
//
// API 与 v1/v2 一致：mount / unmount / pulse / flashError / focusBoost / renderForm。

import * as THREE from '../vendor/three.module.js';
import { EffectComposer } from '../vendor/three-addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three-addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three-addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/three-addons/postprocessing/ShaderPass.js';
import { OutputPass } from '../vendor/three-addons/postprocessing/OutputPass.js';

// ---------- 配置 ----------
const IS_MOBILE = typeof window !== 'undefined' && window.innerWidth < 640;
const INFALL_COUNT = IS_MOBILE ? 1500 : 4000;
const STAR_COUNT = IS_MOBILE ? 800 : 2000;
const BLOOM_STRENGTH = IS_MOBILE ? 0.32 : 0.42;
const BLOOM_RADIUS = 0.6;
const BLOOM_THRESHOLD = 0.72;

// ---------- 模块状态 ----------
let mounted = false;
let canvas = null;
let renderer = null;
let scene = null;
let camera = null;
let composer = null;
let bloomPass = null;
let postPass = null;
let rafHandle = 0;
let clock = null;

let nebula = null;
let horizon = null;
let photonRing = null;
let accretion = null;
let infall = null;
let streams = [];
let stars = null;
let holeGroup = null;

let pointer = { x: 0, y: 0 };
let smoothedTilt = { x: 0, y: 0 };
let targetTilt = { x: 0, y: 0 };
let spinBoost = 0;
let pulseEnergy = 0;
let flashRedTimer = 0;

const uTime = { value: 0 };

const disposers = [];
let frameSamples = [];
let downgraded = false;

// ---------- 登录框：六边形全息 HUD（V3 专属造型） ----------
export function renderForm({ container, boot }) {
  container.innerHTML = '';
  document.body.classList.remove('fx-v1', 'fx-v2');
  document.body.classList.add('fx-v3');

  const el = window.App.el;
  const errBox = el('div', { class: 'fx3-hud__err' });
  const uInput = el('input', {
    class: 'fx3-hud__input', type: 'text', autocomplete: 'username',
    placeholder: 'operator',
  });
  const pInput = el('input', {
    class: 'fx3-hud__input', type: 'password',
    autocomplete: boot ? 'new-password' : 'current-password',
    placeholder: '••••••••',
  });
  const defaultLabel = boot ? 'INITIALIZE CORE' : 'AUTHENTICATE';
  const btnLabel = el('span', { class: 'fx3-hud__btn-text' }, defaultLabel);
  const btn = el('button',
    { class: 'fx3-hud__btn', type: 'submit' },
    el('span', { class: 'fx3-hud__btn-scan' }),
    btnLabel,
    el('span', { class: 'fx3-hud__btn-arrow' }, '›'));

  // 四个直角切角标记
  const corners = ['tl', 'tr', 'bl', 'br'].map((k) =>
    el('span', { class: 'fx3-hud__corner fx3-hud__corner--' + k }));

  const head = el('div', { class: 'fx3-hud__head' },
    el('span', { class: 'fx3-hud__pip' }),
    el('span', { class: 'fx3-hud__tag' }, 'QUANTUM CORE'),
    el('span', { class: 'fx3-hud__meta' }, boot ? 'BOOTSTRAP' : 'IDENTITY'));

  const scan = el('div', { class: 'fx3-hud__scanbar' });

  const rowU = el('label', { class: 'fx3-hud__row' },
    el('span', { class: 'fx3-hud__label' }, 'OPERATOR // ID'),
    el('div', { class: 'fx3-hud__slot' },
      el('span', { class: 'fx3-hud__hex' }),
      uInput,
      el('span', { class: 'fx3-hud__bar' })));

  const rowP = el('label', { class: 'fx3-hud__row' },
    el('span', { class: 'fx3-hud__label' }, 'QUANTUM // KEY'),
    el('div', { class: 'fx3-hud__slot' },
      el('span', { class: 'fx3-hud__hex' }),
      pInput,
      el('span', { class: 'fx3-hud__bar' })));

  const panel = el('div', { class: 'fx3-hud__panel' },
    ...corners, head, scan, rowU, rowP, errBox, btn);
  const form = el('form', { class: 'fx3-shell' }, panel);
  container.appendChild(form);

  return {
    form, uInput, pInput, btn, errBox,
    setBusy(busy) {
      btn.disabled = busy;
      btn.classList.toggle('is-busy', busy);
      btnLabel.textContent = busy ? 'HANDSHAKING…' : defaultLabel;
    },
    showError(msg) { errBox.textContent = '! ANOMALY :: ' + msg; },
    clearError() { errBox.textContent = ''; },
  };
}

// ---------- 公开 API ----------
export function mount() {
  if (mounted) return;
  mounted = true;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    setupCanvas();
    setupScene();
    setupPostFx();
    setupContent();
    setupEvents();
  } catch (err) {
    console.warn('[login-fx-v3] init failed:', err);
    cleanup();
    return;
  }
  clock = new THREE.Clock();
  if (reduced) renderOnce();
  else tick();
}

export function unmount() {
  if (!mounted) return;
  mounted = false;
  cleanup();
}

export function pulse() { if (mounted) pulseEnergy = 1.0; }
export function flashError() { if (mounted) flashRedTimer = 0.35; }
export function focusBoost() { if (mounted) spinBoost = Math.max(spinBoost, 1.0); }

// ---------- 初始化 ----------
function setupCanvas() {
  canvas = document.createElement('canvas');
  canvas.id = 'login-fx-canvas';
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%',
    zIndex: '0', pointerEvents: 'none', display: 'block',
  });
  document.body.appendChild(canvas);
}

function setupScene() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 500);
  // 略微俯视，能同时看到吸积盘的椭圆感与前方光子环
  camera.position.set(0, 4.2, 22);
  camera.lookAt(0, 0, 0);
}

function setupPostFx() {
  composer = new EffectComposer(renderer);
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD,
  );
  composer.addPass(bloomPass);
  postPass = buildPostPass();
  composer.addPass(postPass);
  composer.addPass(new OutputPass());
}

function setupContent() {
  scene.add(buildNebula());
  holeGroup = new THREE.Group();
  // 盘倾角（世界系下，绕 X 轴倾斜）
  holeGroup.rotation.x = -0.28;
  scene.add(holeGroup);
  holeGroup.add(buildEventHorizon());
  holeGroup.add(buildPhotonRing());
  holeGroup.add(buildAccretionDisk());
  holeGroup.add(buildInfall());
  buildStreams().forEach((s) => holeGroup.add(s));
  scene.add(buildStars());
}

// ---------- 星云背景（BackSide 天球） ----------
function buildNebula() {
  const geo = new THREE.SphereGeometry(220, 40, 28);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime },
    vertexShader: /* glsl */`
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vPos;
      uniform float uTime;
      // 便宜的 3D value-noise + FBM，够给星云铺色
      float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float vnoise(vec3 p){
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float n = mix(
          mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
          f.z);
        return n;
      }
      float fbm(vec3 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.02; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 dir = normalize(vPos);
        // 大尺度星云（缓慢流动）
        float n = fbm(dir * 2.3 + vec3(0.0, uTime * 0.008, 0.0));
        float n2 = fbm(dir * 4.5 - vec3(uTime * 0.005, 0.0, 0.0));
        vec3 magenta = vec3(0.20, 0.02, 0.24);
        vec3 cyan    = vec3(0.02, 0.10, 0.20);
        vec3 base    = vec3(0.010, 0.010, 0.028);
        vec3 col = base;
        col = mix(col, magenta, smoothstep(0.42, 0.72, n));
        col = mix(col, cyan,    smoothstep(0.50, 0.85, n2) * 0.85);
        // 高频星点
        float s = hash(floor(dir * 260.0));
        col += vec3(smoothstep(0.997, 1.0, s)) * 1.1;
        // 中频微弱星
        float s2 = hash(floor(dir * 130.0) + 17.0);
        col += vec3(smoothstep(0.9975, 1.0, s2)) * 0.5;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  nebula = new THREE.Mesh(geo, mat);
  return nebula;
}

// ---------- 事件视界（实心黑球，遮挡后方吸积盘） ----------
function buildEventHorizon() {
  const geo = new THREE.SphereGeometry(2.6, 48, 36);
  // 完全不透明黑色，用于遮挡后方
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  horizon = new THREE.Mesh(geo, mat);
  return horizon;
}

// ---------- 光子环（细亮圈） ----------
function buildPhotonRing() {
  const geo = new THREE.TorusGeometry(2.85, 0.045, 12, 128);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        // 沿环带方向微弱亮暗调制
        float m = 0.75 + 0.25 * sin(vUv.x * 40.0 + uTime * 2.4);
        vec3 col = mix(vec3(0.35, 0.55, 0.75), vec3(0.70, 0.55, 0.30), 0.5 + 0.5 * sin(vUv.x * 6.28));
        gl_FragColor = vec4(col * m * 0.85, 0.80);
      }`,
  });
  photonRing = new THREE.Mesh(geo, mat);
  // 让光子环与盘同平面（水平）
  photonRing.rotation.x = -Math.PI / 2;
  return photonRing;
}

// ---------- 吸积盘：核心 shader，差速旋转 + 多普勒 + FBM 湍流 ----------
function buildAccretionDisk() {
  const geo = new THREE.RingGeometry(3.0, 11.5, 256, 8);
  // Ring 默认 uv：径向在 x（0=内 → 1=外），角向在 y；我们改用极坐标计算
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime,
      uInner: { value: 3.0 },
      uOuter: { value: 11.5 },
    },
    vertexShader: /* glsl */`
      varying vec2 vPos;
      void main() {
        vPos = position.xy; // 盘在本地 xy 平面
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vPos;
      uniform float uTime;
      uniform float uInner;
      uniform float uOuter;
      // 2D value noise
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
        return v;
      }
      void main() {
        float r = length(vPos);
        float ang = atan(vPos.y, vPos.x);
        // 归一化半径 0(内)→1(外)
        float t = (r - uInner) / (uOuter - uInner);
        if (t < 0.0 || t > 1.0) discard;

        // 差速旋转：内圈更快 (ω ∝ r^-1.5 like Keplerian)
        float omega = 1.6 / pow(max(r, 1.0), 1.2);
        float sw = ang + omega * uTime;

        // 湍流：把螺旋坐标输入 FBM
        vec2 nUv = vec2(cos(sw), sin(sw)) * (2.5 + 6.0 * t);
        float turb = fbm(nUv + vec2(uTime * 0.15, 0.0));
        float turb2 = fbm(nUv * 2.3 - vec2(0.0, uTime * 0.1));
        float band = 0.55 + 0.55 * turb + 0.35 * turb2;

        // 温度曲线：内热外冷（用 t 反向）
        float hot = 1.0 - t;
        vec3 cInner = vec3(1.0, 0.95, 0.75); // 近白
        vec3 cMid   = vec3(1.0, 0.55, 0.20); // 橙
        vec3 cOuter = vec3(0.55, 0.12, 0.35); // 暗粉
        vec3 col = mix(cOuter, cMid, smoothstep(0.0, 0.55, hot));
        col = mix(col, cInner, smoothstep(0.55, 1.0, hot));

        // 多普勒：正 x 方向靠近视点 → 变蓝变亮；负 x 方向远离 → 变红变暗
        // (盘倾角让 x 轴大致沿观察者切向，够近似)
        float doppler = cos(ang);
        vec3 blueShift = vec3(0.55, 0.75, 1.0);
        vec3 redShift  = vec3(0.60, 0.18, 0.10);
        col = mix(col, blueShift, max(doppler, 0.0) * 0.55);
        col = mix(col, redShift,  max(-doppler, 0.0) * 0.35);
        float brightness = 1.0 + doppler * 0.55;

        // 强度与透明度：内侧强，外侧收敛；沿径向 & 湍流带调制
        float intensity = band * brightness;
        // 内缘（贴近事件视界）也稍稍衰减一点，避免烧掉
        float innerFade = smoothstep(0.0, 0.08, t);
        // 外缘柔化
        float outerFade = smoothstep(1.0, 0.7, t);
        float a = innerFade * outerFade * (0.35 + 0.65 * band);

        // 高光丝：把湍流的高值加强，形成螺旋"火焰丝"
        float fila = pow(smoothstep(0.70, 1.0, band), 3.0);
        col += vec3(1.0, 0.85, 0.55) * fila * 0.35 * (0.4 + hot);

        // 整体亮度压制（避免刺眼），保留内热外冷的层次
        col *= 0.55;
        gl_FragColor = vec4(col * intensity, a);
      }`,
  });
  const disk = new THREE.Mesh(geo, mat);
  disk.rotation.x = -Math.PI / 2;
  accretion = disk;
  return disk;
}

// ---------- GPU 螺旋下落粒子云（Points + Shader） ----------
function buildInfall() {
  const geo = new THREE.BufferGeometry();
  // 每粒子属性：a=(r0, angle0, y0, speed)，b=(hue, life0, tiltAmp, size)
  const positions = new Float32Array(INFALL_COUNT * 3); // 占位（真实位置由 shader 计算，但仍需 position 属性）
  const aData = new Float32Array(INFALL_COUNT * 4);
  const bData = new Float32Array(INFALL_COUNT * 4);
  for (let i = 0; i < INFALL_COUNT; i++) {
    const r0 = 4.5 + Math.random() * 14;
    const angle0 = Math.random() * Math.PI * 2;
    const y0 = (Math.random() - 0.5) * 0.6 + (Math.random() < 0.15 ? (Math.random() - 0.5) * 2.5 : 0);
    const speed = 0.6 + Math.random() * 1.6;
    aData[i * 4]     = r0;
    aData[i * 4 + 1] = angle0;
    aData[i * 4 + 2] = y0;
    aData[i * 4 + 3] = speed;
    bData[i * 4]     = Math.random();          // hue seed
    bData[i * 4 + 1] = Math.random() * 10.0;   // life phase
    bData[i * 4 + 2] = 0.25 + Math.random() * 0.75; // tilt amp
    bData[i * 4 + 3] = 0.6 + Math.random() * 1.6;   // point size factor
    // 初始 position 值仅用于绑定，实际由 shader 覆盖
    positions[i * 3] = 0; positions[i * 3 + 1] = 0; positions[i * 3 + 2] = 0;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aData', new THREE.BufferAttribute(aData, 4));
  geo.setAttribute('bData', new THREE.BufferAttribute(bData, 4));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime,
      uPixel: { value: renderer.getPixelRatio() },
      uInner: { value: 3.0 },
    },
    vertexShader: /* glsl */`
      attribute vec4 aData;
      attribute vec4 bData;
      uniform float uTime;
      uniform float uPixel;
      uniform float uInner;
      varying float vHue;
      varying float vLife;
      void main() {
        float r0 = aData.x;
        float ang0 = aData.y;
        float y0 = aData.z;
        float speed = aData.w;
        float hue = bData.x;
        float phase = bData.y;
        float tilt = bData.z;
        float sizeF = bData.w;

        // 生命周期：从远处向内螺旋，落到 uInner 处消失并重生
        // 通过 fract() 循环时间参数
        float T = 12.0 / speed;
        float u = fract((uTime + phase) / T); // 0..1
        // 半径随 u 从 1 → 0（越接近内侧越靠近视界）
        float r = mix(uInner + 0.4, r0, 1.0 - u);
        // 差速旋转累计角度：内侧转得更快 → 螺旋
        float omega = 1.8 / pow(max(r, 1.0), 1.05);
        float ang = ang0 + omega * uTime * 3.0;
        // 垂直位置：随内落被压回盘面 (~0)
        float y = y0 * (1.0 - smoothstep(uInner + 0.2, r0 * 0.6, r)) * tilt;

        vec3 pos = vec3(cos(ang) * r, y, sin(ang) * r);

        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        // 距离衰减 + 命周期开头结尾都有一点淡入淡出
        float lifeFade = smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.9, u);
        float distSize = 400.0 / max(-mv.z, 1.0);
        gl_PointSize = distSize * sizeF * uPixel * (0.6 + (1.0 - u) * 1.5);
        vHue = hue;
        vLife = lifeFade * (0.4 + (1.0 - u) * 0.8);
      }`,
    fragmentShader: /* glsl */`
      varying float vHue;
      varying float vLife;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d) * vLife;
        // 蓝→白→橙 色带（越靠近内侧越白/蓝），整体压一档避免炫目
        vec3 c1 = vec3(0.30, 0.55, 0.85);
        vec3 c2 = vec3(0.85, 0.85, 0.80);
        vec3 c3 = vec3(0.85, 0.45, 0.20);
        vec3 col = mix(c1, c2, smoothstep(0.0, 0.5, vHue));
        col = mix(col, c3, smoothstep(0.55, 1.0, vHue));
        gl_FragColor = vec4(col * 0.65, a * 0.75);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  infall = pts;
  // 与盘同平面（本地系 y 轴指向盘法线）
  pts.rotation.x = -Math.PI / 2;
  return pts;
}

// ---------- 物质流（几条弯曲 Tube，从远处流向盘） ----------
function buildStreams() {
  const specs = [
    { start: new THREE.Vector3(-24,  8, -12), end: new THREE.Vector3(-7, 0.3, -1), color: 0x9ec7ff },
    { start: new THREE.Vector3( 22, -6,  10), end: new THREE.Vector3( 6, -0.4,  1), color: 0xffb680 },
    { start: new THREE.Vector3( -3, 16,  22), end: new THREE.Vector3( 1, 0.2,  6), color: 0xff70c8 },
  ];
  streams = specs.map((s) => {
    const mid = new THREE.Vector3().addVectors(s.start, s.end).multiplyScalar(0.5);
    mid.y += 1.4;
    mid.x += (Math.random() - 0.5) * 4;
    const curve = new THREE.CatmullRomCurve3([s.start, mid, s.end], false, 'catmullrom', 0.4);
    const geo = new THREE.TubeGeometry(curve, 96, 0.18, 12, false);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime, uColor: { value: new THREE.Color(s.color) } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uColor;
        void main() {
          // 沿管方向的能量流条纹
          float flow = fract(vUv.x * 3.0 - uTime * 0.7);
          float band = smoothstep(0.0, 0.3, flow) * smoothstep(1.0, 0.85, flow);
          // 管子横截面渐变（中心亮）
          float radial = 1.0 - abs(vUv.y - 0.5) * 2.0;
          // 头部（靠近盘）亮尾部渐弱
          float head = smoothstep(0.0, 0.85, vUv.x);
          float a = radial * (0.10 + band * 0.55) * head * 0.55;
          vec3 col = uColor * (0.45 + band * 0.85);
          gl_FragColor = vec4(col, a);
        }`,
    });
    return new THREE.Mesh(geo, mat);
  });
  return streams;
}

// ---------- 远景星点 ----------
function buildStars() {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  for (let i = 0; i < STAR_COUNT; i++) {
    // 球壳分布，避开中心视界区
    const r = 60 + Math.random() * 130;
    const u = Math.random(), v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    sizes[i] = Math.random() < 0.06 ? 1.6 + Math.random() * 1.2 : 0.6 + Math.random() * 0.6;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime, uPixel: { value: renderer.getPixelRatio() } },
    vertexShader: /* glsl */`
      attribute float aSize;
      uniform float uTime;
      uniform float uPixel;
      varying float vTwinkle;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPixel * 2.0;
        vTwinkle = 0.7 + 0.3 * sin(uTime * 2.0 + position.x * 5.0 + position.z * 3.0);
      }`,
    fragmentShader: /* glsl */`
      varying float vTwinkle;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d) * vTwinkle;
        gl_FragColor = vec4(vec3(0.9, 0.95, 1.0), a);
      }`,
  });
  stars = new THREE.Points(geo, mat);
  return stars;
}

// ---------- 后处理：引力透镜扭曲 + 色差 + 暗角 + 颗粒 + 闪光 ----------
function buildPostPass() {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime,
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uLens: { value: 0.18 },          // 屏幕中心引力扭曲强度
      uRgbShift: { value: 0.0018 },
      uVignette: { value: 0.62 },
      uGrain: { value: 0.045 },
      uExposure: { value: 0.62 },
      uFlash: { value: 0.0 },
      uRedFlash: { value: 0.0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform vec2 uResolution;
      uniform float uLens;
      uniform float uRgbShift;
      uniform float uVignette;
      uniform float uGrain;
      uniform float uExposure;
      uniform float uFlash;
      uniform float uRedFlash;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 uv = vUv;
        vec2 c = uv - 0.5;
        // 保持纵横比：让屏幕中心的引力核心呈圆形
        float aspect = uResolution.x / uResolution.y;
        vec2 ac = vec2(c.x * aspect, c.y);
        float d = length(ac);
        // 引力透镜：径向内拉，靠中心越强
        float pull = uLens / (d * d + 0.06);
        vec2 warp = uv - c * pull * 0.06;
        // 色差：越靠边越强
        float shift = uRgbShift * (1.0 + d * 3.0);
        float r = texture2D(tDiffuse, warp + vec2(shift, 0.0)).r;
        float g = texture2D(tDiffuse, warp).g;
        float b = texture2D(tDiffuse, warp - vec2(shift, 0.0)).b;
        vec3 col = vec3(r, g, b);
        col *= uExposure;
        // 暗角
        float vign = smoothstep(1.05, 0.15, d);
        col *= mix(1.0 - uVignette, 1.0, vign);
        // 胶片颗粒
        float grain = hash(uv * (1.0 + fract(uTime))) - 0.5;
        col += grain * uGrain;
        // 白色闪光
        col += uFlash;
        // 红色故障
        col.r += uRedFlash;
        col.gb *= (1.0 - uRedFlash * 0.35);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------- 事件 ----------
function setupEvents() {
  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloomPass.resolution.set(w, h);
    if (postPass) postPass.uniforms.uResolution.value.set(w, h);
    if (infall && infall.material) infall.material.uniforms.uPixel.value = renderer.getPixelRatio();
    if (stars && stars.material)  stars.material.uniforms.uPixel.value = renderer.getPixelRatio();
  };
  const onPointer = (e) => {
    const t = e.touches && e.touches[0];
    const cx = t ? t.clientX : e.clientX;
    const cy = t ? t.clientY : e.clientY;
    pointer.x = (cx / window.innerWidth) * 2 - 1;
    pointer.y = -((cy / window.innerHeight) * 2 - 1);
    targetTilt.y = pointer.x * 0.20;
    targetTilt.x = pointer.y * 0.10;
  };
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('touchmove', onPointer, { passive: true });
  disposers.push(() => window.removeEventListener('resize', onResize));
  disposers.push(() => window.removeEventListener('pointermove', onPointer));
  disposers.push(() => window.removeEventListener('touchmove', onPointer));
}

// ---------- 主循环 ----------
function tick() {
  rafHandle = requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  uTime.value = clock.elapsedTime;

  // 相机围绕视界的小幅漂移（视差）
  const lerp = 1 - Math.pow(0.001, dt);
  smoothedTilt.x += (targetTilt.x - smoothedTilt.x) * lerp;
  smoothedTilt.y += (targetTilt.y - smoothedTilt.y) * lerp;
  camera.position.x = smoothedTilt.y * 4;
  camera.position.y = 4.2 - smoothedTilt.x * 2.5;
  camera.lookAt(0, 0, 0);

  // 整个 hole 组慢速自转（让盘的"角度感"更强）
  if (holeGroup) {
    holeGroup.rotation.y += dt * (0.05 + spinBoost * 0.6);
  }
  if (nebula) {
    nebula.rotation.y += dt * 0.005;
  }
  if (stars) {
    stars.rotation.y += dt * 0.008;
  }

  bloomPass.strength = BLOOM_STRENGTH + pulseEnergy * 0.9 + spinBoost * 0.15;
  pulseEnergy = Math.max(0, pulseEnergy - dt * 2.4);
  spinBoost = Math.max(0, spinBoost - dt * 0.6);
  flashRedTimer = Math.max(0, flashRedTimer - dt);

  if (postPass) {
    postPass.uniforms.uFlash.value = pulseEnergy * 0.16;
    postPass.uniforms.uRedFlash.value = flashRedTimer / 0.35 * 0.45;
    // pulse 时引力透镜临时增强，形成"跃迁"感
    postPass.uniforms.uLens.value = 0.18 + pulseEnergy * 0.55;
    postPass.uniforms.uRgbShift.value = 0.0022 + spinBoost * 0.006 + pulseEnergy * 0.008;
  }

  composer.render();
  samplePerf(dt);
}

function renderOnce() {
  uTime.value = 0;
  composer.render();
}

// ---------- 性能自适应 ----------
function samplePerf(dt) {
  if (downgraded) return;
  frameSamples.push(dt);
  if (frameSamples.length > 60) frameSamples.shift();
  if (frameSamples.length === 60) {
    const avg = frameSamples.reduce((a, b) => a + b, 0) / 60;
    const fps = 1 / avg;
    if (fps < 40) {
      downgraded = true;
      bloomPass.strength = BLOOM_STRENGTH * 0.55;
      renderer.setPixelRatio(1);
      if (postPass) {
        postPass.uniforms.uGrain.value = 0.02;
        postPass.uniforms.uRgbShift.value = 0.0016;
        postPass.uniforms.uLens.value = 0.10;
      }
      console.info('[login-fx-v3] downgraded: avg fps', fps.toFixed(1));
    }
  }
}

// ---------- 清理 ----------
function cleanup() {
  if (rafHandle) cancelAnimationFrame(rafHandle);
  rafHandle = 0;
  disposers.forEach((fn) => { try { fn(); } catch {} });
  disposers.length = 0;

  if (scene) {
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
  }
  if (composer) composer.dispose && composer.dispose();
  if (renderer) {
    renderer.dispose();
    renderer.forceContextLoss && renderer.forceContextLoss();
  }
  if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
  canvas = null; renderer = null; scene = null; camera = null;
  composer = null; bloomPass = null; postPass = null;
  nebula = null; horizon = null; photonRing = null; accretion = null;
  infall = null; streams = []; stars = null; holeGroup = null;
  clock = null; frameSamples = []; downgraded = false;
}
