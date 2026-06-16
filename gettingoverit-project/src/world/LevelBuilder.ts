/**
 * world/LevelBuilder.ts
 * -----------------------------------------------------------------------------
 * Builds the "Climb of Patience" level: for every authored map object it
 * constructs a matching Three.js visual (under a single Group whose transform
 * equals the object's world transform) and one or more Rapier colliders on a
 * fixed rigid body sharing that transform. Visual sub-meshes and collider parts
 * use identical local transforms so what you see is what you climb.
 *
 * Every non-decorative collider handle is registered in `terrainHandles` so the
 * PhysicsManager can recognise climbable terrain for leverage maths.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SURFACE } from '../data/config';
import type { ClimbMap, MapObject, ObjectType } from '../data/mapData';

const DEG2RAD = Math.PI / 180;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Material-name -> colour mapping, re-flavoured for NATURE: every junk object
 * is reskinned as mossy stone, weathered wood, granite or snow so the whole
 * climb reads as an overgrown forest cliff rather than a scrapyard.
 */
function materialColor(name: string | undefined): number {
  const n = (name ?? '').toLowerCase();
  if (n.includes('snow') || n.includes('ice') || n.includes('frozen') || n.includes('observatory')) return 0xdfeaf0; // snowy peak
  if (n.includes('blue')) return 0x88b4c8;
  if (n.includes('wood') || n.includes('table') || n.includes('bookshelf') || n.includes('plank') || n.includes('chair') || n.includes('sofa')) return 0x6e4d31; // weathered wood / logs
  if (n.includes('brass') || n.includes('aluminum') || n.includes('steel') || n.includes('metal') || n.includes('rebar') || n.includes('pipe') || n.includes('antenna') || n.includes('rust')) return 0x5f6f50; // mossy weathered branch
  if (n.includes('rubber') || n.includes('tire') || n.includes('black') || n.includes('telescope')) return 0x3a4032; // dark mossy
  if (n.includes('concrete') || n.includes('cement') || n.includes('granite') || n.includes('rock') || n.includes('stone') || n.includes('boulder') || n.includes('cliff')) return 0x73726a; // grey stone
  if (n.includes('green') || n.includes('moss')) return 0x4f6b3e;
  if (n.includes('brick') || n.includes('red') || n.includes('sign')) return 0x8a6b4a; // earthy
  return 0x6a6c5a; // default mossy stone
}

export interface BuiltLevel {
  group: THREE.Group;
  terrainHandles: Set<number>;
}

export class LevelBuilder {
  private readonly scene: THREE.Scene;
  private readonly world: RAPIER.World;
  private readonly terrainHandles = new Set<number>();
  private readonly root = new THREE.Group();

  constructor(scene: THREE.Scene, world: RAPIER.World) {
    this.scene = scene;
    this.world = world;
  }

  build(map: ClimbMap): BuiltLevel {
    this.scene.add(this.root);

    // Safety catch-floor far below the start so falls during play/testing don't
    // drop the body out of the world. Wide, thin, invisible.
    this.addCatchFloor(map);

    for (const zone of map.zones) {
      for (const obj of zone.objects) {
        this.buildObject(obj);
      }
    }

    return { group: this.root, terrainHandles: this.terrainHandles };
  }

  /* ------------------------------------------------------------------ */
  /*  Per-object construction                                            */
  /* ------------------------------------------------------------------ */

  private buildObject(obj: MapObject): void {
    const rotZ = (obj.rotation ?? 0) * DEG2RAD;
    const decorative = obj.type === 'decorative';

    // Visual group at the object's world transform.
    const group = new THREE.Group();
    group.position.set(obj.position.x, obj.position.y, 0);
    group.rotation.z = rotZ;
    this.root.add(group);

    // Matching fixed physics body (skipped entirely for decorations).
    let body: RAPIER.RigidBody | null = null;
    if (!decorative) {
      const quat = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, rotZ);
      const desc = RAPIER.RigidBodyDesc.fixed()
        .setTranslation(obj.position.x, obj.position.y, 0)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
      body = this.world.createRigidBody(desc);
    }

    const ctx: PartCtx = { body, group, type: obj.type, color: materialColor(obj.material) };

