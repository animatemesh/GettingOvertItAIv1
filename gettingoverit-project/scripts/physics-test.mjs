/**
 * Headless physics harness — replicates the Player body/joint setup and the
 * hammer controller + leverage logic, so we can MEASURE movement (vault up,
 * pull, levitation, swing stability) without a browser, and search for tuning
 * that gives decisive, stable, GOI-like movement.
 *
 * Run: node scripts/physics-test.mjs
 */
import RAPIER from '@dimforge/rapier3d-compat';

const FIXED_DT = 1 / 120;
const GRAVITY = { x: 0, y: -9.81, z: 0 };
const HAMMER = { mass: 2.2, headMass: 1.6, friction: 1.4, restitution: 0.0, linearDamping: 0.25, angularDamping: 1.2, handleLength: 2.4, handleRadius: 0.07, headHalfExtents: { x: 0.42, y: 0.26, z: 0.26 } };
const GROUP_TERRAIN = 0x0001;
const GROUP_PLAYER = 0x0002;
const PLAYER_GROUPS = (GROUP_PLAYER << 16) | GROUP_TERRAIN;

function v3(x, y, z) { return { x, y, z }; }
function len2(x, y) { return Math.hypot(x, y); }

await RAPIER.init();

/** Build a world with tunable parameters. */
function buildWorld(P) {
  const world = new RAPIER.World(GRAVITY);
  world.numSolverIterations = P.iterations;
  const eventQueue = new RAPIER.EventQueue(true);
  const gripY = 0.6 + 0.35;

  const terrain = new Set();
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  const groundCol = world.createCollider(
    RAPIER.ColliderDesc.cuboid(40, 0.5, 6).setFriction(1.1).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    groundBody,
  );
  terrain.add(groundCol.handle);

  // Optional step/ledge to climb onto: top surface at y = P.stepTop, x in [stepX0, stepX0+stepW].
  if (P.stepTop) {
    const sx0 = P.stepX0 ?? 2.2, sw = P.stepW ?? 6;
    const sb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(sx0 + sw / 2, P.stepTop / 2, 0));
    const sc = world.createCollider(
      RAPIER.ColliderDesc.cuboid(sw / 2, P.stepTop / 2, 6).setFriction(1.1).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      sb,
    );
    terrain.add(sc.handle);
  }

  const start = { x: 0, y: 3.0 };
  const cauldron = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x, start.y, 0)
      .enabledTranslations(true, true, false)
      .enabledRotations(false, false, false)
      .setLinearDamping(P.cauldronLinDamp)
      .setAngularDamping(0.9)
      .setCcdEnabled(true),
  );
  world.createCollider(
    RAPIER.ColliderDesc.capsule(0.6, 0.85)
      .setFriction(0.7).setRestitution(0.0).setMass(P.cauldronMass)
      .setCollisionGroups(PLAYER_GROUPS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    cauldron,
  );

  // Hammer spawned hanging DOWN (head below pivot) so it rests naturally.
  const downQ = { x: 0, y: 0, z: 1, w: 0 }; // 180° about Z
  const hammer = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x, start.y + gripY, 0)
      .setRotation(downQ)
      .enabledTranslations(true, true, false)
      .enabledRotations(false, false, true)
      .setLinearDamping(HAMMER.linearDamping)
      .setAngularDamping(HAMMER.angularDamping)
      .setCcdEnabled(true),
  );
  world.createCollider(
    RAPIER.ColliderDesc.capsule(HAMMER.handleLength / 2, HAMMER.handleRadius)
      .setTranslation(0, HAMMER.handleLength / 2, 0)
      .setFriction(0.4).setMass(Math.max(HAMMER.mass - HAMMER.headMass, 0.1))
      .setCollisionGroups(PLAYER_GROUPS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    hammer,
  );
  const he = HAMMER.headHalfExtents;
  const headCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
      .setTranslation(0, HAMMER.handleLength, 0)
      .setFriction(HAMMER.friction).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setRestitution(0.0).setMass(HAMMER.headMass)
      .setCollisionGroups(PLAYER_GROUPS).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    hammer,
  );
  world.createImpulseJoint(RAPIER.JointData.spherical(v3(0, gripY, 0), v3(0, 0, 0)), cauldron, hammer, true);

  return { world, eventQueue, cauldron, hammer, headCollider, terrain, gripY };
}

