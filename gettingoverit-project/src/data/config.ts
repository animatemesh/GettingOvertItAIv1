/**
 * config.ts
 * -----------------------------------------------------------------------------
 * Central tuning surface for the "Climb of Patience" clone.
 *
 * Every game-feel value the AI_Directives.txt mandate refers to (friction
 * coefficients, mass distribution between the cauldron and the hammer, linear
 * damping, spring/PD forces, camera tracking offsets, fog depth, leverage
 * thresholds) lives here so the physics and rendering systems read from a single
 * calibrated source instead of scattering magic numbers across the codebase.
 *
 * The numbers are chosen to reproduce the "heavy, tense, punishing" weight
 * profile described in the directives: a heavy low-friction cauldron that can
 * only be translated by leveraging a comparatively light but rigid hammer.
 */

/** World gravity. The directives declare gravity 9.81 (downward). */
export const GRAVITY = { x: 0, y: -9.81, z: 0 } as const;

/**
 * Fixed physics timestep. We run the Rapier world on a deterministic
 * accumulator so the punishing leverage maths behave identically regardless of
 * the display refresh rate.
 */
export const FIXED_DT = 1 / 120;
/** Hard cap on substeps per frame so a stalled tab cannot spiral the sim. */
export const MAX_SUBSTEPS = 8;

/** The single gameplay plane. All bodies are pinned to z = PLANE_Z. */
export const PLANE_Z = 0;

/* -------------------------------------------------------------------------- */
/*  Mass distribution & damping (the "weight" profile)                        */
/* -------------------------------------------------------------------------- */

export const CAULDRON = {
  /** Base weight. Lighter than a true GOI pot so the climb is more forgiving. */
  mass: 8.0,
  /** Mid friction at the base so it grips rests but can still slide off. */
  friction: 0.7,
  restitution: 0.0,
  /** Linear damping keeps the cauldron from skating forever after a vault. */
  linearDamping: 0.35,
  /** Angular damping so the pot rocks but settles, never spins freely. */
  angularDamping: 0.9,
  /** Visual + collision radius of the rounded cauldron base. */
  radius: 0.85,
  /** Half-height of the cylindrical body of the pot. */
  halfHeight: 0.6,
} as const;

export const HAMMER = {
  /** Comparatively light so the player can swing it quickly... */
  mass: 2.2,
  /** ...but the head is dense, concentrating mass for leverage. */
  headMass: 1.6,
  /** Very high friction head so it bites ledges hard instead of skating. */
  friction: 1.4,
  restitution: 0.0,
  linearDamping: 0.25,
  angularDamping: 1.2,
  /** Length of the handle from grip pivot to the head. */
  handleLength: 2.4,
  /** Handle radius (thin shaft). */
  handleRadius: 0.07,
  /** Half-extents of the blocky Yosemite-style hammer head. */
  headHalfExtents: { x: 0.42, y: 0.26, z: 0.26 },
} as const;

/* -------------------------------------------------------------------------- */
/*  Hammer steering (Direct mouse -> hammer PD control)                        */
/* -------------------------------------------------------------------------- */

export const STEERING = {
  /** Proportional gain pulling the head toward the cursor target. */
  kp: 260.0,
  /** Derivative gain damping the head velocity (prevents jitter/overshoot). */
  kd: 30.0,
  /** Maximum steering force magnitude so the hammer can't teleport. */
  maxForce: 1300.0,
  /**
   * Maximum reach of the cursor target measured from the cauldron pivot.
   * Caps how far the handle can extend regardless of where the mouse goes.
   */
  maxReach: HAMMER.handleLength + 0.6,
  /** Minimum reach so the head can't be folded back through the body. */
  minReach: 0.5,
} as const;

/* -------------------------------------------------------------------------- */
/*  Leverage translation (PhysicsManager)                                      */
/* -------------------------------------------------------------------------- */

