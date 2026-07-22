// 登录页背景特效 v2：Synthwave / 赛博走廊
//
// 场景：紫粉黑天空球 + 复古横条纹太阳 + 波动无限网格地板 + 漂浮低多边形几何 +
//       数据流字符雨 + 星尘。后处理：Bloom + 色差 + 扫描线 + 暗角 + 胶片颗粒。
//
// API 与 v1 保持一致：mount / unmount / pulse / flashError / focusBoost。

import * as THREE from '../vendor/three.module.js';
import { EffectComposer } from '../vendor/three-addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three-addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three-addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/three-addons/postprocessing/ShaderPass.js';
import { OutputPass } from '../vendor/three-addons/postprocessing/OutputPass.js';

// ---------- 配置 ----------
const IS_MOBILE = typeof window !== 'undefined' && window.innerWidth < 640;
const STARDUST_COUNT = IS_MOBILE ? 400 : 1200;
const GLYPH_COLUMNS = IS_MOBILE ? 10 : 22;
const BLOOM_STRENGTH = IS_MOBILE ? 0.45 : 0.6;
const BLOOM_RADIUS = 0.6;
const BLOOM_THRESHOLD = 0.55;

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

let sky = null;
let sun = null;
let ground = null;
let polyhedra = [];
let glyphColumns = [];
let stardust = null;

let pointer = { x: 0, y: 0 };
let smoothedTilt = { x: 0, y: 0 };
let targetTilt = { x: 0, y: 0 };
let spinBoost = 0;
let pulseEnergy = 0;
let flashRedTimer = 0;

// 全局共享时间 uniform（多个 shader 共用同一个引用）
const uTime = { value: 0 };

const disposers = [];
let frameSamples = [];
let downgraded = false;

