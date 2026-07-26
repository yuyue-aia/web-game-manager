// 登录页 V1：GLASS CORE / 玻璃核心
// 深蓝硬件空间、透明晶体核心与磁悬浮控制节点。

import * as THREE from '../vendor/three.module.js';

const MOBILE = typeof window !== 'undefined' && window.innerWidth < 720;
let mounted = false;
let canvas, renderer, scene, camera, coreGroup, crystal, innerCore, orbiters = [], dust, clock, raf = 0;
let energy = 0, focus = 0, error = 0;
const crystalUniforms = {
  time: { value: 0 }, energy: { value: 0 }, error: { value: 0 },
};
const pointer = new THREE.Vector2();
const pointerTarget = new THREE.Vector2();
const disposers = [];

export function renderForm({ container, boot }) {
  container.innerHTML = '';
  document.body.classList.remove('fx-v2', 'fx-v3', 'fx-v4', 'fx-v5');
  document.body.classList.add('fx-v1');
  const el = window.App.el;
  const errBox = el('div', { class: 'fx1x-error', role: 'alert' });
  const uInput = el('input', {
    class: 'fx1x-input', type: 'text', autocomplete: 'username',
    placeholder: '账号', 'aria-label': '账号',
  });
  const pInput = el('input', {
    class: 'fx1x-input', type: 'password', autocomplete: boot ? 'new-password' : 'current-password',
    placeholder: '密码', 'aria-label': '密码',
  });
  const label = boot ? '创建管理员' : '进入';
  const btnLabel = el('span', {}, label);
  const btn = el('button', { class: 'fx1x-submit', type: 'submit' }, btnLabel);
  const form = el('form', { class: 'fx1x-shell' },
    el('div', { class: 'fx1x-signal', 'aria-hidden': 'true' },
      el('i'), el('i'), el('i')),
    el('div', { class: 'fx1x-fields' },
      el('label', { class: 'fx1x-field' }, uInput),
      el('label', { class: 'fx1x-field' }, pInput)),
    errBox,
    btn,
    el('div', { class: 'fx1x-rail', 'aria-hidden': 'true' }, el('i'), el('i')));
  container.appendChild(form);
  return {
    form, uInput, pInput, btn, errBox,
    setBusy(busy) {
      btn.disabled = busy;
      btn.classList.toggle('is-busy', busy);
      btnLabel.textContent = busy ? '处理中' : label;
    },
    showError(msg) { errBox.textContent = msg; },
    clearError() { errBox.textContent = ''; },
  };
}

export function mount() {
  if (mounted) return;
  mounted = true;
  try { setupRenderer(); setupScene(); setupEvents(); }
  catch (err) { console.warn('[login-fx-v1] init failed:', err); cleanup(); return; }
  clock = new THREE.Clock();
  renderFrame(0);
  requestAnimationFrame(() => { if (canvas) canvas.style.opacity = '1'; });
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) tick();
}

export function unmount() { if (!mounted) return; mounted = false; cleanup(); }
export function pulse() { energy = 1; }
export function focusBoost() { focus = 1; }
export function flashError() { error = 1; }

function setupRenderer() {
  canvas = document.createElement('canvas');
  canvas.id = 'login-fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '0',
    pointerEvents: 'none', opacity: '0', transition: 'opacity .45s ease',
  });
  document.body.appendChild(canvas);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBILE ? 1.35 : 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.setClearColor(0x050817, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
}

function setupScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050817, .043);
  camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .1, 80);
  camera.position.set(0, 0, 14);

  scene.add(new THREE.AmbientLight(0x5064ff, 1.3));
  const cyan = new THREE.PointLight(0x36e4ff, 45, 24); cyan.position.set(-4, 4, 6); scene.add(cyan);
  const magenta = new THREE.PointLight(0xff3dbf, 32, 22); magenta.position.set(5, -3, 5); scene.add(magenta);

  coreGroup = new THREE.Group();
  coreGroup.position.set(MOBILE ? 0 : -3.25, MOBILE ? 2.45 : 0, -1);
  scene.add(coreGroup);

  const crystalGeometry = new THREE.IcosahedronGeometry(MOBILE ? 2.15 : 3.15, 3);
  const crystalMaterial = new THREE.ShaderMaterial({
    uniforms: crystalUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec3 normalView; varying vec3 worldPos; varying vec3 localPos;
      void main(){
        normalView=normalize(normalMatrix*normal);
        worldPos=(modelMatrix*vec4(position,1.0)).xyz;
        localPos=position;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float time; uniform float energy; uniform float error;
      varying vec3 normalView; varying vec3 worldPos; varying vec3 localPos;
      void main(){
        vec3 eye=normalize(cameraPosition-worldPos);
        float fresnel=pow(1.0-abs(dot(eye,normalize(normalView))),2.25);
        float facet=.5+.5*sin(localPos.y*3.2+localPos.x*1.7+time*.28);
        vec3 cyan=vec3(.18,.78,1.0), violet=vec3(.60,.24,1.0), pink=vec3(1.0,.18,.66);
        vec3 color=mix(cyan,violet,facet); color=mix(color,pink,fresnel*.35);
        color=mix(color,vec3(1.0,.06,.08),error*.8);
        float alpha=.035+fresnel*(.46+energy*.18)+facet*.035;
        gl_FragColor=vec4(color*(.72+fresnel*1.25),alpha);
      }`,
  });
  crystal = new THREE.Mesh(crystalGeometry, crystalMaterial);
  crystal.rotation.set(.35, -.2, .12);
  coreGroup.add(crystal);

  innerCore = new THREE.Mesh(
    new THREE.OctahedronGeometry(MOBILE ? .72 : 1.05, 2),
    new THREE.MeshStandardMaterial({ color: 0x4b7cff, emissive: 0x153dff, emissiveIntensity: 2.5, roughness: .28, metalness: .4 }),
  );
  coreGroup.add(innerCore);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(crystalGeometry, 18),
    new THREE.LineBasicMaterial({ color: 0x8ae8ff, transparent: true, opacity: .38, blending: THREE.AdditiveBlending }),
  );
  coreGroup.add(edge);

  buildOrbiters();
  dust = buildDust();
  scene.add(dust);
}

function buildOrbiters() {
  const colors = [0x42e8ff, 0xff4fca, 0xa795ff, 0xffffff];
  const count = MOBILE ? 5 : 8;
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(
      i % 2 ? new THREE.SphereGeometry(.11, 18, 18) : new THREE.BoxGeometry(.18, .18, .18),
      new THREE.MeshStandardMaterial({ color: colors[i % colors.length], emissive: colors[i % colors.length], emissiveIntensity: 1.4, roughness: .2 }),
    );
    mesh.userData = { angle: i / count * Math.PI * 2, radius: (MOBILE ? 3 : 4.35) + (i % 3) * .32, speed: .16 + i * .012, lift: (i % 4 - 1.5) * .72 };
    coreGroup.add(mesh); orbiters.push(mesh);
  }
  [0, 1].forEach((i) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry((MOBILE ? 2.75 : 4.05) + i * .42, .012, 6, 160),
      new THREE.MeshBasicMaterial({ color: i ? 0xff4fca : 0x42e8ff, transparent: true, opacity: .28 }),
    );
    ring.rotation.set(.8 + i * .34, .28, i * .5);
    coreGroup.add(ring);
  });
}

function buildDust() {
  const count = MOBILE ? 280 : 800;
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    points[i * 3] = (Math.random() - .5) * 28;
    points[i * 3 + 1] = (Math.random() - .5) * 18;
    points[i * 3 + 2] = -3 - Math.random() * 18;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x75dfff, size: .026, transparent: true, opacity: .5, depthWrite: false }));
}

function setupEvents() {
  const move = (event) => pointerTarget.set(event.clientX / innerWidth * 2 - 1, -(event.clientY / innerHeight * 2 - 1));
  const resize = () => {
    if (!renderer) return;
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
  };
  addEventListener('pointermove', move, { passive: true });
  addEventListener('resize', resize, { passive: true });
  disposers.push(() => removeEventListener('pointermove', move), () => removeEventListener('resize', resize));
}

function tick() { if (!mounted) return; renderFrame(Math.min(clock.getDelta(), .05)); raf = requestAnimationFrame(tick); }

function renderFrame(dt) {
  crystalUniforms.time.value += dt;
  energy = Math.max(0, energy - dt * 1.25);
  focus = Math.max(0, focus - dt * 1.45);
  error = Math.max(0, error - dt * 2.2);
  pointer.lerp(pointerTarget, .045);
  coreGroup.rotation.x += (pointer.y * .16 - coreGroup.rotation.x) * .035;
  coreGroup.rotation.y += (pointer.x * .22 - coreGroup.rotation.y) * .035;
  crystal.rotation.x += dt * (.08 + energy * .5);
  crystal.rotation.y += dt * (.12 + energy * .8);
  crystal.scale.setScalar(1 + energy * .055 + focus * .025);
  crystalUniforms.energy.value = energy;
  crystalUniforms.error.value = error;
  innerCore.rotation.x -= dt * .28; innerCore.rotation.y += dt * .42;
  innerCore.scale.setScalar(1 + energy * .18);
  orbiters.forEach((mesh) => {
    const d = mesh.userData; d.angle += dt * d.speed * (1 + energy * 4);
    mesh.position.set(Math.cos(d.angle) * d.radius, Math.sin(d.angle * 1.3) * .8 + d.lift, Math.sin(d.angle) * d.radius * .36);
  });
  dust.rotation.y += dt * .008;
  renderer.render(scene, camera);
}

function cleanup() {
  cancelAnimationFrame(raf);
  disposers.splice(0).forEach((fn) => fn());
  scene?.traverse((node) => {
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose?.()); else node.material?.dispose?.();
  });
  renderer?.dispose?.(); canvas?.remove();
  canvas = renderer = scene = camera = coreGroup = crystal = innerCore = dust = clock = null;
  orbiters = []; energy = focus = error = 0;
  crystalUniforms.time.value = crystalUniforms.energy.value = crystalUniforms.error.value = 0;
}
