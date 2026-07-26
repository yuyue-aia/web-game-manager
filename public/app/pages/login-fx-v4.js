// 登录页背景特效 v4：GRAVITY FIELD / 引力场
// 独立视觉语言：液态银核心、轨道粒子与空间折线。保留登录页统一模块 API。

import * as THREE from '../vendor/three.module.js';
import { EffectComposer } from '../vendor/three-addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three-addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three-addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/three-addons/postprocessing/ShaderPass.js';
import { OutputPass } from '../vendor/three-addons/postprocessing/OutputPass.js';

const MOBILE = typeof window !== 'undefined' && window.innerWidth < 720;
const PARTICLE_COUNT = MOBILE ? 1800 : 5200;
const uTime = { value: 0 };

let mounted = false;
let canvas;
let renderer;
let scene;
let camera;
let composer;
let core;
let particleField;
let orbitGroup;
let postPass;
let clock;
let raf = 0;
let energy = 0;
let focusEnergy = 0;
let errorEnergy = 0;
let targetPointer = new THREE.Vector2();
let pointer = new THREE.Vector2();
const disposers = [];

export function renderForm({ container, boot }) {
  container.innerHTML = '';
  document.body.classList.remove('fx-v1', 'fx-v2', 'fx-v3');
  document.body.classList.add('fx-v4');

  const el = window.App.el;
  const errBox = el('div', { class: 'fx4-form__error', role: 'alert' });
  const uInput = el('input', {
    class: 'fx4-form__input', type: 'text', autocomplete: 'username',
    placeholder: '输入账号', 'aria-label': '账号',
  });
  const pInput = el('input', {
    class: 'fx4-form__input', type: 'password',
    autocomplete: boot ? 'new-password' : 'current-password',
    placeholder: boot ? '设置登录密码' : '输入密码', 'aria-label': '密码',
  });
  const defaultLabel = boot ? '创建管理员' : '进入控制台';
  const btnText = el('span', {}, defaultLabel);
  const btn = el('button', { class: 'fx4-form__submit', type: 'submit' },
    btnText,
    el('span', { class: 'fx4-form__arrow', 'aria-hidden': 'true' }, '↗'));

  const status = el('div', { class: 'fx4-form__status' },
    el('span', { class: 'fx4-form__status-dot' }),
    el('span', {}, boot ? 'INITIAL SETUP' : 'SYSTEM ONLINE'));
  const intro = el('div', { class: 'fx4-form__intro' },
    el('div', { class: 'fx4-form__eyebrow' }, 'PRIVATE ACCESS / 04'),
    el('h2', {}, boot ? '建立你的控制权限' : '欢迎回来'),
    el('p', {}, boot ? '创建首个管理员身份，开始管理游戏时间。' : '验证身份后，继续管理游戏时间与设备。'));
  const fields = el('div', { class: 'fx4-form__fields' },
    el('label', { class: 'fx4-form__field' },
      el('span', {}, '账号'), uInput),
    el('label', { class: 'fx4-form__field' },
      el('span', {}, '密码'), pInput));
  const footer = el('div', { class: 'fx4-form__footer' },
    el('span', {}, 'ENCRYPTED SESSION'),
    el('span', {}, 'GM—04'));
  const form = el('form', { class: 'fx4-shell' }, status, intro, fields, errBox, btn, footer);
  container.appendChild(form);

  return {
    form, uInput, pInput, btn, errBox,
    setBusy(busy) {
      btn.disabled = busy;
      btn.classList.toggle('is-busy', busy);
      btnText.textContent = busy ? '正在验证' : defaultLabel;
    },
    showError(msg) { errBox.textContent = msg; },
    clearError() { errBox.textContent = ''; },
  };
}

export function mount() {
  if (mounted) return;
  mounted = true;
  try {
    setupRenderer();
    setupScene();
    setupPost();
    setupEvents();
  } catch (err) {
    console.warn('[login-fx-v4] init failed:', err);
    cleanup();
    return;
  }
  clock = new THREE.Clock();
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) renderFrame(0);
  else tick();
}

export function unmount() {
  if (!mounted) return;
  mounted = false;
  cleanup();
}

export function pulse() { energy = 1; }
export function focusBoost() { focusEnergy = 1; }
export function flashError() { errorEnergy = 1; }

function setupRenderer() {
  canvas = document.createElement('canvas');
  canvas.id = 'login-fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%',
    display: 'block', zIndex: '0', pointerEvents: 'none',
  });
  document.body.appendChild(canvas);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x030507, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

function setupScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x030507, 0.035);
  camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 120);
  camera.position.set(0, 0, 18);

  const anchorX = MOBILE ? 0 : -3.5;
  orbitGroup = new THREE.Group();
  orbitGroup.position.x = anchorX;
  scene.add(orbitGroup);

  core = buildCore();
  orbitGroup.add(core);
  particleField = buildParticles();
  orbitGroup.add(particleField);
  buildOrbits().forEach((ring) => orbitGroup.add(ring));
  scene.add(buildDust());
  scene.add(buildBackdrop());
}

function buildCore() {
  const geometry = new THREE.IcosahedronGeometry(MOBILE ? 2.35 : 3.3, 28);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime,
      uEnergy: { value: 0 },
      uError: { value: 0 },
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      uniform float uEnergy;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying float vWave;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
      float noise(vec3 p) {
        vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      void main() {
        float slow = noise(normal * 2.3 + uTime * 0.16);
        float fine = sin(position.y * 3.4 + uTime * 0.9) * sin(position.x * 2.1 - uTime * 0.45);
        float wave = (slow - .5) * .7 + fine * .08 + uEnergy * .16;
        vec3 p = position + normal * wave;
        vNormal = normalize(normalMatrix * normal);
        vWorld = (modelMatrix * vec4(p,1.0)).xyz;
        vWave = slow;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uError;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying float vWave;
      void main() {
        vec3 eye = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - abs(dot(eye, normalize(vNormal))), 2.35);
        float band = .5 + .5 * sin(vWorld.y * 3.2 - uTime * .55 + vWave * 7.0);
        vec3 graphite = vec3(.015,.022,.026);
        vec3 silver = vec3(.60,.72,.75);
        vec3 electric = vec3(.12,.72,1.0);
        vec3 alarm = vec3(1.0,.08,.11);
        vec3 edge = mix(electric, alarm, uError);
        vec3 color = mix(graphite, silver, fresnel * .68 + band * .08);
        color += edge * pow(fresnel, 2.0) * (1.05 + band * .5);
        color += vec3(.8,.95,1.0) * pow(max(dot(eye, normalize(vNormal)), 0.0), 18.0) * .5;
        gl_FragColor = vec4(color, 1.0);
      }`,
  });
  return new THREE.Mesh(geometry, material);
}

function buildParticles() {
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const seeds = new Float32Array(PARTICLE_COUNT * 3);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const radius = 3.6 + Math.pow(Math.random(), 1.7) * 7.5;
    const angle = Math.random() * Math.PI * 2;
    const lift = (Math.random() - .5) * (1.2 + radius * .18);
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = lift;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    seeds[i * 3] = Math.random();
    seeds[i * 3 + 1] = .18 + Math.random() * .8;
    seeds[i * 3 + 2] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime, uEnergy: { value: 0 }, uError: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() } },
    vertexShader: /* glsl */`
      attribute vec3 aSeed;
      uniform float uTime;
      uniform float uEnergy;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float r = length(p.xz);
        float a = atan(p.z,p.x) + uTime * (.035 + aSeed.y * .085) + sin(r * .8 + uTime * .3) * .04;
        p.x = cos(a) * r;
        p.z = sin(a) * r;
        p.y += sin(a * (2.0 + aSeed.x * 3.0) + uTime * aSeed.y) * (.18 + aSeed.z * .55);
        p *= 1.0 + uEnergy * .055;
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPixelRatio * (1.1 + aSeed.x * 2.6 + uEnergy * 2.2) * (18.0 / -mv.z);
        vAlpha = .18 + aSeed.y * .72;
      }`,
    fragmentShader: /* glsl */`
      uniform float uError;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - .5);
        float a = smoothstep(.5,.08,d) * vAlpha;
        vec3 c = mix(vec3(.42,.84,1.0), vec3(1.0,.08,.12), uError);
        gl_FragColor = vec4(c, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

function buildOrbits() {
  const rings = [];
  const configs = [
    [4.4, .34, .08], [5.4, -.48, -.22], [6.8, .72, .28], [8.2, -.28, .62],
  ];
  configs.forEach(([radius, tilt, yaw], index) => {
    const curve = new THREE.EllipseCurve(0, 0, radius, radius * (.54 + index * .055), 0, Math.PI * 2);
    const points = curve.getPoints(180).map((p) => new THREE.Vector3(p.x, p.y, 0));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: index % 2 ? 0x4a6370 : 0x78dfff,
      transparent: true, opacity: index === 0 ? .32 : .14,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.LineLoop(geometry, material);
    line.rotation.x = tilt;
    line.rotation.y = yaw;
    line.userData.speed = (index % 2 ? -1 : 1) * (.018 + index * .006);
    rings.push(line);
  });
  return rings;
}

function buildDust() {
  const count = MOBILE ? 250 : 650;
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    data[i * 3] = (Math.random() - .5) * 36;
    data[i * 3 + 1] = (Math.random() - .5) * 22;
    data[i * 3 + 2] = -4 - Math.random() * 30;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0xa9d7e8, size: .025, transparent: true, opacity: .48, depthWrite: false,
  }));
}