// ---------- 登录框：复古终端窗口（V2 专属造型） ----------
export function renderForm({ container, boot }) {
  container.innerHTML = '';
  document.body.classList.remove('fx-v1');
  document.body.classList.add('fx-v2');

  const el = window.App.el;
  const errBox = el('div', { class: 'fx2-term__err' });
  const uInput = el('input', {
    class: 'fx2-term__input', type: 'text', autocomplete: 'username',
    placeholder: 'guest',
  });
  const pInput = el('input', {
    class: 'fx2-term__input', type: 'password',
    autocomplete: boot ? 'new-password' : 'current-password',
    placeholder: '••••••',
  });
  const defaultText = boot ? '$ bootstrap --admin' : '$ execute --login';
  const btnLabel = el('span', { class: 'fx2-term__btn-text' }, defaultText);
  const btn = el('button',
    { class: 'fx2-term__btn', type: 'submit' },
    btnLabel,
    el('span', { class: 'fx2-term__caret' }, '▮'));

  const bar = el('div', { class: 'fx2-term__bar' },
    el('span', { class: 'fx2-term__dot fx2-term__dot--r' }),
    el('span', { class: 'fx2-term__dot fx2-term__dot--y' }),
    el('span', { class: 'fx2-term__dot fx2-term__dot--g' }),
    el('span', { class: 'fx2-term__title' },
      boot ? 'root@gm ~ / init.sh' : 'user@gm ~ / login.sh'));

  const body = el('div', { class: 'fx2-term__body' },
    el('pre', { class: 'fx2-term__line fx2-term__ghost' },
      '> initiating handshake…\n> awaiting credentials'),
    el('label', { class: 'fx2-term__field' },
      el('span', { class: 'fx2-term__prompt' }, '> user@'),
      uInput),
    el('label', { class: 'fx2-term__field' },
      el('span', { class: 'fx2-term__prompt' }, '> pass@'),
      pInput),
    errBox,
    btn);

  const win = el('div', { class: 'fx2-term' }, bar, body);
  const form = el('form', { class: 'fx2-shell' }, win);
  container.appendChild(form);

  return {
    form, uInput, pInput, btn, errBox,
    setBusy(busy) {
      btn.disabled = busy;
      btnLabel.textContent = busy ? '$ waiting for response…' : defaultText;
    },
    showError(msg) { errBox.textContent = '! ' + msg; },
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
    console.warn('[login-fx-v2] init failed:', err);
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

  // 相机：水平前视，微微俯视地板
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(0, 2.4, 14);
  camera.lookAt(0, 3, -10);
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
  scene.add(buildSky());
  scene.add(buildSun());
  scene.add(buildGround());
  buildPolyhedra().forEach((m) => scene.add(m));
  buildGlyphRain().forEach((s) => scene.add(s));
  scene.add(buildStardust());
}

// ---------- 天空球 ----------
function buildSky() {
  const geo = new THREE.SphereGeometry(200, 32, 24);
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
      // 简单 hash 加一点星尘噪声
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 dir = normalize(vPos);
        float t = dir.y * 0.5 + 0.5;                      // 0 底 → 1 顶
        vec3 top     = vec3(0.01, 0.01, 0.05);            // 更深紫黑
        vec3 mid     = vec3(0.14, 0.05, 0.28);            // 暗紫
        vec3 horizon = vec3(0.55, 0.10, 0.35);            // 暗粉
        vec3 col = t > 0.5 ? mix(mid, top, (t - 0.5) * 2.0)
                            : mix(horizon, mid, t * 2.0);
        // 天空高处撒些噪声星尘
        vec2 sp = dir.xy * 30.0;
        float s = smoothstep(0.997, 1.0, hash(floor(sp)));
        col += vec3(s) * smoothstep(0.2, 0.8, t);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  sky = new THREE.Mesh(geo, mat);
  return sky;
}

// ---------- 复古太阳（下半有横条纹）----------
function buildSun() {
  const geo = new THREE.CircleGeometry(16, 96);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
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
        vec2 p = vUv * 2.0 - 1.0;
        float d = length(p);
        if (d > 1.0) discard;
        // 上：粉→橙，下：橙→黄
        vec3 pink   = vec3(0.75, 0.20, 0.55);
        vec3 orange = vec3(0.75, 0.40, 0.20);
        vec3 yellow = vec3(0.80, 0.65, 0.25);
        float y = p.y;
        vec3 col = y > 0.0 ? mix(orange, pink, y) : mix(orange, yellow, -y);
        // 下半横条切割（越接近底部条纹越粗）
        if (y < 0.05) {
          float band = smoothstep(0.35, 0.55, fract(y * 9.0 + uTime * 0.15));
          float mask = smoothstep(0.05, -0.95, y);
          col *= mix(1.0, 0.0, band * mask * 0.9);
        }
        // 边缘柔化
        float alpha = smoothstep(1.0, 0.90, d);
        // 保持中等亮度，让 Bloom 只在核心处溢出
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  sun = new THREE.Mesh(geo, mat);
  sun.position.set(0, 6, -60);
  return sun;
}

// ---------- 网格地板（顶点起伏 + 距离渐变 + 前向流动）----------
function buildGround() {
  const geo = new THREE.PlaneGeometry(300, 300, 80, 80);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime },
    vertexShader: /* glsl */`
      varying float vDepth;
      varying vec2 vGridUv;
      uniform float uTime;
      void main() {
        vec3 pos = position;
        // 顶点起伏波（在平面自身空间；旋转后成为地板高低）
        float wave = sin(pos.x * 0.28 + uTime * 1.3) * 0.35
                   + sin(pos.y * 0.22 - uTime * 1.9) * 0.55
                   + sin((pos.x + pos.y) * 0.15 + uTime * 0.9) * 0.20;
        pos.z += wave;
        // 让"y 方向"的 uv 随时间前推，形成"网格流向观察者"的错觉
        vGridUv = vec2(pos.x, pos.y + uTime * 5.0);
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vGridUv;
      varying float vDepth;
      void main() {
        // 每 2 单位一条网格线
        vec2 g = abs(fract(vGridUv * 0.5) - 0.5);
        float lineX = 1.0 - smoothstep(0.0, 0.04, g.x);
        float lineY = 1.0 - smoothstep(0.0, 0.04, g.y);
        float line = max(lineX, lineY);
        // 距离色渐变：近暗粉，远暗紫
        vec3 near = vec3(0.70, 0.15, 0.55);
        vec3 far  = vec3(0.30, 0.05, 0.65);
        float t = smoothstep(2.0, 90.0, vDepth);
        vec3 col = mix(near, far, t);
        // 远处衰减到 0
        float fade = 1.0 - smoothstep(40.0, 140.0, vDepth);
        gl_FragColor = vec4(col * (0.6 + line * 0.9), line * fade * 0.6);
      }`,
  });
  ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -4.5;
  return ground;
}