function pivotOf(sim) { const t = sim.cauldron.translation(); return { x: t.x, y: t.y + sim.gripY }; }
function headWorldOf(hammer) {
  const t = hammer.translation(); const r = hammer.rotation(); const L = HAMMER.handleLength;
  const { x: qx, y: qy, z: qz, w: qw } = r; const vx = 0, vy = L, vz = 0;
  const cx = qy * vz - qz * vy, cy = qz * vx - qx * vz, cz = qx * vy - qy * vx;
  const dx = cx + qw * vx, dy = cy + qw * vy, dz = cz + qw * vz;
  const c2x = qy * dz - qz * dy, c2y = qz * dx - qx * dz, c2z = qx * dy - qy * dx;
  return { x: t.x + vx + 2 * c2x, y: t.y + vy + 2 * c2y, z: t.z + vz + 2 * c2z };
}
function headVelOf(hammer, head) {
  const v = hammer.linvel(), w = hammer.angvel(), t = hammer.translation();
  const rx = head.x - t.x, ry = head.y - t.y, rz = head.z - t.z;
  return { x: v.x + (w.y * rz - w.z * ry), y: v.y + (w.z * rx - w.x * rz) };
}

function makeController(P) {
  let lastDir = { x: 0, y: -1 };
  return function applySteering(sim, mouse) {
    sim.hammer.resetForces(false); sim.hammer.resetTorques(false);
    sim.cauldron.resetForces(false); sim.cauldron.resetTorques(false);
    const pivot = pivotOf(sim);
    let dx = mouse.x - pivot.x, dy = mouse.y - pivot.y;
    const dist = len2(dx, dy);
    if (dist > 1e-4) lastDir = { x: dx / dist, y: dy / dist };
    const maxReach = HAMMER.handleLength * (P.reachMul ?? 1);
    const clamped = Math.min(Math.max(dist, 0.5), maxReach);
    const target = { x: pivot.x + lastDir.x * clamped, y: pivot.y + lastDir.y * clamped };
    const head = headWorldOf(sim.hammer);
    const hv = headVelOf(sim.hammer, head);
    let fx = P.kp * (target.x - head.x) - P.kd * hv.x;
    let fy = P.kp * (target.y - head.y) - P.kd * hv.y;
    const mag = len2(fx, fy);
    if (mag > P.maxForce) { fx *= P.maxForce / mag; fy *= P.maxForce / mag; }
    // Internal force pair: +F drives the head; -F reacts on the body so free-air
    // steering conserves momentum (no runaway levitation). Optional reactScale
    // lets the body reaction be tempered (1 = fully internal/physical).
    sim.hammer.addForceAtPoint(v3(fx, fy, 0), head, true);
    const rs = P.reactScale ?? 1;
    sim.cauldron.addForce(v3(-fx * rs, -fy * rs, 0), true);
    return { F: { x: fx, y: fy }, head, pivot };
  };
}

/** Clean vault assist: convert outward press against terrain into an inward
 *  (head->pivot) impulse on the cauldron. Correct sign by geometry; only fires
 *  when the head is actually touching terrain AND being blocked. */
function applyVaultAssist(sim, steer, P, dt) {
  if (P.assistGain <= 0) return { anchored: false };
  let touching = false;
  sim.world.contactPairsWith(sim.headCollider, (other) => { if (sim.terrain.has(other.handle)) touching = true; });
  if (!touching) return { anchored: false };

  const head = steer.head, pivot = steer.pivot;
  let ox = head.x - pivot.x, oy = head.y - pivot.y;       // outward (pivot->head)
  const ol = len2(ox, oy); if (ol < 1e-6) return { anchored: false };
  ox /= ol; oy /= ol;
  const pressOut = steer.F.x * ox + steer.F.y * oy;        // how hard pressing away from body
  if (pressOut <= P.anchorThreshold) return { anchored: false };

  // Gate by "blocked": head not actually moving outward despite the press.
  const hv = headVelOf(sim.hammer, head);
  const outVel = hv.x * ox + hv.y * oy;
  const blocked = Math.max(0, 1 - Math.max(0, outVel) / 1.5); // 1 when still, ->0 when sliding out fast
  const mag = pressOut * blocked * P.assistGain * dt;
  // inward = -outward
  const ix = -ox * mag, iy = -oy * mag;
  sim.cauldron.applyImpulse(v3(ix, iy, 0), true);
  return { anchored: true, imp: { x: ix, y: iy }, pressOut, blocked };
}

