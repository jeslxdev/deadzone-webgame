// ============================================================
//  ANIMAÇÃO — ciclos de locomoção para o rig articulado
//  (quadril, joelho, ombro, cotovelo). Retorna eventos de passo
//  para tocar o som da pisada no momento em que o calcanhar toca.
// ============================================================
const PI = Math.PI;

// Estado por personagem: { ph, blend, step }
export function newGait() { return { ph: 0, blend: 0, step: 0, breath: Math.random() * 6 }; }

/**
 * Caminhada/corrida humana.
 * speed: velocidade atual (unid/s). runAt: velocidade em que vira corrida plena.
 * opts.freeArms: anima os braços (false quando a arma controla os braços)
 * opts.freeTorso: aplica torção do tronco (false durante golpes)
 * Retorna 1 quando um pé toca o chão neste quadro, senão 0.
 */
export function humanGait(rig, g, dt, speed, opts = {}) {
  const runAt = opts.runAt ?? 8;
  const moving = speed > 0.3;
  const run = Math.min(1, speed / runAt);
  g.blend += ((moving ? 1 : 0) - g.blend) * Math.min(1, dt * 9);
  const m = g.blend;
  if (moving) g.ph += dt * (2.6 + speed * 1.15);
  g.breath += dt;
  const s = Math.sin(g.ph), c = Math.cos(g.ph);
  const A = (0.42 + 0.38 * run) * m;   // amplitude da coxa
  const B = (0.5 + 0.75 * run) * m;    // dobra do joelho no balanço

  rig.legL.rotation.x = -s * A;
  rig.legR.rotation.x = s * A;
  rig.kneeL.rotation.x = Math.max(0, c) * B + 0.06 + Math.max(0, -c) * 0.12 * m; // leve flexão no apoio
  rig.kneeR.rotation.x = Math.max(0, -c) * B + 0.06 + Math.max(0, c) * 0.12 * m;
  rig.legL.rotation.z = 0; rig.legR.rotation.z = 0;

  // quadril sobe quando as pernas se cruzam, desce no contato do calcanhar
  const bob = (Math.cos(2 * g.ph) * 0.5 + 0.5) * (0.022 + 0.03 * run) * m;
  const breathe = Math.sin(g.breath * 1.7) * 0.004 * (1 - m);
  rig.body.position.y = bob - 0.035 * run * m + breathe;
  rig.body.rotation.z = s * 0.035 * m;
  rig.torso.rotation.x = (0.04 + 0.16 * run) * m + Math.sin(g.breath * 1.7) * 0.01 * (1 - m);
  if (opts.freeTorso !== false) rig.torso.rotation.y = s * (0.08 + 0.06 * run) * m;
  rig.head.rotation.y = -rig.torso.rotation.y * 0.8;
  rig.head.rotation.x = -rig.torso.rotation.x * 0.6;

  if (opts.freeArms !== false) {
    const k = (0.35 + 0.55 * run) * m;
    rig.armL.rotation.set(s * k, 0, 0.06 + 0.04 * run);
    rig.armR.rotation.set(-s * k, 0, -0.06 - 0.04 * run);
    rig.elbowL.rotation.x = -(0.18 + 0.9 * run * m + Math.max(0, -s) * 0.35 * m);
    rig.elbowR.rotation.x = -(0.18 + 0.9 * run * m + Math.max(0, s) * 0.35 * m);
  }

  // evento de passo: calcanhar toca em ph = π/2 + kπ
  const step = Math.floor((g.ph - PI / 2) / PI);
  let ev = 0;
  if (step !== g.step) { if (m > 0.5) ev = 1; g.step = step; }
  return ev;
}

/**
 * Andar arrastado de zumbi: passada curta, perna direita mais rígida
 * (arrasta), tronco curvado balançando, braços estendidos à frente.
 */
export function zombieGait(rig, g, dt, speed, opts = {}) {
  const runner = !!opts.runner;
  const moving = speed > 0.2;
  g.blend += ((moving ? 1 : 0) - g.blend) * Math.min(1, dt * 6);
  const m = g.blend;
  g.ph += dt * (moving ? (runner ? 3.2 + speed * 1.2 : 1.6 + speed * 1.1) : 0.4);
  g.breath += dt;
  const s = Math.sin(g.ph), c = Math.cos(g.ph);
  if (runner) {
    const A = 0.75 * m, B = 1.1 * m;
    rig.legL.rotation.x = -s * A; rig.legR.rotation.x = s * A;
    rig.kneeL.rotation.x = Math.max(0, c) * B + 0.1; rig.kneeR.rotation.x = Math.max(0, -c) * B + 0.1;
    rig.body.position.y = (Math.cos(2 * g.ph) * 0.5 + 0.5) * 0.05 * m - 0.04 * m;
    rig.torso.rotation.x = 0.45 * m + 0.15;
  } else {
    const A = 0.38 * m;
    rig.legL.rotation.x = -s * A;
    rig.legR.rotation.x = s * A * 0.55;           // perna que arrasta
    rig.kneeL.rotation.x = Math.max(0, c) * 0.55 * m + 0.12;
    rig.kneeR.rotation.x = 0.08 + Math.max(0, -c) * 0.15 * m;
    rig.legR.rotation.z = -0.06 * m;
    rig.body.position.y = (Math.cos(2 * g.ph) * 0.5 + 0.5) * 0.03 * m - 0.03;
    rig.body.rotation.z = s * 0.09 * m + Math.sin(g.breath * 0.7) * 0.03;
    rig.torso.rotation.x = 0.22 + Math.sin(g.breath * 0.9) * 0.04;
  }
  rig.torso.rotation.y = s * 0.12 * m;
  rig.head.rotation.z = Math.sin(g.breath * 0.8) * 0.18;
  rig.head.rotation.x = -0.15 + Math.sin(g.breath * 1.3) * 0.08;
  const step = Math.floor((g.ph - PI / 2) / PI);
  let ev = 0;
  if (step !== g.step) { if (m > 0.5) ev = 1; g.step = step; }
  return ev;
}

// Pose de repouso (menus): respiração e peso alternando
export function idlePose(rig, t, gun) {
  rig.body.position.y = Math.sin(t * 1.7) * 0.004;
  rig.torso.rotation.x = Math.sin(t * 1.7) * 0.012;
  rig.body.rotation.z = Math.sin(t * 0.35) * 0.015;
  rig.legL.rotation.z = 0.03; rig.legR.rotation.z = -0.03;
  rig.kneeL.rotation.x = 0.04 + Math.max(0, Math.sin(t * 0.35)) * 0.06;
  rig.kneeR.rotation.x = 0.04 + Math.max(0, -Math.sin(t * 0.35)) * 0.06;
  if (gun) {
    rig.armR.rotation.set(-0.35, 0, -0.05); rig.elbowR.rotation.x = -0.9;
    rig.armL.rotation.set(-0.25, -0.35, 0.1); rig.elbowL.rotation.x = -1.0;
  } else {
    rig.armR.rotation.set(-0.15 + Math.sin(t * 1.5) * 0.03, 0.1, -0.06); rig.elbowR.rotation.x = -0.55;
    rig.armL.rotation.set(rig.weaponL ? -0.15 : 0.04, rig.weaponL ? -0.1 : 0, 0.08); rig.elbowL.rotation.x = rig.weaponL ? -0.55 : -0.15;
  }
}