// ---------- 漂浮低多边形几何 ----------
function buildPolyhedra() {
  const specs = [
    { geo: new THREE.IcosahedronGeometry(2.4, 0),                    color: 0x00e8ff, pos: [-11,  6, -22], orbitR: 1.5, orbitS: 0.45 },
    { geo: new THREE.OctahedronGeometry(1.7, 0),                     color: 0xff2ea6, pos: [ 11,  5, -18], orbitR: 1.3, orbitS: 0.55 },
    { geo: new THREE.TorusKnotGeometry(1.2, 0.30, 96, 12),           color: 0x8f00ff, pos: [  0, 11, -32], orbitR: 2.0, orbitS: 0.30 },
    { geo: new THREE.DodecahedronGeometry(1.5, 0),                   color: 0xffb247, pos: [-14,  2, -14], orbitR: 1.0, orbitS: 0.70 },
    { geo: new THREE.IcosahedronGeometry(1.0, 0),                    color: 0x00ff9c, pos: [ 14,  9, -25], orbitR: 1.4, orbitS: 0.50 },
    { geo: new THREE.TetrahedronGeometry(1.6, 0),                    color: 0xffffff, pos: [ -5,  9, -12], orbitR: 0.9, orbitS: 0.65 },
  ];
  polyhedra = specs.map((s) => {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(s.color).multiplyScalar(0.85),
      wireframe: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(s.geo, mat);
    mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
    mesh.userData = {
      base: new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2]),
      orbitR: s.orbitR,
      orbitS: s.orbitS,
      phase: Math.random() * Math.PI * 2,
      spinAxis: new THREE.Vector3(
        Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5,
      ).normalize(),
      spinRate: 0.4 + Math.random() * 0.8,
    };
    return mesh;
  });
  return polyhedra;
}

// ---------- 数据流字符雨 ----------
function buildGlyphRain() {
  const glyphs = '●○▲■◆◇×+△▽◁▷☆★♦♠♥♣▓░▒'.split('');
  const cols = [];
  const w = 64, h = 512;
  for (let i = 0; i < GLYPH_COLUMNS; i++) {
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d');
    ctx.font = 'bold 30px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rowCount = 16;
    // 从上到下：明→暗，颜色随机热色/冷色
    const hueSeed = 180 + Math.random() * 200;
    for (let r = 0; r < rowCount; r++) {
      const alpha = 1.0 - (r / rowCount) * 0.85;
      const light = 70 - r * 2.5;
      ctx.fillStyle = `hsla(${hueSeed + r * 3}, 100%, ${light}%, ${alpha.toFixed(3)})`;
      const ch = glyphs[(Math.random() * glyphs.length) | 0];
      ctx.fillText(ch, w / 2, h / rowCount * (r + 0.5));
    }
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.NormalBlending,
    });
    const sprite = new THREE.Sprite(mat);
    const spread = 44;
    const x = (i / (GLYPH_COLUMNS - 1) - 0.5) * spread;
    const z = -14 - Math.random() * 12;
    sprite.position.set(x, 8 + Math.random() * 30, z);
    sprite.scale.set(1.4, 10, 1);
    sprite.userData.speed = 3 + Math.random() * 6;
    sprite.userData.topY = 24;
    sprite.userData.bottomY = -16;
    cols.push(sprite);
  }
  glyphColumns = cols;
  return cols;
}

// ---------- 星尘 ----------
function buildStardust() {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(STARDUST_COUNT * 3);
  const colors = new Float32Array(STARDUST_COUNT * 3);
  const palette = [
    new THREE.Color(0xff2ea6), new THREE.Color(0x00e8ff),
    new THREE.Color(0xffb247), new THREE.Color(0x8f00ff),
    new THREE.Color(0xffffff),
  ];
  for (let i = 0; i < STARDUST_COUNT; i++) {
    // 星尘偏向上半空间与远景
    const r = 20 + Math.random() * 60;
    const theta = Math.random() * Math.PI * 2;
    const y = 3 + Math.random() * 40;
    const z = -20 - Math.random() * 80;
    positions[i * 3]     = Math.cos(theta) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z + Math.sin(theta) * r * 0.3;
    const c = palette[(Math.random() * palette.length) | 0];
    colors[i * 3]     = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.35, vertexColors: true, transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending,
    map: makeSoftDot(), alphaTest: 0.01, sizeAttenuation: true,
  });
  stardust = new THREE.Points(geo, mat);
  return stardust;
}

