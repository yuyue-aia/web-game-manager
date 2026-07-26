// 登录页 v5：LUMEN VEIL / 光幕
// 动态线框织物、扫描光带与空间尘埃。

import * as THREE from '../vendor/three.module.js';
import { EffectComposer } from '../vendor/three-addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three-addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three-addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three-addons/postprocessing/OutputPass.js';

const MOBILE = typeof window !== 'undefined' && window.innerWidth < 720;
const uTime = { value: 0 };
const state = { energy: 0, focus: 0, error: 0 };
let mounted = false;
let canvas, renderer, scene, camera, composer, veil, dust, clock, raf = 0;
let pointer = new THREE.Vector2(), targetPointer = new THREE.Vector2();
const disposers = [];

export function renderForm({ container, boot }) {
  container.innerHTML = '';
  document.body.classList.remove('fx-v1', 'fx-v2', 'fx-v3', 'fx-v4');
  document.body.classList.add('fx-v5');
  const el = window.App.el;
  const errBox = el('div', { class: 'fx5-form__error', role: 'alert' });
  const uInput = el('input', { class: 'fx5-form__input', type: 'text', autocomplete: 'username', placeholder: '账号', 'aria-label': '账号' });
  const pInput = el('input', { class: 'fx5-form__input', type: 'password', autocomplete: boot ? 'new-password' : 'current-password', placeholder: boot ? '设置密码' : '密码', 'aria-label': '密码' });
  const defaultLabel = boot ? '建立管理员身份' : '验证并进入';
  const btnText = el('span', {}, defaultLabel);
  const btn = el('button', { class: 'fx5-form__submit', type: 'submit' }, btnText, el('span', { 'aria-hidden': 'true' }, '→'));
  const form = el('form', { class: 'fx5-shell' },
    el('div', { class: 'fx5-form__index' }, 'LUMEN VEIL — 05'),
    el('div', { class: 'fx5-form__intro' },
      el('h2', {}, boot ? '创建控制身份' : ''),
      el('p', {}, boot ? '设置管理员账号，开始配置设备与游戏时间。' : '使用你的账号继续管理游戏时间。')),
    el('div', { class: 'fx5-form__fields' },
      el('label', { class: 'fx5-form__field' }, el('span', {}, '01'), uInput),
      el('label', { class: 'fx5-form__field' }, el('span', {}, '02'), pInput)),
    errBox, btn,
    el('div', { class: 'fx5-form__meta' }, el('span', {}, 'SECURE CHANNEL'), el('span', {}, 'READY')));
  container.appendChild(form);
  return {
    form, uInput, pInput, btn, errBox,
    setBusy(busy) { btn.disabled = busy; btn.classList.toggle('is-busy', busy); btnText.textContent = busy ? '正在校验波形' : defaultLabel; },
    showError(msg) { errBox.textContent = msg; },
    clearError() { errBox.textContent = ''; },
  };
}

export function mount() {
  if (mounted) return;
  mounted = true;
  try { setupRenderer(); setupScene(); setupPost(); setupEvents(); }
  catch (err) { console.warn('[login-fx-v5] init failed:', err); cleanup(); return; }
  clock = new THREE.Clock();
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) renderFrame(0);
  else tick();
}
export function unmount() { if (!mounted) return; mounted = false; cleanup(); }
export function pulse() { state.energy = 1; }
export function focusBoost() { state.focus = 1; }
export function flashError() { state.error = 1; }

function setupRenderer() {
  canvas = document.createElement('canvas');
  canvas.id = 'login-fx-canvas'; canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '0', pointerEvents: 'none' });
  document.body.appendChild(canvas);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 1.35 : 2));
  renderer.setSize(innerWidth, innerHeight, false); renderer.setClearColor(0x050707, 1); renderer.outputColorSpace = THREE.SRGBColorSpace;
}

function setupScene() {
  scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x050707, .045);
  camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .1, 100); camera.position.set(0, 0, 15);
  veil = new THREE.Group(); veil.position.set(MOBILE ? 0 : 3.5, MOBILE ? 2.6 : 0, -2); veil.rotation.z = MOBILE ? .03 : -.08; scene.add(veil);
  veil.add(buildVeil(false)); veil.add(buildVeil(true));
  dust = buildDust(); scene.add(dust);
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshBasicMaterial({ color: 0x050707 })); bg.position.z = -18; scene.add(bg);
}

