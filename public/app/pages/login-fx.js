// 登录页背景特效：巨型浮空游戏手柄 + 霓虹赛博 · three.js
//
// 单入口 ES module，供 login.js 动态 import。
//   const fx = await import('/pages/login-fx.js');
//   fx.mount();  fx.unmount();  fx.pulse();  fx.flashError();
//
// 生命周期：mount() 创建 canvas 追加到 body、启动 rAF；unmount() 释放 GL 并移除 DOM。
// 降级：prefers-reduced-motion → 只渲一帧静态；WebGL 初始化失败 → 静默返回，卡片仍可用。

import * as THREE from '../vendor/three.module.js';
import { EffectComposer } from '../vendor/three-addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three-addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three-addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three-addons/postprocessing/OutputPass.js';

// ---------- 配置 ----------
const NEON_CYAN = 0x00e6ff;
const NEON_MAGENTA = 0xff1e9b;
const NEON_YELLOW = 0xffe93d;
const NEON_PURPLE = 0x8a4bff;
const NEON_LIME = 0xa8ff3e;

const IS_MOBILE = typeof window !== 'undefined' && window.innerWidth < 640;
const STAR_COUNT = IS_MOBILE ? 800 : 2000;
const PARTICLE_COUNT = IS_MOBILE ? 300 : 600;
// Bloom：只让"很亮"的像素辉光，避免把整个手柄烧白
const BLOOM_STRENGTH = IS_MOBILE ? 0.55 : 0.75;
const BLOOM_RADIUS = 0.55;
const BLOOM_THRESHOLD = 0.55;
// 动画节奏
const SPIN_BASE = 0.35;        // 手柄基础自转速度（rad/s）——原来 0.08 太慢
const SWAY_YAW_AMP = 0.35;
const SWAY_PITCH_AMP = 0.22;
const BOB_AMP = 0.45;

// ---------- 模块状态 ----------
let mounted = false;
let canvas = null;
let renderer = null;
let scene = null;
let camera = null;
let composer = null;
let bloomPass = null;
let rafHandle = 0;
let clock = null;

let gamepadGroup = null;      // 主体手柄 Group，所有零件都是它的子节点
let aButton = null;           // 单独引用便于"按下 A 键"动画
let leftStick = null;
let rightStick = null;
let particles = null;         // Points 云（粒子层）
let particleData = null;      // {velocities: Float32Array, base: Float32Array}
let stars = null;
let nebulas = [];             // 星云 sprite 列表

let pointer = { x: 0, y: 0 };
let targetTilt = { x: 0, y: 0 };
let smoothedTilt = { x: 0, y: 0 };
let spinBoost = 0;            // 输入框聚焦时抬升的自转
let pulseEnergy = 0;          // 登录按钮按下时爆发的能量
let flashRedTimer = 0;        // 登录失败时手柄闪红的剩余秒数

// 性能自适应
let frameSamples = [];
let downgraded = false;

// 事件解绑句柄
const disposers = [];