function makeSoftDot() {
  const size = 64;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- 后处理：色差 + 扫描线 + 暗角 + 胶片颗粒 + 闪光 ----------
function buildPostPass() {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime,
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uRgbShift: { value: 0.0018 },
      uScanIntensity: { value: 0.05 },
      uVignette: { value: 0.55 },
      uGrain: { value: 0.05 },
      uExposure: { value: 0.78 },
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
      uniform float uRgbShift;
      uniform float uScanIntensity;
      uniform float uVignette;
      uniform float uGrain;
      uniform float uExposure;
      uniform float uFlash;
      uniform float uRedFlash;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }
      void main() {
        vec2 uv = vUv;
        // 桶形轻微变形（CRT 感）
        vec2 cUv = uv - 0.5;
        float dist2 = dot(cUv, cUv);
        vec2 warped = uv + cUv * dist2 * 0.06;
        // RGB shift（越靠边缘越强）
        float d = length(cUv);
        float shift = uRgbShift * (1.0 + d * 3.0);
        float r = texture2D(tDiffuse, warped + vec2(shift, 0.0)).r;
        float g = texture2D(tDiffuse, warped).g;
        float b = texture2D(tDiffuse, warped - vec2(shift, 0.0)).b;
        vec3 col = vec3(r, g, b);
        // 整体曝光压制（简单的暗化），避免高光烧屏
        col *= uExposure;
        // 扫描线（动态）
        float scan = sin(warped.y * uResolution.y * 1.6 + uTime * 6.0) * uScanIntensity;
        col -= scan;
        // 竖向 CRT 幕栅（更细的高频调制）
        col *= 0.95 + 0.05 * sin(warped.x * uResolution.x * 3.14);
        // 暗角
        float vign = smoothstep(0.95, 0.15, d);
        col *= mix(1.0 - uVignette, 1.0, vign);
        // 胶片颗粒
        float grain = hash(uv * (1.0 + fract(uTime))) - 0.5;
        col += grain * uGrain;
        // 白色闪光（登录 pulse）
        col += uFlash;
        // 红色故障闪（登录失败）
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
  };
  const onPointer = (e) => {
    const t = e.touches && e.touches[0];
    const cx = t ? t.clientX : e.clientX;
    const cy = t ? t.clientY : e.clientY;
    pointer.x = (cx / window.innerWidth) * 2 - 1;
    pointer.y = -((cy / window.innerHeight) * 2 - 1);
    targetTilt.y = pointer.x * 0.12;
    targetTilt.x = pointer.y * 0.06;
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
  const t = uTime.value;

  // 视差
  const lerp = 1 - Math.pow(0.001, dt);
  smoothedTilt.x += (targetTilt.x - smoothedTilt.x) * lerp;
  smoothedTilt.y += (targetTilt.y - smoothedTilt.y) * lerp;
  camera.position.x = smoothedTilt.y * 4;
  camera.position.y = 2.4 - smoothedTilt.x * 3;
  camera.lookAt(0, 3 + smoothedTilt.x * 2, -10);

  animatePolyhedra(dt, t);
  animateGlyphs(dt);
  animateStardust(dt);

  // Bloom 强度：受 pulse 影响（基线已经压低）
  bloomPass.strength = BLOOM_STRENGTH + pulseEnergy * 0.9 + spinBoost * 0.12;
  pulseEnergy = Math.max(0, pulseEnergy - dt * 2.4);
  spinBoost = Math.max(0, spinBoost - dt * 0.6);
  flashRedTimer = Math.max(0, flashRedTimer - dt);

  if (postPass) {
    postPass.uniforms.uFlash.value = pulseEnergy * 0.14;
    postPass.uniforms.uRedFlash.value = flashRedTimer / 0.35 * 0.45;
    // 输入框聚焦时色差临时加强
    postPass.uniforms.uRgbShift.value = 0.0018 + spinBoost * 0.006;
  }

  composer.render();
  samplePerf(dt);
}

function renderOnce() {
  uTime.value = 0;
  animatePolyhedra(0, 0);
  composer.render();
}

function animatePolyhedra(dt, t) {
  polyhedra.forEach((m) => {
    const u = m.userData;
    // 沿轴自转
    m.rotateOnAxis(u.spinAxis, u.spinRate * dt * (1 + spinBoost * 1.5));
    // 轨道飘荡：绕 base 位置做小圆
    const a = t * u.orbitS + u.phase;
    m.position.x = u.base.x + Math.cos(a) * u.orbitR;
    m.position.y = u.base.y + Math.sin(a * 1.3) * u.orbitR * 0.6;
    m.position.z = u.base.z + Math.sin(a) * u.orbitR * 0.4;
  });
}

function animateGlyphs(dt) {
  glyphColumns.forEach((s) => {
    s.position.y -= s.userData.speed * dt;
    if (s.position.y < s.userData.bottomY) {
      s.position.y = s.userData.topY;
    }
  });
}

function animateStardust(dt) {
  if (!stardust) return;
  stardust.rotation.y += dt * 0.03;
  if (stardust.material) {
    stardust.material.opacity = 0.75 + Math.sin(uTime.value * 0.9) * 0.15;
  }
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
        postPass.uniforms.uGrain.value = 0.03;
        postPass.uniforms.uRgbShift.value = 0.0018;
      }
      console.info('[login-fx-v2] downgraded: avg fps', fps.toFixed(1));
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
  sky = null; sun = null; ground = null;
  polyhedra = []; glyphColumns = []; stardust = null;
  clock = null; frameSamples = []; downgraded = false;
}
