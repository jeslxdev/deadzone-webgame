// ============================================================
//  MODELOS EXTERNOS (.glb) — ponto de encaixe para modelos do
//  Meshy (ou qualquer glTF rigado/animado).
//
//  Coloque os arquivos em /models e registre em models/manifest.json:
//  {
//    "zombie_andarilho": { "file": "andarilho.glb", "height": 1.8,
//      "anims": { "idle": "Idle", "walk": "Walking", "run": "Running",
//                 "attack": "Attack", "death": "Dying" } },
//    "boss_brutamontes": { "file": "acougueiro.glb", "height": 2.0 }
//  }
//  Chaves: zombie_<tipo> e boss_<tipo>. Sem manifesto, o jogo usa os
//  modelos procedurais.
// ============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const lib = new Map();

export async function loadModels() {
  let manifest;
  try {
    const r = await fetch('models/manifest.json', { cache: 'no-store' });
    if (!r.ok) return 0;
    manifest = await r.json();
  } catch { return 0; }
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(manifest).map(async ([key, def]) => {
    if (key.startsWith('_')) return;
    try {
      const gltf = await loader.loadAsync('models/' + def.file);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const h = box.max.y - box.min.y || 1;
      lib.set(key, { def, scene: gltf.scene, clips: gltf.animations, scale: (def.height || 1.85) / h, minY: box.min.y });
    } catch (e) { console.warn('[models] falha ao carregar', key, e); }
  }));
  if (lib.size) console.info('[models] carregados:', [...lib.keys()].join(', '));
  return lib.size;
}

export function hasModel(key) { return lib.has(key); }

// Cria uma instância animada. Retorna um adaptador compatível com o rig procedural.
export function instanceModel(key, { shadows = false } = {}) {
  const m = lib.get(key);
  const obj = SkeletonUtils.clone(m.scene);
  obj.scale.setScalar(m.scale);
  obj.position.y = -m.minY * m.scale;
  const mats = [];
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = shadows;
      o.material = o.material.clone();
      mats.push(o.material);
      o.frustumCulled = false; // malhas com skin podem ser recortadas incorretamente
    }
  });
  const mixer = new THREE.AnimationMixer(obj);
  const actions = {};
  const anims = m.def.anims || {};
  for (const [name, clipName] of Object.entries(anims)) {
    const clip = m.clips.find((c) => c.name === clipName) || m.clips.find((c) => c.name.toLowerCase().includes(name));
    if (clip) actions[name] = mixer.clipAction(clip);
  }
  if (!Object.keys(actions).length && m.clips[0]) actions.walk = mixer.clipAction(m.clips[0]);
  if (actions.death) { actions.death.setLoop(THREE.LoopOnce); actions.death.clampWhenFinished = true; }
  if (actions.attack) actions.attack.setLoop(THREE.LoopOnce);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(obj);
  const dummy = () => new THREE.Group();
  let current = null;
  return {
    gltf: true, root, body, torso: dummy(), head: dummy(), legL: dummy(), legR: dummy(),
    armL: dummy(), armR: dummy(), handL: dummy(), handR: dummy(), kneeL: dummy(), kneeR: dummy(), elbowL: dummy(), elbowR: dummy(), bw: 1, mats,
    hasDeath: !!actions.death,
    play(name, fade = 0.2) {
      const a = actions[name] || (name === 'run' ? actions.walk : null) || (name !== 'idle' ? null : actions.walk);
      if (!a || a === current) return;
      a.reset().fadeIn(fade).play();
      if (current) current.fadeOut(fade);
      current = a;
    },
    update(dt) { mixer.update(dt); },
    setFlash(v) { for (const mt of mats) if (mt.emissive) mt.emissive.setRGB(v, v * 0.15, v * 0.1); },
    setEyeColor() {},
    dispose() { mixer.stopAllAction(); mats.forEach((mt) => mt.dispose()); },
  };
}