function veilMaterial(wireframe) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime, uEnergy: { value: 0 }, uFocus: { value: 0 }, uError: { value: 0 }, uWire: { value: wireframe ? 1 : 0 } },
    wireframe, transparent: true, side: THREE.DoubleSide, depthWrite: !wireframe,
    blending: wireframe ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uEnergy; uniform float uFocus;
      varying vec2 vUv; varying float vLift;
      void main(){
        vUv=uv; vec3 p=position;
        float ridge=sin(p.x*.72+uTime*.55)+sin(p.y*.94-uTime*.38)+sin((p.x+p.y)*.38+uTime*.24);
        float pulse=sin(length(p.xy)*2.4-uTime*5.0)*uEnergy;
        float focus=exp(-pow(p.x+2.0,2.0)*.06)*uFocus;
        p.z += ridge*.48 + pulse*.36 + focus*.55;
        p.x += sin(p.y*.38+uTime*.22)*.22;
        vLift=p.z;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uError; uniform float uWire;
      varying vec2 vUv; varying float vLift;
      void main(){
        vec3 teal=vec3(.16,.94,.78), frost=vec3(.70,.94,.90), alarm=vec3(1.0,.12,.12);
        float beam=pow(max(0.0,1.0-abs(vUv.x-fract(uTime*.055))*9.0),3.0);
        vec3 color=mix(teal,frost,clamp(vLift*.35+.45,0.0,1.0)); color=mix(color,alarm,uError);
        float alpha=uWire>.5 ? .22+beam*.65 : .035+beam*.065;
        gl_FragColor=vec4(color*(.5+beam*1.6),alpha);
      }`,
  });
}

function buildVeil(wireframe) {
  const geometry = new THREE.PlaneGeometry(MOBILE ? 15 : 19, MOBILE ? 9 : 14, MOBILE ? 46 : 92, MOBILE ? 32 : 70);
  const mesh = new THREE.Mesh(geometry, veilMaterial(wireframe)); mesh.position.z = wireframe ? .03 : 0; mesh.userData.isVeil = true; return mesh;
}

function buildDust() {
  const count = MOBILE ? 300 : 900, data = new Float32Array(count * 3);
  for (let i=0;i<count;i++){ data[i*3]=(Math.random()-.5)*32; data[i*3+1]=(Math.random()-.5)*20; data[i*3+2]=-2-Math.random()*16; }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(data,3));
  return new THREE.Points(g,new THREE.PointsMaterial({color:0x70e9d0,size:.025,transparent:true,opacity:.42,depthWrite:false}));
}

function setupPost() {
  composer=new EffectComposer(renderer); composer.setSize(innerWidth,innerHeight); composer.addPass(new RenderPass(scene,camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),MOBILE?.45:.72,.65,.42)); composer.addPass(new OutputPass());
}

function setupEvents() {
  const move=e=>{targetPointer.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight*2-1));};
  const resize=()=>{if(!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight,false);composer?.setSize(innerWidth,innerHeight);};
  addEventListener('pointermove',move,{passive:true}); addEventListener('resize',resize,{passive:true});
  disposers.push(()=>removeEventListener('pointermove',move),()=>removeEventListener('resize',resize));
}

function tick(){if(!mounted)return;renderFrame(Math.min(clock.getDelta(),.05));raf=requestAnimationFrame(tick);}
function renderFrame(dt){
  uTime.value+=dt; state.energy=Math.max(0,state.energy-dt*1.35); state.focus=Math.max(0,state.focus-dt*1.2); state.error=Math.max(0,state.error-dt*2.2);
  pointer.lerp(targetPointer,.04); veil.rotation.x+=(pointer.y*.07-veil.rotation.x)*.035; veil.rotation.y+=(pointer.x*.11-veil.rotation.y)*.035;
  veil.children.forEach(m=>{if(m.userData.isVeil){m.material.uniforms.uEnergy.value=state.energy;m.material.uniforms.uFocus.value=state.focus;m.material.uniforms.uError.value=state.error;}});
  dust.rotation.z+=dt*.004; composer.render();
}

function cleanup(){
  cancelAnimationFrame(raf); disposers.splice(0).forEach(fn=>fn());
  scene?.traverse(n=>{n.geometry?.dispose?.();if(Array.isArray(n.material))n.material.forEach(m=>m.dispose?.());else n.material?.dispose?.();});
  composer?.dispose?.(); renderer?.dispose?.(); canvas?.remove(); canvas=renderer=scene=camera=composer=veil=dust=clock=null; state.energy=state.focus=state.error=0;
}
