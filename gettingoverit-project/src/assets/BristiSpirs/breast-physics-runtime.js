import { Matrix4, Vector3 } from 'three'

const DEFAULT_BONE_NAMES = ['breast_l', 'breast_r']

function collectBones(root, requestedBoneNames = DEFAULT_BONE_NAMES) {
  const requested = new Set(requestedBoneNames.map((name) => String(name).trim().toLowerCase()).filter(Boolean))
  const bones = []

  root?.traverse?.((child) => {
    if (child?.type !== 'Bone') return
    const normalizedName = String(child.name ?? '').trim().toLowerCase()
    if (!requested.has(normalizedName)) return
    bones.push(child)
  })

  return bones
}

export class BreastPhysicsController {
  constructor(root, config = {}) {
    this.root = root
    this.stiffness = Number.isFinite(Number(config.stiffness)) ? Math.max(0, Number(config.stiffness)) : 30
    this.damping = Number.isFinite(Number(config.damping)) ? Math.max(0, Number(config.damping)) : 5
    this.gravity = Number.isFinite(Number(config.gravity)) ? Number(config.gravity) : 0
    this.mass = Number.isFinite(Number(config.mass)) ? Math.max(0.05, Number(config.mass)) : 1
    this.enabled = config.enabled !== false
    this.states = []
    this._scratchTargetWorld = new Vector3()
    this._scratchDisplacement = new Vector3()
    this._scratchForce = new Vector3()
    this._scratchLocal = new Vector3()
    this._scratchInverseParentMatrix = new Matrix4()

    this.register(config.bone_names ?? DEFAULT_BONE_NAMES)
  }

  register(boneNames = DEFAULT_BONE_NAMES) {
    this.states = []
    this.root?.updateWorldMatrix?.(true, true)

    for (const bone of collectBones(this.root, boneNames)) {
      const bindLocalPosition = bone.position.clone()
      const initialWorldPosition = new Vector3()
      bone.getWorldPosition(initialWorldPosition)

      this.states.push({
        bone,
        bindLocalPosition,
        simulatedWorldPosition: initialWorldPosition.clone(),
        velocity: new Vector3()
      })
    }

    return this.states.length
  }

  reset() {
    for (const state of this.states) {
      state.bone.position.copy(state.bindLocalPosition)
      state.bone.updateMatrix()
      state.bone.updateMatrixWorld(true)
      state.bone.getWorldPosition(state.simulatedWorldPosition)
      state.velocity.set(0, 0, 0)
    }
  }

  update(deltaTime) {
    if (!this.enabled || this.states.length === 0) return

    const dt = Math.min(Math.max(Number(deltaTime) || 0, 0), 1 / 30)
    if (dt <= 0) return

    for (const state of this.states) {
      const parent = state.bone.parent
      if (parent === null) continue

      state.bone.position.copy(state.bindLocalPosition)
      state.bone.updateMatrix()
      state.bone.updateMatrixWorld(true)
      state.bone.getWorldPosition(this._scratchTargetWorld)

      this._scratchDisplacement.subVectors(this._scratchTargetWorld, state.simulatedWorldPosition)
      this._scratchForce.copy(this._scratchDisplacement).multiplyScalar(this.stiffness)
      this._scratchForce.addScaledVector(state.velocity, -this.damping)
      this._scratchForce.y += this.gravity * this.mass

      const inverseMass = 1 / this.mass
      state.velocity.addScaledVector(this._scratchForce, dt * inverseMass)
      state.simulatedWorldPosition.addScaledVector(state.velocity, dt)

      this._scratchInverseParentMatrix.copy(parent.matrixWorld).invert()
      this._scratchLocal.copy(state.simulatedWorldPosition).applyMatrix4(this._scratchInverseParentMatrix)

      state.bone.position.copy(this._scratchLocal)
      state.bone.updateMatrix()
      state.bone.updateMatrixWorld(true)
    }
  }
}

export function attachBreastPhysics(root, config = {}) {
  return new BreastPhysicsController(root, config)
}

export async function loadBreastPhysicsConfig(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to load breast physics config from ${url}`)
  }

  return await response.json()
}