function settle(sim, steps = 400) { for (let i = 0; i < steps; i++) sim.world.step(sim.eventQueue); }

/** Run a scenario; returns metrics including horizontal travel. */
function run(P, mouseFn, steps) {
  const sim = buildWorld(P);
  settle(sim, 400);
  const t0 = sim.cauldron.translation();
  const cx0 = t0.x, cy0 = t0.y;
  const ctrl = makeController(P);
  let maxSpeed = 0, maxY = cy0, maxX = cx0, minX = cx0;
  for (let i = 0; i < steps; i++) {
    const mouse = mouseFn(i * FIXED_DT, sim);
    ctrl(sim, mouse);
    sim.world.step(sim.eventQueue);
    const cv = sim.cauldron.linvel(); const sp = len2(cv.x, cv.y);
    if (sp > maxSpeed) maxSpeed = sp;
    const t = sim.cauldron.translation();
    if (t.y > maxY) maxY = t.y;
    if (t.x > maxX) maxX = t.x; if (t.x < minX) minX = t.x;
  }
  const t1 = sim.cauldron.translation();
  return { dx: t1.x - cx0, dy: t1.y - cy0, riseMax: maxY - cy0, travelX: maxX - minX, maxSpeed };
}

function fmt(label, r) {
  console.log(
    `${label.padEnd(22)} Δx=${r.dx.toFixed(2)}  Δy=${r.dy.toFixed(2)}  riseMax=${r.riseMax.toFixed(2)}  ` +
    `travelX=${r.travelX.toFixed(2)}  maxSpeed=${r.maxSpeed.toFixed(1)}`,
  );
}

// Scenarios -----------------------------------------------------------------
// Push off: plant the head down-LEFT and press into it -> body should scoot RIGHT.
const pushRight = () => ({ x: -6, y: -5 });
// Levitation check: hold straight up in free air.
const holdUp = () => ({ x: 0, y: 12 });
// Pump: rhythmic plant-left / lift to walk right.
const pumpRight = (t) => (Math.sin(t * 4) > 0 ? { x: -6, y: -4 } : { x: -1, y: 3 });
// Climb: aim at the step's top-right area to hook and pull up onto it.
const climb = (t) => (Math.sin(t * 3) > -0.2 ? { x: 6, y: 0.5 } : { x: 1, y: 4 });

const base = { iterations: 8, cauldronMass: 8, cauldronLinDamp: 0.35, kp: 260, kd: 30, maxForce: 1300, reactScale: 1, reachMul: 1 };

// Two-phase hook-and-pull onto a step: plant the head on the step's top-left
// corner, then pull down-left to lever the body up onto it.
function hookClimb(stepX0, stepTop) {
  return (t) => {
    const phase = (t % 1.6) / 1.6;
    if (phase < 0.55) return { x: stepX0 + 0.1, y: stepTop + 0.3 }; // reach & plant on the lip
    return { x: -3, y: -1 };                                        // pull toward/under body
  };
}

const FINAL = { ...base, cauldronMass: 6.5, kp: 360, kd: 34, reachMul: 1.7 };

const variants = [
  { name: 'FINAL m6.5 kp360 reach1.7', p: FINAL },
  { name: 'alt  m6   kp380 reach1.8', p: { ...base, cauldronMass: 6, kp: 380, kd: 34, reachMul: 1.8 } },
];

for (const v of variants) {
  console.log(`\n--- ${v.name} ---`);
  fmt('  pushRight(flat)', run({ ...v.p }, pushRight, 240));
  fmt('  pumpRight(flat)', run({ ...v.p }, pumpRight, 480));
  fmt('  holdUp(levit?)', run({ ...v.p }, holdUp, 300));
  fmt('  hookClimb step1.2', run({ ...v.p, stepTop: 1.2, stepX0: 2.2 }, hookClimb(2.2, 1.2), 800));
}