export const LEVERAGE = {
  /**
   * When the head is anchored on terrain, the normal component of the steering
   * force is converted into a counter-impulse on the cauldron. This is applied
   * ON TOP of the automatic reaction the grip joint already transmits, so it is
   * deliberately a modest *assist* (effective continuous force ≈ push · gain).
   * This is the single most important knob for vault feel — raise it for
   * snappier launches, lower it if the body feels twitchy or explosive.
   */
  gain: 0.6,
  /**
   * Coulomb-style slip threshold. Tangential leverage beyond
   * frictionSlip * normalForce is discarded (the head "slips" off the ledge).
   * Higher = the head holds sideways pulls better (more forgiving climbing).
   */
  frictionSlip: 1.2,
  /** Clamp on the per-substep counter-impulse so vaults stay survivable. */
  maxImpulse: 20.0,
  /** A contact counts as an "anchor" only when pressed harder than this (N). */
  anchorForceThreshold: 6.0,
} as const;

/* -------------------------------------------------------------------------- */
/*  Inverse kinematics (FABRIK)                                                */
/* -------------------------------------------------------------------------- */

export const IK = {
  /** FABRIK convergence iterations per frame. */
  iterations: 12,
  /** Stop early once the end effector is within this distance of the target. */
  tolerance: 0.001,
  /**
   * Minimum interior elbow angle (radians). The elbow may not straighten past
   * this nor fold tighter than its mirror, keeping the arm tense and anatomical.
   */
  minElbowAngle: 0.30,
  maxElbowAngle: Math.PI - 0.08,
  /** Per-arm bone rest lengths: upper arm, forearm, hand. */
  boneLengths: [0.46, 0.42, 0.16] as const,
} as const;

/* -------------------------------------------------------------------------- */
/*  Character model (BristiSpirs GLB) + breast secondary motion                */
/* -------------------------------------------------------------------------- */

export const MODEL = {
  /** Uniform scale applied to the loaded model to bring it to game scale. */
  scale: 1.7,
  /** Vertical offset so the legless torso sits down inside the pot. */
  yOffset: -0.25,
  /** Yaw (radians) to face the model toward the camera (+Z). */
  faceRotationY: 0,
  /** Grip points on the hammer handle (hammer-local; handle is +Y, 0..length). */
  rightGripLocal: { x: 0.02, y: 0.55, z: 0.0 },
  leftGripLocal: { x: -0.02, y: 0.86, z: 0.0 },
  /** Elbow pole bias added to a hand target (world): toward camera + down. */
  poleOffset: { x: 0.0, y: -0.5, z: 1.2 },
} as const;

/** Breast secondary-motion settings (ported from breast-physics.json). */
export const BREAST = {
  boneNames: ['breast_l', 'breast_r'],
  enabled: true,
  stiffness: 100,
  damping: 4,
  gravity: -1,
  mass: 0.1,
} as const;

/* -------------------------------------------------------------------------- */
/*  Camera & post / atmosphere                                                 */
/* -------------------------------------------------------------------------- */

export const CAMERA = {
  /** Perspective FOV. */
  fov: 42,
  near: 0.1,
  far: 400,
  /** Distance back along +Z from the gameplay plane. */
  distance: 16,
  /** Vertical lead so the player sees the next obstacle above them. */
  lookAheadY: 1.6,
  /** Soft-follow smoothing factor per second (directives: softFollow). */
  followLambda: 4.0,
} as const;

export const ATMOSPHERE = {
  /** Fog colour graded by height: warm forest-floor low, bright sky high. */
  skyLow: 0x4a5d3a,
  skyHigh: 0xbfe3f0,
  fogNear: 22,
  fogFar: 95,
} as const;

/* -------------------------------------------------------------------------- */
/*  Per-material surface tuning                                                */
/* -------------------------------------------------------------------------- */

/** Friction/restitution presets keyed by the directives' objectType values.
 *  Tuned grippy so the hammer holds and the climb is forgiving. */
export const SURFACE: Record<string, { friction: number; restitution: number }> = {
  solid: { friction: 1.1, restitution: 0.0 },
  round: { friction: 0.95, restitution: 0.02 },
  thin: { friction: 1.3, restitution: 0.0 },
  slippery: { friction: 0.18, restitution: 0.0 },
  decorative: { friction: 0.6, restitution: 0.0 },
  dangerDrop: { friction: 0.6, restitution: 0.0 },
};
