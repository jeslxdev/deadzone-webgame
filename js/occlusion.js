// ============================================================
//  OCLUSÃO — "janela" transparente ao redor do personagem
//  Qualquer superfície do cenário que esteja ENTRE a câmera e o
//  jogador, dentro de um círculo ao redor dele na tela, é vazada
//  com pontilhado (dither) suave. Funciona com malhas mescladas,
//  sem problemas de ordenação de transparência.
// ============================================================
import * as THREE from 'three';

export const occlusionUniforms = {
  uOccCenter: { value: new THREE.Vector2(0, 0) }, // centro na tela (NDC)
  uOccRadius: { value: 0.0 },                     // raio (unidades de NDC em y)
  uOccDepth: { value: 0.0 },                      // profundidade do jogador (espaço da câmera)
  uOccAspect: { value: 1.0 },
  uOccOn: { value: 0.0 },
};

const VERT_DECL = 'varying float vOccDepth;\nvarying float vOccY;\nvarying vec4 vOccClip;\n';
const FRAG_DECL = `uniform vec2 uOccCenter; uniform float uOccRadius; uniform float uOccDepth; uniform float uOccAspect; uniform float uOccOn;
varying float vOccDepth; varying float vOccY; varying vec4 vOccClip;
float occBayer(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int k = i.x + i.y * 4;
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[k] + 0.5) / 16.0;
}
`;
const FRAG_CODE = `
  if (uOccOn > 0.5 && vOccDepth < uOccDepth - 1.2 && vOccY > 0.3) {
    vec2 occD = vOccClip.xy / vOccClip.w - uOccCenter;
    occD.x *= uOccAspect;
    float occR = length(occD);
    if (occR < uOccRadius) {
      // totalmente aberto no centro, pontilhado suave na borda
      float occK = smoothstep(uOccRadius, uOccRadius * 0.5, occR);
      if (occBayer(gl_FragCoord.xy) < occK) discard;
    }
  }
`;

const patched = new WeakSet();
export function addOcclusion(material) {
  if (!material || patched.has(material)) return material;
  patched.add(material);
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, occlusionUniforms);
    shader.vertexShader = VERT_DECL + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n  vOccDepth = -mvPosition.z;\n  vOccClip = gl_Position;\n  vOccY = (modelMatrix * vec4(transformed, 1.0)).y;',
    );
    shader.fragmentShader = FRAG_DECL + shader.fragmentShader.replace('void main() {', 'void main() {' + FRAG_CODE);
  };
  material.customProgramCacheKey = () => 'occ-' + material.type;
  material.needsUpdate = true;
  return material;
}

const _v = new THREE.Vector3();
// Atualiza a janela a partir da câmera e da posição do jogador
export function updateOcclusionWindow(camera, playerPos, enabled = true) {
  const U = occlusionUniforms;
  U.uOccOn.value = enabled ? 1 : 0;
  if (!enabled) return;
  _v.set(playerPos.x, 1.0, playerPos.z).project(camera);
  U.uOccCenter.value.set(_v.x, _v.y);
  const footY = _v.y;
  _v.set(playerPos.x, 2.1, playerPos.z).project(camera);
  const h = Math.abs(_v.y - footY); // altura do boneco em NDC
  U.uOccRadius.value = Math.max(0.26, h * 3.6);
  U.uOccAspect.value = camera.aspect;
  _v.set(playerPos.x, 1.0, playerPos.z).applyMatrix4(camera.matrixWorldInverse);
  U.uOccDepth.value = -_v.z;
}

// ---------- silhueta "raio-X" ----------
// Desenha o personagem em cor sólida SOMENTE onde o cenário está na frente
// dele (teste de profundidade invertido). Ordem de desenho: cenário (0) ->
// silhueta (1) -> personagem (2); assim o próprio corpo não gera silhueta.
export function addXraySilhouette(root, color = 0x6fd8ff) {
  const mat = new THREE.MeshBasicMaterial({ color, depthWrite: false, depthFunc: THREE.GreaterDepth });
  const list = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.xray) list.push(o); });
  for (const m of list) {
    const s = new THREE.Mesh(m.geometry, mat);
    s.userData.xray = true;
    s.renderOrder = 1;
    s.castShadow = false; s.receiveShadow = false;
    s.frustumCulled = m.frustumCulled;
    m.add(s);
  }
  markCharacterOrder(root);
  return mat;
}
// Garante que as malhas reais do personagem (inclusive arma trocada depois) desenhem por último
export function markCharacterOrder(root) {
  root.traverse((o) => { if (o.isMesh && !o.userData.xray) o.renderOrder = 2; });
}
