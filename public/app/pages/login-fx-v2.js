// 登录页 V2：SIGNAL TERRAIN / 信号地形
// 黑金工业空间、动态拓扑地貌与扫描光束。

import * as THREE from '../vendor/three.module.js';

const MOBILE = typeof window !== 'undefined' && window.innerWidth < 720;
const uniforms = {
  time: { value: 0 }, energy: { value: 0 }, focus: { value: 0 }, error: { value: 0 },
};
let mounted = false;
let canvas, renderer, scene, camera, terrainGroup, terrainSolid, terrainWire, scanner, dust, clock, raf = 0;
let energy = 0, focus = 0, error = 0;
const pointer = new THREE.Vector2();
const pointerTarget = new THREE.Vector2();
const disposers = [];

export function renderForm({ container, boot }) {
  container.innerHTML = '';
  document.body.classList.remove('fx-v1', 'fx-v3', 'fx-v4', 'fx-v5');
  document.body.classList.add('fx-v2');
  const el = window.App.el;
  const errBox = el('div', { class: 'fx2x-error', role: 'alert' });
  const uInput = el('input', {
    class: 'fx2x-input', type: 'text', autocomplete: 'username',
    placeholder: '账号', 'aria-label': '账号',
  });
  const pInput = el('input', {
    class: 'fx2x-input', type: 'password', autocomplete: boot ? 'new-password' : 'current-password',
    placeholder: '密码', 'aria-label': '密码',
  });
  const label = boot ? '创建管理员' : '进入';
  const btnLabel = el('span', {}, label);
  const btn = el('button', { class: 'fx2x-submit', type: 'submit' }, btnLabel);
  const form = el('form', { class: 'fx2x-shell' },
    el('div', { class: 'fx2x-marker', 'aria-hidden': 'true' }, el('i'), el('i')),
    el('div', { class: 'fx2x-fields' },
      el('label', { class: 'fx2x-field' }, uInput),
      el('label', { class: 'fx2x-field' }, pInput)),
    errBox,
    btn,
    el('div', { class: 'fx2x-meter', 'aria-hidden': 'true' },
      el('i'), el('i'), el('i'), el('i'), el('i')));
  container.appendChild(form);
  return {
    form, uInput, pInput, btn, errBox,
    setBusy(busy) {
      btn.disabled = busy; btn.classList.toggle('is-busy', busy);
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
  catch (err) { console.warn('[login-fx-v2] init failed:', err); cleanup(); return; }
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
  canvas.id = 'login-fx-canvas'; canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '0',
    pointerEvents: 'none', opacity: '0', transition: 'opacity .4s ease',
  });
  document.body.appendChild(canvas);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBILE ? 1.25 : 1.8));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.setClearColor(0x080705, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

function setupScene() {
  scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x080705, .055);
  camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, .1, 90);
  camera.position.set(0, 1.6, 15);

  terrainGroup = new THREE.Group();
  terrainGroup.position.set(MOBILE ? 0 : 3.3, MOBILE ? 3.0 : -.5, -2.2);
  terrainGroup.rotation.x = -1.02;
  terrainGroup.rotation.z = MOBILE ? 0 : -.12;
  scene.add(terrainGroup);

  const geometry = new THREE.PlaneGeometry(MOBILE ? 16 : 22, MOBILE ? 13 : 18, MOBILE ? 62 : 112, MOBILE ? 50 : 88);
  terrainSolid = new THREE.Mesh(geometry, terrainMaterial(false));
  terrainWire = new THREE.Mesh(geometry, terrainMaterial(true));
  terrainWire.position.z = .028;
  terrainGroup.add(terrainSolid, terrainWire);

  scanner = new THREE.Mesh(
    new THREE.PlaneGeometry(MOBILE ? 15 : 21, .055),
    new THREE.MeshBasicMaterial({ color: 0xffb12d, transparent: true, opacity: .72, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  scanner.position.set(0, -5, .18);
  terrainGroup.add(scanner);

  dust = buildDust(); scene.add(dust);
}

function terrainMaterial(wireframe) {
  return new THREE.ShaderMaterial({
    uniforms,
    wireframe,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: !wireframe,
    blending: wireframe ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */`
      uniform float time; uniform float energy; uniform float focus;
      varying float height; varying vec2 uvp;
      void main(){
        uvp=uv; vec3 p=position;
        float ridge=sin(p.x*.72+time*.48)*1.05 + sin(p.y*.48-time*.34)*.72;
        ridge += sin((p.x+p.y)*.34+time*.22)*.58;
        float center=exp(-dot(p.xy,p.xy)*.024)*(1.2+focus*.65);
        float shock=sin(length(p.xy)*2.2-time*5.0)*energy*.42;
        p.z += ridge*.48 + center + shock;
        height=p.z;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float time; uniform float error; varying float height; varying vec2 uvp;
      void main(){
        float scan=pow(max(0.0,1.0-abs(uvp.y-fract(time*.075))*18.0),2.0);
        vec3 amber=vec3(1.0,.49,.08), hot=vec3(1.0,.83,.34), alarm=vec3(1.0,.07,.04);
        vec3 color=mix(amber,hot,clamp(height*.24+.45,0.0,1.0));
        color=mix(color,alarm,error);
        float alpha=${wireframe ? '.18+scan*.68' : '.025+scan*.045'};
        gl_FragColor=vec4(color*(.65+scan*1.8),alpha);
      }`,
  });
}

function buildDust() {
  const count = MOBILE ? 240 : 620;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - .5) * 28;
    positions[i * 3 + 1] = (Math.random() - .5) * 18;
    positions[i * 3 + 2] = -2 - Math.random() * 18;
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xff9f26, size: .026, transparent: true, opacity: .38, depthWrite: false }));
}

function setupEvents() {
  const move = (event) => pointerTarget.set(event.clientX / innerWidth * 2 - 1, -(event.clientY / innerHeight * 2 - 1));
  const resize = () => {
    if (!renderer) return;
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
  };
  addEventListener('pointermove', move, { passive: true }); addEventListener('resize', resize, { passive: true });
  disposers.push(() => removeEventListener('pointermove', move), () => removeEventListener('resize', resize));
}

function tick() { if (!mounted) return; renderFrame(Math.min(clock.getDelta(), .05)); raf = requestAnimationFrame(tick); }

function renderFrame(dt) {
  uniforms.time.value += dt;
  energy = Math.max(0, energy - dt * 1.3); focus = Math.max(0, focus - dt * 1.5); error = Math.max(0, error - dt * 2.3);
  uniforms.energy.value = energy; uniforms.focus.value = focus; uniforms.error.value = error;
  pointer.lerp(pointerTarget, .045);
  const baseX = -1.02;
  terrainGroup.rotation.x += (baseX + pointer.y * .045 - terrainGroup.rotation.x) * .04;
  terrainGroup.rotation.y += (pointer.x * .09 - terrainGroup.rotation.y) * .04;
  scanner.position.y = -6 + (uniforms.time.value * 1.45 % 12);
  scanner.material.opacity = .48 + energy * .45;
  dust.rotation.y -= dt * .006;
  renderer.render(scene, camera);
}

function cleanup() {
  cancelAnimationFrame(raf); disposers.splice(0).forEach((fn) => fn());
  scene?.traverse((node) => {
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose?.()); else node.material?.dispose?.();
  });
  renderer?.dispose?.(); canvas?.remove();
  canvas = renderer = scene = camera = terrainGroup = terrainSolid = terrainWire = scanner = dust = clock = null;
  energy = focus = error = 0; uniforms.time.value = uniforms.energy.value = uniforms.focus.value = uniforms.error.value = 0;
}