function buildBackdrop() {
  const geometry = new THREE.PlaneGeometry(80, 50);
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime },
    vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: /* glsl */`
      uniform float uTime;
      void main(){
        vec2 uv=gl_FragCoord.xy/vec2(${Math.max(1, window.innerWidth).toFixed(1)},${Math.max(1, window.innerHeight).toFixed(1)});
        float grain=fract(sin(dot(floor(gl_FragCoord.xy*.5),vec2(12.9898,78.233))+uTime)*43758.5453);
        float glow=smoothstep(.9,.1,length(uv-vec2(.26,.52)));
        vec3 c=vec3(.006,.010,.012)+vec3(.012,.045,.065)*glow+grain*.008;
        gl_FragColor=vec4(c,1.0);
      }`,
    depthWrite: false,
  });
  const plane = new THREE.Mesh(geometry, material);
  plane.position.z = -32;
  return plane;
}

function setupPost() {
  composer = new EffectComposer(renderer);
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), MOBILE ? .48 : .62, .75, .42));
  postPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime, uEnergy: { value: 0 }, uError: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform float uEnergy;
      uniform float uError;
      varying vec2 vUv;
      void main(){
        vec2 p=vUv-.5;
        float pulse=sin(length(p)*38.0-uTime*5.0)*uEnergy*.0025;
        vec2 uv=vUv+normalize(p+vec2(.0001))*pulse;
        float shift=.0012+uEnergy*.004+uError*.006;
        float r=texture2D(tDiffuse,uv+vec2(shift,0)).r;
        vec4 base=texture2D(tDiffuse,uv);
        float b=texture2D(tDiffuse,uv-vec2(shift,0)).b;
        vec3 color=vec3(r,base.g,b);
        float vignette=smoothstep(.92,.28,length(p));
        color*=mix(.46,1.0,vignette);
        gl_FragColor=vec4(color,1.0);
      }`,
  });
  composer.addPass(postPass);
  composer.addPass(new OutputPass());
}

function setupEvents() {
  const onPointer = (event) => {
    targetPointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    targetPointer.y = -((event.clientY / window.innerHeight) * 2 - 1);
  };
  const onResize = () => {
    if (!renderer || !camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    composer?.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  disposers.push(() => window.removeEventListener('pointermove', onPointer));
  disposers.push(() => window.removeEventListener('resize', onResize));
}

function tick() {
  if (!mounted) return;
  renderFrame(Math.min(clock.getDelta(), .05));
  raf = requestAnimationFrame(tick);
}

function renderFrame(dt) {
  uTime.value += dt;
  energy = Math.max(0, energy - dt * 1.25);
  focusEnergy = Math.max(0, focusEnergy - dt * 1.8);
  errorEnergy = Math.max(0, errorEnergy - dt * 2.2);
  const active = Math.max(energy, focusEnergy * .35);
  pointer.lerp(targetPointer, .045);
  orbitGroup.rotation.x += ((pointer.y * .12) - orbitGroup.rotation.x) * .035;
  orbitGroup.rotation.y += ((pointer.x * .18) - orbitGroup.rotation.y) * .035;
  core.rotation.y += dt * (.08 + active * .5);
  core.rotation.z -= dt * .025;
  orbitGroup.children.forEach((child) => {
    if (child.userData.speed) child.rotation.z += dt * child.userData.speed;
  });
  core.material.uniforms.uEnergy.value = active;
  core.material.uniforms.uError.value = errorEnergy;
  particleField.material.uniforms.uEnergy.value = active;
  particleField.material.uniforms.uError.value = errorEnergy;
  postPass.uniforms.uEnergy.value = energy;
  postPass.uniforms.uError.value = errorEnergy;
  composer.render();
}

function cleanup() {
  cancelAnimationFrame(raf);
  disposers.splice(0).forEach((dispose) => dispose());
  if (scene) {
    scene.traverse((node) => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose?.());
      else node.material?.dispose?.();
    });
  }
  composer?.dispose?.();
  renderer?.dispose?.();
  canvas?.remove();
  canvas = renderer = scene = camera = composer = core = particleField = orbitGroup = postPass = clock = null;
  energy = focusEnergy = errorEnergy = 0;
}