    switch (obj.shape) {
      case 'rect':
      case 'roundedRect':
        this.box(ctx, 0, 0, 0, this.w(obj), this.h(obj), this.depth(obj.type));
        break;
      case 'circle':
        this.ball(ctx, 0, 0, obj.size?.radius ?? 1);
        break;
      case 'cylinder':
        this.cylinderAlongX(ctx, 0, 0, this.w(obj), this.h(obj) / 2);
        break;
      case 'semicircle':
        this.extruded(ctx, this.halfDiscPoints(this.w(obj) / 2), this.depth(obj.type, 1.4));
        break;
      case 'triangleRoof':
        this.extruded(
          ctx,
          [
            [-this.w(obj) / 2, 0],
            [this.w(obj) / 2, 0],
            [0, this.h(obj)],
          ],
          this.depth(obj.type, 1.6),
        );
        break;
      case 'irregularPolygon':
        this.extruded(ctx, (obj.points ?? []).map((p) => [p[0], p[1]] as [number, number]), 1.8);
        break;
      case 'ring':
        this.ring(ctx, 0, obj.size?.outerRadius ?? 2, obj.size?.innerRadius ?? 1.2);
        break;
      case 'stackedRings':
        this.stackedRings(ctx, obj);
        break;
      case 'staircase':
        this.staircase(ctx, obj);
        break;
      case 'ladder':
        this.ladder(ctx, this.w(obj), this.h(obj));
        break;
      case 'uHook':
        this.uHook(ctx, this.w(obj), this.h(obj));
        break;
      case 'curvedHook':
        this.curvedHook(ctx, this.w(obj), this.h(obj));
        break;
      case 'concaveDish':
        this.dish(ctx, this.w(obj), this.h(obj));
        break;
      case 'trussTower':
        this.trussTower(ctx, this.w(obj), this.h(obj));
        break;
      case 'flag':
        this.flag(ctx, this.w(obj), this.h(obj));
        break;
      case 'arch':
        this.arch(ctx, this.w(obj), this.h(obj));
        break;
      default:
        this.box(ctx, 0, 0, 0, this.w(obj), this.h(obj), this.depth(obj.type));
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Size helpers                                                       */
  /* ------------------------------------------------------------------ */

  private w(o: MapObject): number {
    return o.size?.width ?? 1;
  }
  private h(o: MapObject): number {
    return o.size?.height ?? 1;
  }
  private depth(type: ObjectType, base = 1.2): number {
    return type === 'thin' ? Math.min(base, 0.55) : base;
  }
  private surfaceFor(type: ObjectType): { friction: number; restitution: number } {
    return SURFACE[type] ?? SURFACE.solid;
  }

  /* ------------------------------------------------------------------ */
  /*  Primitive part builders (mesh + collider share local transform)    */
  /* ------------------------------------------------------------------ */

  private box(
    ctx: PartCtx,
    lx: number,
    ly: number,
    lrot: number,
    width: number,
    height: number,
    depth: number,
  ): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(width, 0.02), Math.max(height, 0.02), depth),
      this.mat(ctx.color),
    );
    mesh.position.set(lx, ly, 0);
    mesh.rotation.z = lrot;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    ctx.group.add(mesh);

    // Grassy/mossy cap on the top of broad climbable ledges.
    if ((ctx.type === 'solid' || ctx.type === 'thin') && width > 0.8 && width >= height * 0.85) {
      const capH = 0.14;
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.99, capH, depth * 1.02),
        this.mossMat(),
      );
      cap.position.set(lx, ly + height / 2 + capH * 0.4, 0);
      cap.rotation.z = lrot;
      cap.receiveShadow = true;
      cap.castShadow = true;
      ctx.group.add(cap);
    }

    if (!ctx.body) return;
    const s = this.surfaceFor(ctx.type);
    const q = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, lrot);
    const desc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2)
      .setTranslation(lx, ly, 0)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setFriction(s.friction)
      .setRestitution(s.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.register(this.world.createCollider(desc, ctx.body));
  }

  private ball(ctx: PartCtx, lx: number, ly: number, radius: number): void {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 18), this.mat(ctx.color));
    mesh.position.set(lx, ly, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    ctx.group.add(mesh);

    if (!ctx.body) return;
    const s = this.surfaceFor(ctx.type);
    const desc = RAPIER.ColliderDesc.ball(radius)
      .setTranslation(lx, ly, 0)
      .setFriction(s.friction)
      .setRestitution(s.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.register(this.world.createCollider(desc, ctx.body));
  }

  /** Cylinder whose length runs along the group-local X axis. */
  private cylinderAlongX(ctx: PartCtx, lx: number, ly: number, length: number, radius: number): void {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 20),
      this.mat(ctx.color),
    );
    mesh.position.set(lx, ly, 0);
    mesh.rotation.z = -Math.PI / 2; // Y-aligned geometry -> X-aligned
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    ctx.group.add(mesh);

    if (!ctx.body) return;
    const s = this.surfaceFor(ctx.type);
    const q = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, -Math.PI / 2);
    const desc = RAPIER.ColliderDesc.cylinder(length / 2, radius)
      .setTranslation(lx, ly, 0)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setFriction(s.friction)
      .setRestitution(s.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.register(this.world.createCollider(desc, ctx.body));
  }

  /** Extrude a 2D shape (local XY) into z and build a convex-hull collider. */
  private extruded(ctx: PartCtx, pts2d: [number, number][], depth: number): void {
    if (pts2d.length < 3) return;

    const shape = new THREE.Shape();
    shape.moveTo(pts2d[0][0], pts2d[0][1]);
    for (let i = 1; i < pts2d.length; i++) shape.lineTo(pts2d[i][0], pts2d[i][1]);
    shape.closePath();

    const geom = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geom.translate(0, 0, -depth / 2); // centre on the plane
    const mesh = new THREE.Mesh(geom, this.mat(ctx.color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    ctx.group.add(mesh);

    if (!ctx.body) return;
    // Convex hull of the front+back faces.
    const verts: number[] = [];
    for (const p of pts2d) {
      verts.push(p[0], p[1], depth / 2);
      verts.push(p[0], p[1], -depth / 2);
    }
    const s = this.surfaceFor(ctx.type);
    const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(verts));
    if (hull) {
      hull
        .setFriction(s.friction)
        .setRestitution(s.restitution)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      this.register(this.world.createCollider(hull, ctx.body));
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Composite shapes                                                   */
  /* ------------------------------------------------------------------ */

  private halfDiscPoints(radius: number, segments = 16): [number, number][] {
    const pts: [number, number][] = [[-radius, 0]];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI;
      pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
    }
    return pts;
  }

  private ring(ctx: PartCtx, ly: number, outer: number, inner: number, segments = 14): void {
    const mean = (outer + inner) / 2;
    const thickness = Math.max(outer - inner, 0.12);
    const segLen = ((2 * Math.PI * mean) / segments) * 1.18;
    for (let k = 0; k < segments; k++) {
      const a = (k / segments) * Math.PI * 2;
      const x = Math.cos(a) * mean;
      const y = ly + Math.sin(a) * mean;
      this.box(ctx, x, y, a + Math.PI / 2, thickness, segLen, this.depth(ctx.type, 1.0));
    }
  }

  private stackedRings(ctx: PartCtx, obj: MapObject): void {
    const count = obj.count ?? 3;
    const outer = obj.size?.outerRadius ?? 1.1;
    const inner = obj.size?.innerRadius ?? 0.55;
    const step = (outer - inner) + inner * 0.6;
    for (let i = 0; i < count; i++) {
      this.ring(ctx, i * step * 1.1, outer, inner, 12);
    }
  }

  private staircase(ctx: PartCtx, obj: MapObject): void {
    const steps = obj.steps ?? 4;
    const sw = obj.stepSize?.width ?? 1.2;
    const sh = obj.stepSize?.height ?? 0.7;
    for (let i = 0; i < steps; i++) {
      // Each tread sits one step higher and shifts to form a staircase.
      this.box(ctx, i * sw * 0.6, i * sh, 0, sw, sh, this.depth(ctx.type, 1.2));
    }
  }

  private ladder(ctx: PartCtx, width: number, height: number): void {
    const rail = Math.max(width * 0.08, 0.08);
    // Two side rails.
    this.box(ctx, -width / 2, 0, 0, rail, height, 0.4);
    this.box(ctx, width / 2, 0, 0, rail, height, 0.4);
    // Rungs.
    const rungs = Math.max(2, Math.floor(height / 0.55));
    for (let i = 0; i <= rungs; i++) {
      const y = -height / 2 + (i / rungs) * height;
      this.box(ctx, 0, y, 0, width, rail, 0.4);
    }
  }

  private uHook(ctx: PartCtx, width: number, height: number): void {
    const t = Math.max(width * 0.18, 0.12);
    this.box(ctx, 0, -height / 2 + t / 2, 0, width, t, 0.5); // base
    this.box(ctx, -width / 2 + t / 2, 0, 0, t, height, 0.5); // left
    this.box(ctx, width / 2 - t / 2, 0, 0, t, height, 0.5); // right
  }

  private curvedHook(ctx: PartCtx, width: number, height: number): void {
    const t = Math.max(width * 0.16, 0.1);
    this.box(ctx, 0, 0, 0, t, height, 0.5); // post
    this.box(ctx, width / 2 - t / 2, height / 2 - t / 2, 0, width, t, 0.5); // arm
  }

  private dish(ctx: PartCtx, width: number, _height: number): void {
    // Shallow upward-opening cradle made of an arc of small boxes.
    const r = width * 0.7;
    const segs = 7;
    const spread = Math.PI * 0.9; // ~160°
    const t = 0.18;
    const segLen = ((spread * r) / segs) * 1.2;
    for (let i = 0; i <= segs; i++) {
      const a = -Math.PI / 2 - spread / 2 + (i / segs) * spread; // centred at bottom
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r + r; // lift so the opening faces up
      this.box(ctx, x, y, a + Math.PI / 2, t, segLen, this.depth(ctx.type, 1.0));
    }
  }

  private trussTower(ctx: PartCtx, width: number, height: number): void {
    const rail = Math.max(width * 0.1, 0.12);
    // Slightly tapered side rails.
    this.box(ctx, -width / 2, 0, 0.06, rail, height, 0.5);
    this.box(ctx, width / 2, 0, -0.06, rail, height, 0.5);
    // Crossbars.
    const bars = Math.max(3, Math.floor(height / 2));
    for (let i = 0; i <= bars; i++) {
      const y = -height / 2 + (i / bars) * height;
      this.box(ctx, 0, y, 0, width, rail * 0.8, 0.5);
      // Alternating diagonal braces.
      const diag = i % 2 === 0 ? 0.5 : -0.5;
      this.box(ctx, 0, y + height / bars / 2, diag, width * 1.1, rail * 0.5, 0.45);
    }
  }

  /* --- Decorative-only shapes (no colliders) ------------------------- */

  private flag(ctx: PartCtx, width: number, height: number): void {
    this.box(ctx, 0, 0, 0, 0.08, height, 0.08); // pole (ctx.body is null -> mesh only)
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height * 0.5),
      new THREE.MeshStandardMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide, roughness: 0.9 }),
    );
    cloth.position.set(width / 2, height / 2 - 0.2, 0);
    ctx.group.add(cloth);
  }

  private arch(ctx: PartCtx, width: number, height: number): void {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xbfe6ff,
      emissive: 0x6fa8c7,
      emissiveIntensity: 0.8,
      roughness: 0.4,
    });
    const post = (x: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, height, 0.2), mat);
      m.position.set(x, 0, 0);
      ctx.group.add(m);
    };
    post(-width / 2);
    post(width / 2);
    const top = new THREE.Mesh(new THREE.BoxGeometry(width + 0.2, 0.2, 0.2), mat);
    top.position.set(0, height / 2, 0);
    ctx.group.add(top);
  }

  /* ------------------------------------------------------------------ */

  private addCatchFloor(map: ClimbMap): void {
    const width = map.worldBounds.maxX - map.worldBounds.minX + 20;
    const cx = (map.worldBounds.maxX + map.worldBounds.minX) / 2;
    const halfHeight = 1;
    const halfDepth = 4;
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(width, halfHeight * 2, halfDepth * 2),
      new THREE.MeshStandardMaterial({ color: 0x5a4d39, roughness: 1.0, metalness: 0.02 }),
    );
    ground.position.set(cx, -3, 0);
    ground.receiveShadow = true;
    ground.castShadow = true;
    this.root.add(ground);

    const moss = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.995, 0.24, halfDepth * 2.04),
      this.mossMat(),
    );
    moss.position.set(cx, -1.88, 0);
    moss.receiveShadow = true;
    moss.castShadow = true;
    this.root.add(moss);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(cx, -3, 0),
    );
    const desc = RAPIER.ColliderDesc.cuboid(width / 2, halfHeight, halfDepth)
      .setFriction(0.6)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.register(this.world.createCollider(desc, body));
    // No mesh — invisible safety net.
  }

  private register(collider: RAPIER.Collider): void {
    this.terrainHandles.add(collider.handle);
  }

  private mat(color: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.04 });
  }

  private mossMat(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x5d8a3f, roughness: 1.0, metalness: 0.0 });
  }
}

interface PartCtx {
  body: RAPIER.RigidBody | null;
  group: THREE.Group;
  type: ObjectType;
  color: number;
}
