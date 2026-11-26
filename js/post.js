// ============================================================
//  PÓS-PROCESSAMENTO — acabamento "de cinema" em todas as telas
//  · Bloom: fogo, disparos, olhos e brilhos ganham halo real
//  · Gradação: contraste, cor fria nas sombras/quente nas luzes,
//    leve dessaturação, vinheta e granulação de filme
//  · Reflexos de ambiente (PMREM) para metais e asfalto molhado
//  Em aparelhos fracos tudo isso é desligado (render direto).
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { setting } from './settings.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    vignette: { value: 0.42 },
    grain: { value: 0.035 },
    saturation: { value: 0.86 },
    contrast: { value: 1.08 },
    shadowTint: { value: new THREE.Color(0.93, 0.98, 1.06) },
    lightTint: { value: new THREE.Color(1.05, 1.0, 0.92) },
    aspect: { value: 1.6 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time, vignette, grain, saturation, contrast, aspect;
    uniform vec3 shadowTint, lightTint; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);                       // dessatura (mundo pós-apocalíptico)
      c = (c - 0.5) * contrast + 0.5;                         // contraste
      c *= mix(shadowTint, lightTint, smoothstep(0.05, 0.75, l)); // sombras frias, luzes quentes
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0) / max(aspect, 1.0);
      c *= 1.0 - vignette * smoothstep(0.32, 0.95, length(d) * 1.35); // vinheta
      c += (hash(vUv * 1000.0 + time) - 0.5) * grain;          // granulação
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export function createPost(renderer) {
  // reflexos suaves de ambiente para todos os materiais PBR
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  let composer = null, renderPass, bloom, grade;
  const size = renderer.getSize(new THREE.Vector2());
  // criado só quando a opção está ligada (economiza memória em aparelhos fracos)
  function build() {
    renderer.getSize(size);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    composer.addPass(renderPass);
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.45, 0.93); // limiar alto: só fogo, luzes e brilhos (nunca pele)
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    grade = new ShaderPass(GradeShader);
    composer.addPass(grade);
    api.setSize(size.x, size.y);
  }
  const t0 = performance.now();
  const api = {
    get enabled() { return !!setting('cinema'); },
    envTex,
    // ambiente de reflexo com intensidade própria de cada cena
    applyEnvironment(scene, intensity = 0.35) {
      scene.environment = envTex;
      scene.environmentIntensity = intensity;
    },
    setBloom(strength = 0.55, threshold = 0.82) { if (bloom) { bloom.strength = strength; bloom.threshold = threshold; } },
    render(scene, camera) {
      if (!setting('cinema')) { renderer.render(scene, camera); return; }
      if (!composer) build();
      renderPass.scene = scene; renderPass.camera = camera;
      grade.uniforms.time.value = ((performance.now() - t0) / 1000) % 100;
      composer.render();
    },
    setSize(w, h) {
      if (!composer) return;
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      bloom.resolution.set(w / 2, h / 2);
      grade.uniforms.aspect.value = w / Math.max(1, h);
    },
  };
  return api;
}