// ---------- 登录框：便携游戏机主机（V1 专属造型） ----------
export function renderForm({ container, boot }) {
  container.innerHTML = '';
  document.body.classList.remove('fx-v2');
  document.body.classList.add('fx-v1');

  const el = window.App.el;
  const errBox = el('div', { class: 'fx1-console__err' });
  const uInput = el('input', {
    class: 'fx1-console__input', type: 'text', autocomplete: 'username',
    placeholder: 'ENTER · 3~32 CHARS',
  });
  const pInput = el('input', {
    class: 'fx1-console__input', type: 'password',
    autocomplete: boot ? 'new-password' : 'current-password',
    placeholder: '••••••••',
  });
  const defaultText = boot ? 'BOOTSTRAP' : 'PRESS START';
  const btnLabel = el('span', { class: 'fx1-power__label' }, defaultText);
  const btn = el('button',
    { class: 'fx1-power', type: 'submit' },
    el('span', { class: 'fx1-power__ring' }),
    btnLabel);

  const top = el('div', { class: 'fx1-console__top' },
    el('span', { class: 'fx1-console__led' }),
    el('span', { class: 'fx1-console__brand' },
      boot ? 'SYSTEM · BOOT MODE' : '游戏管家 · GAME MANAGER'),
    el('span', { class: 'fx1-console__battery' },
      el('i'), el('i'), el('i')));

  const screen = el('div', { class: 'fx1-console__screen' },
    el('div', { class: 'fx1-console__row' },
      el('span', { class: 'fx1-console__lbl' }, 'PLAYER · ID'),
      uInput),
    el('div', { class: 'fx1-console__row' },
      el('span', { class: 'fx1-console__lbl' }, 'ACCESS · KEY'),
      pInput),
    errBox);

  const console_ = el('div', { class: 'fx1-console' }, top, screen, btn);
  const form = el('form', { class: 'fx1-shell' }, console_);
  container.appendChild(form);

  return {
    form, uInput, pInput, btn, errBox,
    setBusy(busy) {
      btn.disabled = busy;
      btnLabel.textContent = busy ? 'LOADING…' : defaultText;
    },
    showError(msg) { errBox.textContent = msg; },
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
    setupPostprocessing();
    setupSceneContent();
    setupEvents();
  } catch (err) {
    // GL 初始化失败：静默降级为纯 CSS 深色背景，登录卡片仍可用
    console.warn('[login-fx] init failed, falling back to css:', err);
    cleanup();
    return;
  }

  clock = new THREE.Clock();
  if (reduced) {
    // 只渲一帧静态画面
    renderOnce();
  } else {
    tick();
  }
}

export function unmount() {
  if (!mounted) return;
  mounted = false;
  cleanup();
}

/** 登录按钮按下：手柄 A 键闪一下 + 粒子爆发 */
export function pulse() {
  if (!mounted) return;
  pulseEnergy = 1.0;
}

/** 登录失败：手柄整体闪红 300ms */
export function flashError() {
  if (!mounted) return;
  flashRedTimer = 0.3;
}

/** 输入框获得焦点：自转加速 2 秒然后回落 */
export function focusBoost() {
  if (!mounted) return;
  spinBoost = Math.max(spinBoost, 1.0);
}

// ---------- 初始化 ----------

function setupCanvas() {
  canvas = document.createElement('canvas');
  canvas.id = 'login-fx-canvas';
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    zIndex: '0',
    pointerEvents: 'none',
    display: 'block',
  });
  document.body.appendChild(canvas);
}

function setupScene() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050614, 0.018);

  // 相机朝下微俯视手柄。拉远视距，让"巨型手柄环绕卡片"的构图能装进画面
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 3.5, 34);
  camera.lookAt(0, 0.5, 0);
}

function setupPostprocessing() {
  composer = new EffectComposer(renderer);
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
}

function setupSceneContent() {
  scene.add(buildStars());
  buildNebulas().forEach((n) => scene.add(n));
  gamepadGroup = buildGamepad();
  scene.add(gamepadGroup);
  scene.add(buildParticles());
}

// ---------- 天幕：星点（每颗有独立闪烁相位 + 缓慢漂移）----------
let starPhases = null;   // Float32Array，每颗星的初始相位
let starDrift = null;    // Float32Array，每颗星的漂移速度（弱）
function buildStars() {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const phases = new Float32Array(STAR_COUNT);
  const drift = new Float32Array(STAR_COUNT * 3);
  const palette = [
    new THREE.Color(0xffffff), new THREE.Color(0xb0e8ff), new THREE.Color(0xffd4f2),
    new THREE.Color(0xffef9e), new THREE.Color(0xc8a8ff),
  ];
  for (let i = 0; i < STAR_COUNT; i++) {
    // 球壳分布，避开相机附近
    const r = 40 + Math.random() * 60;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi) - 20;
    const c = palette[(Math.random() * palette.length) | 0];
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    phases[i] = Math.random() * Math.PI * 2;
    // 极弱的独立漂移，方向随机
    drift[i * 3 + 0] = (Math.random() - 0.5) * 0.4;
    drift[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
    drift[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
  }
  starPhases = phases;
  starDrift = drift;
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.55,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    map: makeSoftDotTexture(),
    alphaTest: 0.01,
  });
  stars = new THREE.Points(geo, mat);
  return stars;
}

// ---------- 星云：三片大 sprite ----------
function buildNebulas() {
  const list = [];
  const configs = [
    { color: NEON_CYAN,    pos: [-18, 6, -10],  size: 42, opacity: 0.28 },
    { color: NEON_MAGENTA, pos: [ 20, -4, -14], size: 48, opacity: 0.32 },
    { color: NEON_YELLOW,  pos: [  4, 12, -20], size: 36, opacity: 0.20 },
  ];
  configs.forEach((cfg) => {
    const tex = makeRadialGradientTexture(cfg.color);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: cfg.opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    sprite.scale.set(cfg.size, cfg.size, 1);
    sprite.userData.baseAngle = Math.random() * Math.PI * 2;
    sprite.userData.orbitR = 1.5 + Math.random() * 2;
    sprite.userData.orbitSpeed = 0.03 + Math.random() * 0.04;
    sprite.userData.base = sprite.position.clone();
    list.push(sprite);
  });
  nebulas = list;
  return list;
}

function makeRadialGradientTexture(colorHex) {
  const c = new THREE.Color(colorHex);
  const size = 256;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const rgb = `${(c.r * 255) | 0}, ${(c.g * 255) | 0}, ${(c.b * 255) | 0}`;
  grad.addColorStop(0.0, `rgba(${rgb}, 1)`);
  grad.addColorStop(0.35, `rgba(${rgb}, 0.55)`);
  grad.addColorStop(0.75, `rgba(${rgb}, 0.15)`);
  grad.addColorStop(1.0, `rgba(${rgb}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- 手柄：所有零件手工拼装 ----------
function buildGamepad() {
  const g = new THREE.Group();
  // 尺寸参考：整个手柄跨度约 14 单位（世界空间），相机 z=18 → 视场高约 18*tan(27.5°)≈9.4，占屏约 55%

  // ---- 主体：两个球（把手）+ 中间连接体 ----
  // 线框 + 极淡半透明填充。填充只做"实体感"，不发光
  const bodyColor = NEON_CYAN;
  const bodyMat = wireframeMat(bodyColor, 1.0);
  // 用非常深的底色填充，避免 additive 叠加烧白
  const bodyFillMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x0a1230),
    transparent: true,
    opacity: 0.55,
    blending: THREE.NormalBlending,
    depthWrite: true,
    side: THREE.FrontSide,
  });

  const leftGrip = new THREE.Mesh(new THREE.SphereGeometry(2.0, 24, 18), bodyMat);
  leftGrip.position.set(-4.2, -1.4, 0);
  leftGrip.scale.set(1.15, 1.35, 1.15);
  const leftGripFill = new THREE.Mesh(leftGrip.geometry, bodyFillMat);
  leftGripFill.position.copy(leftGrip.position);
  leftGripFill.scale.copy(leftGrip.scale);
  g.add(leftGrip, leftGripFill);

  const rightGrip = new THREE.Mesh(new THREE.SphereGeometry(2.0, 24, 18), bodyMat);
  rightGrip.position.set(4.2, -1.4, 0);
  rightGrip.scale.set(1.15, 1.35, 1.15);
  const rightGripFill = new THREE.Mesh(rightGrip.geometry, bodyFillMat);
  rightGripFill.position.copy(rightGrip.position);
  rightGripFill.scale.copy(rightGrip.scale);
  g.add(rightGrip, rightGripFill);

  // 中央面板（扁平椭球）
  const centerGeo = new THREE.SphereGeometry(3.2, 32, 20);
  const center = new THREE.Mesh(centerGeo, bodyMat);
  center.scale.set(1.9, 0.85, 0.6);
  center.position.set(0, 0, 0);
  const centerFill = new THREE.Mesh(centerGeo, bodyFillMat);
  centerFill.scale.copy(center.scale);
  centerFill.position.copy(center.position);
  g.add(center, centerFill);

  // ---- 左：十字方向键 ----
  const dpadGroup = new THREE.Group();
  dpadGroup.position.set(-3.4, 0.4, 1.6);
  const dpadMat = glowMat(NEON_YELLOW, 0.9);
  const dpadWire = wireframeMat(NEON_YELLOW, 1.0);
  const dpadArm = (dx, dy, sx, sy) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.5), dpadMat);
    mesh.position.set(dx, dy, 0);
    const wire = new THREE.Mesh(mesh.geometry, dpadWire);
    wire.position.copy(mesh.position);
    dpadGroup.add(mesh, wire);
  };
  dpadArm(0, 0.7, 0.55, 1.4);   // 上
  dpadArm(0, -0.7, 0.55, 1.4);  // 下
  dpadArm(-0.7, 0, 1.4, 0.55);  // 左
  dpadArm(0.7, 0, 1.4, 0.55);   // 右
  // 中心圆点
  const dpadCenter = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.55, 16), glowMat(NEON_YELLOW, 1.4));
  dpadCenter.rotation.x = Math.PI / 2;
  dpadGroup.add(dpadCenter);
  g.add(dpadGroup);

  // ---- 右：四个圆键（△○×□ 布局） ----
  const buttonsGroup = new THREE.Group();
  buttonsGroup.position.set(3.4, 0.4, 1.6);
  const buttonRing = (x, y, colorHex, isA) => {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 20, 14),
      glowMat(colorHex, 1.8),
    );
    bulb.position.set(x, y, 0.1);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.07, 12, 24),
      wireframeMat(colorHex, 1.0),
    );
    ring.position.set(x, y, 0);
    buttonsGroup.add(bulb, ring);
    return { bulb, ring };
  };
  buttonRing(0, 0.9, NEON_LIME, false);         // 上
  buttonRing(0.9, 0, NEON_MAGENTA, false);      // 右
  buttonRing(0, -0.9, NEON_CYAN, false);        // 下
  const aBtn = buttonRing(-0.9, 0, NEON_YELLOW, true); // 左 = A
  aButton = aBtn.bulb;
  aButton.userData.baseIntensity = 1.8;
  g.add(buttonsGroup);

  // ---- 中央按钮：Select / Start + Home ----
  const smallBtn = (x, colorHex) => {
    const m = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.18, 0.5, 4, 8),
      glowMat(colorHex, 1.2),
    );
    m.rotation.z = Math.PI / 2;
    m.position.set(x, -0.5, 1.4);
    return m;
  };
  g.add(smallBtn(-0.9, NEON_MAGENTA));
  g.add(smallBtn(0.9, NEON_MAGENTA));
  const homeBtn = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.42, 24),
    glowMat(NEON_MAGENTA, 1.5),
  );
  homeBtn.position.set(0, -0.5, 1.5);
  g.add(homeBtn);
  const homeCore = new THREE.Mesh(
    new THREE.CircleGeometry(0.18, 20),
    glowMat(NEON_CYAN, 1.5),
  );
  homeCore.position.set(0, -0.5, 1.51);
  g.add(homeCore);

  // ---- 摇杆 ----
  const buildStick = (x) => {
    const grp = new THREE.Group();
    // 底座
    const base = new THREE.Mesh(
      new THREE.TorusGeometry(0.75, 0.15, 12, 28),
      wireframeMat(NEON_MAGENTA, 1.0),
    );
    base.rotation.x = Math.PI / 2;
    grp.add(base);
    // 立柱
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.35, 0.7, 16),
      glowMat(NEON_CYAN, 1.4),
    );
    post.position.y = 0.35;
    // 用 rotation：让立柱竖直（模型建立在 xz 平面，我们的手柄整体面向 z+，所以立柱要沿 z）
    post.rotation.x = Math.PI / 2;
    post.position.set(0, 0, 0.35);
    grp.add(post);
    // 顶部球
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 18, 14),
      glowMat(NEON_CYAN, 1.6),
    );
    cap.position.set(0, 0, 0.75);
    grp.add(cap);
    // 顶部线框描边
    const capWire = new THREE.Mesh(cap.geometry, wireframeMat(NEON_CYAN, 1.0));
    capWire.position.copy(cap.position);
    grp.add(capWire);
    grp.position.set(x, -1.5, 1.3);
    return grp;
  };
  leftStick = buildStick(-1.4);
  rightStick = buildStick(1.4);
  g.add(leftStick, rightStick);

  // ---- 顶部肩键 LB / RB ----
  const shoulder = (x, colorHex) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.5, 0.9),
      glowMat(colorHex, 0.8),
    );
    const wire = new THREE.Mesh(mesh.geometry, wireframeMat(colorHex, 1.0));
    mesh.position.set(x, 1.9, 0.6);
    wire.position.copy(mesh.position);
    mesh.rotation.x = -0.3;
    wire.rotation.x = -0.3;
    g.add(mesh, wire);
  };
  shoulder(-3.6, NEON_MAGENTA);
  shoulder(3.6, NEON_MAGENTA);

  // 触发键 LT/RT（更小的胶囊，靠后）
  const trigger = (x, colorHex) => {
    const geo = new THREE.CapsuleGeometry(0.35, 0.9, 6, 12);
    const mesh = new THREE.Mesh(geo, glowMat(colorHex, 0.9));
    const wire = new THREE.Mesh(geo, wireframeMat(colorHex, 1.0));
    mesh.position.set(x, 2.4, -0.2);
    wire.position.copy(mesh.position);
    mesh.rotation.x = 0.6;
    wire.rotation.x = 0.6;
    g.add(mesh, wire);
  };
  trigger(-3.6, NEON_PURPLE);
  trigger(3.6, NEON_PURPLE);

  // 整体位姿：巨大 + 微微下沉。scale 让把手宽度突破卡片左右边缘。
  g.position.set(0, -1.2, 0);
  g.scale.setScalar(2.0);
  // 基础前倾角度，让手柄稍微俯视，观感更立体（每帧动画会叠加在此基础上）
  g.userData.baseTiltX = -0.28;

  return g;
}

/** 线框材质（纯自发光，交给 Bloom 处理） */
function wireframeMat(colorHex, intensity) {
  // intensity 用来控制辉光强度：> Bloom 阈值(0.55) 才会发光
  const col = new THREE.Color(colorHex).multiplyScalar(Math.max(intensity, 1.0));
  return new THREE.MeshBasicMaterial({
    color: col,
    wireframe: true,
    transparent: true,
    opacity: 0.95,
    // 关键：线框不用 additive，避免多层叠加烧成白色；用 Normal blending
    blending: THREE.NormalBlending,
    depthWrite: false,
    depthTest: true,
  });
}

/** 高强度发光材质：用于按键球、Home 按钮、摇杆帽等真正"亮"的点 */
function glowMat(colorHex, intensity) {
  const col = new THREE.Color(colorHex).multiplyScalar(intensity);
  return new THREE.MeshBasicMaterial({
    color: col,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

// ---------- 粒子层：绕手柄向上升腾 + 整体缓慢自转 ----------
function buildParticles() {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const velocities = new Float32Array(PARTICLE_COUNT * 3);
  const life = new Float32Array(PARTICLE_COUNT);      // 剩余寿命（秒）
  const maxLife = new Float32Array(PARTICLE_COUNT);   // 总寿命
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const palette = [
    new THREE.Color(NEON_CYAN), new THREE.Color(NEON_MAGENTA),
    new THREE.Color(NEON_YELLOW), new THREE.Color(NEON_PURPLE),
  ];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    initParticle(i, positions, velocities, life, maxLife, /*randomLife=*/ true);
    const c = palette[(Math.random() * palette.length) | 0];
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.35,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    map: makeSoftDotTexture(),
    alphaTest: 0.01,
  });
  particles = new THREE.Points(geo, mat);
  particleData = { velocities, life, maxLife };
  return particles;
}

/** 在一个环形区域内 spawn 一颗粒子，向上升腾并带有轻微径向扩散 */
function initParticle(i, positions, velocities, life, maxLife, randomLife) {
  const ix = i * 3, iy = ix + 1, iz = ix + 2;
  // 环形起点：手柄底部附近的一圈
  const r = 3 + Math.random() * 8;
  const theta = Math.random() * Math.PI * 2;
  positions[ix] = Math.cos(theta) * r;
  positions[iy] = -6 - Math.random() * 3;           // 从下方开始
  positions[iz] = Math.sin(theta) * r * 0.6 - 1;
  // 速度：主向上 + 轻微径向外扩 + 随机侧向漂移
  velocities[ix] = Math.cos(theta) * 0.25 + (Math.random() - 0.5) * 0.4;
  velocities[iy] = 0.8 + Math.random() * 0.9;       // 向上升
  velocities[iz] = Math.sin(theta) * 0.15 + (Math.random() - 0.5) * 0.3;
  const total = 6 + Math.random() * 5;              // 6~11 秒寿命
  maxLife[i] = total;
  life[i] = randomLife ? Math.random() * total : total;
}

/** 圆形软粒子贴图，避免默认方块像素感 */
function makeSoftDotTexture() {
  const size = 64;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
  };
  const onPointer = (e) => {
    const t = e.touches && e.touches[0];
    const cx = t ? t.clientX : e.clientX;
    const cy = t ? t.clientY : e.clientY;
    pointer.x = (cx / window.innerWidth) * 2 - 1;
    pointer.y = -((cy / window.innerHeight) * 2 - 1);
    targetTilt.y = pointer.x * 0.11;   // yaw
    targetTilt.x = pointer.y * 0.08;   // pitch
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
  const t = clock.elapsedTime;

  animateGamepad(dt, t);
  animateParticles(dt);
  animateNebulas(dt, t);
  animateStars(dt, t);

  // Bloom 强度：受 pulse 影响
  bloomPass.strength = BLOOM_STRENGTH + pulseEnergy * 1.4;
  pulseEnergy = Math.max(0, pulseEnergy - dt * 2.4);
  spinBoost = Math.max(0, spinBoost - dt * 0.6);
  flashRedTimer = Math.max(0, flashRedTimer - dt);

  composer.render();
  samplePerf(dt);
}

function renderOnce() {
  animateGamepad(0.016, 0);
  animateParticles(0.016);
  composer.render();
}

function animateGamepad(dt, t) {
  if (!gamepadGroup) return;
  // 明显的摇摆 + 悬浮
  const swayY = Math.sin(t * 0.55) * SWAY_YAW_AMP;
  const swayX = Math.sin(t * 0.42 + 1.7) * SWAY_PITCH_AMP;
  const bob = Math.sin(t * 0.9) * BOB_AMP;
  // 视差
  const lerpAmt = 1 - Math.pow(0.001, dt);
  smoothedTilt.x += (targetTilt.x - smoothedTilt.x) * lerpAmt;
  smoothedTilt.y += (targetTilt.y - smoothedTilt.y) * lerpAmt;

  const spin = (SPIN_BASE + spinBoost * 0.8) * t;
  const baseTilt = gamepadGroup.userData.baseTiltX || 0;
  gamepadGroup.rotation.x = baseTilt + swayX + smoothedTilt.x;
  gamepadGroup.rotation.y = swayY + smoothedTilt.y + spin;
  gamepadGroup.rotation.z = Math.sin(t * 0.6 + 0.5) * 0.08;
  gamepadGroup.position.y = -0.5 + bob;

  // 摇杆微微自转
  if (leftStick) leftStick.rotation.z = Math.sin(t * 0.9) * 0.25;
  if (rightStick) rightStick.rotation.z = Math.sin(t * 0.9 + Math.PI) * 0.25;

  // A 键脉冲（登录按下时）— 每帧从纯色重乘出当前强度
  if (aButton) {
    const base = aButton.userData.baseIntensity || 1.8;
    const flash = base + pulseEnergy * 3.5 + Math.sin(t * 3) * 0.15;
    aButton.material.color.setHex(NEON_YELLOW).multiplyScalar(flash);
    aButton.scale.setScalar(1 + pulseEnergy * 0.5);
  }

  // 登录失败：整个手柄闪红（通过 bloomPass 强度 + fog 兼作暗示，避免破坏材质基色）
  // 用一个红色雾气 sprite 效果太重，这里改为整体轻微色偏 —— 靠 scene.background 或直接跳过。
  // 简化：只让 A 键与 Home 键短暂改为红色（可控且不影响其他）
  if (flashRedTimer > 0 && aButton) {
    aButton.material.color.setHex(0xff2a2a).multiplyScalar(3.0);
  }
}

function animateParticles(dt) {
  if (!particles || !particleData) return;
  const pos = particles.geometry.attributes.position.array;
  const vel = particleData.velocities;
  const life = particleData.life;
  const maxLife = particleData.maxLife;
  const burst = pulseEnergy;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const ix = i * 3, iy = ix + 1, iz = ix + 2;
    // 位置积分
    pos[ix] += vel[ix] * dt;
    pos[iy] += vel[iy] * dt;
    pos[iz] += vel[iz] * dt;
    // 生命消耗；到期后重新从底部 spawn
    life[i] -= dt;
    if (life[i] <= 0 || pos[iy] > 12) {
      initParticle(i, pos, vel, life, maxLife, false);
      continue;
    }
    // 爆发：把当前粒子从中心（0,0,0）向外径向加速
    if (burst > 0.01) {
      const px = pos[ix], py = pos[iy], pz = pos[iz];
      const pl = Math.hypot(px, py, pz) + 1e-4;
      pos[ix] += (px / pl) * burst * 8 * dt;
      pos[iy] += (py / pl) * burst * 8 * dt;
      pos[iz] += (pz / pl) * burst * 8 * dt;
    }
  }
  particles.geometry.attributes.position.needsUpdate = true;
  // 整体缓慢自转，让即使漂移慢的粒子也能被眼睛捕捉到运动
  particles.rotation.y += dt * 0.08;
}

function animateNebulas(dt, t) {
  nebulas.forEach((s) => {
    const a = s.userData.baseAngle + t * s.userData.orbitSpeed;
    const r = s.userData.orbitR;
    s.position.x = s.userData.base.x + Math.cos(a) * r;
    s.position.y = s.userData.base.y + Math.sin(a) * r * 0.6;
  });
}

function animateStars(dt, t) {
  if (!stars) return;
  // 整体缓慢旋转
  stars.rotation.y += dt * 0.05;
  stars.rotation.x += dt * 0.015;
  // 每颗独立漂移（写入 position）
  const pos = stars.geometry.attributes.position.array;
  const drift = starDrift;
  if (drift) {
    for (let i = 0; i < STAR_COUNT; i++) {
      const ix = i * 3;
      pos[ix]     += drift[ix]     * dt;
      pos[ix + 1] += drift[ix + 1] * dt;
      pos[ix + 2] += drift[ix + 2] * dt;
    }
    stars.geometry.attributes.position.needsUpdate = true;
  }
  // 呼吸整体亮度 + 每颗独立闪烁靠 shader/attribute 太重，这里用整层 opacity 波动足以营造闪烁感
  if (stars.material) {
    stars.material.opacity = 0.7 + Math.sin(t * 1.1) * 0.18;
  }
}

// ---------- 性能采样 & 自适应降级 ----------
function samplePerf(dt) {
  if (downgraded) return;
  frameSamples.push(dt);
  if (frameSamples.length > 60) frameSamples.shift();
  if (frameSamples.length === 60) {
    const avg = frameSamples.reduce((a, b) => a + b, 0) / 60;
    const fps = 1 / avg;
    if (fps < 40) {
      downgraded = true;
      bloomPass.strength = BLOOM_STRENGTH * 0.5;
      renderer.setPixelRatio(1);
      console.info('[login-fx] downgraded: avg fps', fps.toFixed(1));
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

  canvas = null;
  renderer = null;
  scene = null;
  camera = null;
  composer = null;
  bloomPass = null;
  gamepadGroup = null;
  aButton = null;
  leftStick = null;
  rightStick = null;
  particles = null;
  particleData = null;
  stars = null;
  starPhases = null;
  starDrift = null;
  nebulas = [];
  clock = null;
  frameSamples = [];
  downgraded = false;
}
