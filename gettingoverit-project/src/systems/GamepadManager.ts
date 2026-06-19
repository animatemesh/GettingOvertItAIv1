/**
 * systems/GamepadManager.ts
 * Wraps the browser Gamepad API and exposes a per-frame polling interface
 * designed for a DualSense (or any standard-layout gamepad).
 *
 * Standard button indices:
 *   0 Cross, 1 Circle, 2 Square, 3 Triangle
 *   4 L1,    5 R1,    6 L2,     7 R2
 *   8 Create/Share,   9 Options
 *   10 L3,   11 R3
 *   12 D-up, 13 D-down, 14 D-left, 15 D-right
 *
 * Axes:
 *   0 Left X, 1 Left Y, 2 Right X, 3 Right Y  (all -1 to +1)
 */

import * as THREE from 'three';

export const GP = {
  CROSS:     0,
  CIRCLE:    1,
  SQUARE:    2,
  TRIANGLE:  3,
  L1:        4,
  R1:        5,
  L2:        6,
  R2:        7,
  SHARE:     8,
  OPTIONS:   9,
  L3:        10,
  R3:        11,
  DPAD_UP:   12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT:15,
} as const;

const DEADZONE = 0.14;

export class GamepadManager {
  /** Current virtual cursor in NDC space [-1.4, 1.4]. Drives hammer aim. */
  readonly virtualNdc = new THREE.Vector2(0, 0.2);

  private gpIndex: number | null = null;
  private prev: boolean[] = [];
  private curr: boolean[] = [];
  private axes: number[] = [];
  private triggers: number[] = [];

  constructor() {
    window.addEventListener('gamepadconnected',    this.onConnected);
    window.addEventListener('gamepaddisconnected', this.onDisconnected);
    // Scan for already-connected gamepads (page load after connect).
    for (const gp of navigator.getGamepads()) {
      if (gp) { this.gpIndex = gp.index; break; }
    }
  }

  get connected(): boolean {
    return this.gpIndex !== null;
  }

  /**
   * Call once at the top of every rendered frame (before consuming button
   * edges). Pass the frame dt and current sensitivity so cursor speed matches
   * the mouse sensitivity setting.
   */
  poll(realDt: number, sensitivity: number): void {
    if (this.gpIndex === null) return;
    const gp = navigator.getGamepads()[this.gpIndex];
    if (!gp) return;

    // Snapshot button states for edge detection.
    this.prev = this.curr.length ? this.curr : new Array(gp.buttons.length).fill(false);
    this.curr = gp.buttons.map((b) => b.pressed || b.value > 0.5);
    this.triggers = gp.buttons.map((b) => b.value);
    this.axes = Array.from(gp.axes);

    // Left stick moves virtual cursor; sensitivity is NDC/s at full deflection.
    const lx =  applyDeadzone(this.axes[0] ?? 0, DEADZONE);
    const ly = -applyDeadzone(this.axes[1] ?? 0, DEADZONE); // invert Y
    const speed = Math.max(0.2, sensitivity);
    this.virtualNdc.x = clamp(this.virtualNdc.x + lx * speed * realDt, -1.4, 1.4);
    this.virtualNdc.y = clamp(this.virtualNdc.y + ly * speed * realDt, -1.4, 1.4);
  }

  /** True while the button is held this frame. */
  held(btn: number): boolean {
    return this.curr[btn] ?? false;
  }

  /** True on the frame the button transitions low→high. */
  justPressed(btn: number): boolean {
    return (this.curr[btn] ?? false) && !(this.prev[btn] ?? false);
  }

  /** True on the frame the button transitions high→low. */
  justReleased(btn: number): boolean {
    return !(this.curr[btn] ?? false) && (this.prev[btn] ?? false);
  }

  /** Raw axis value after deadzone, -1..1. */
  axis(index: number): number {
    return applyDeadzone(this.axes[index] ?? 0, DEADZONE);
  }

  /** Analog trigger value 0..1 (reads button.value, not the digital threshold). */
  triggerValue(btn: number): number {
    return Math.max(0, Math.min(1, this.triggers[btn] ?? 0));
  }

  /** Nudge the virtual cursor to match the last real pointer event (keeps them in sync). */
  syncNdc(ndcX: number, ndcY: number): void {
    this.virtualNdc.set(ndcX, ndcY);
  }

  dispose(): void {
    window.removeEventListener('gamepadconnected',    this.onConnected);
    window.removeEventListener('gamepaddisconnected', this.onDisconnected);
  }

  private onConnected = (e: GamepadEvent): void => {
    if (this.gpIndex === null) {
      this.gpIndex = e.gamepad.index;
      console.info(`[Gamepad] Connected: ${e.gamepad.id}`);
    }
  };

  private onDisconnected = (e: GamepadEvent): void => {
    if (this.gpIndex === e.gamepad.index) {
      this.gpIndex = null;
      this.curr = [];
      this.prev = [];
      console.info('[Gamepad] Disconnected');
    }
  };
}

function applyDeadzone(v: number, dz: number): number {
  if (Math.abs(v) < dz) return 0;
  return (v - Math.sign(v) * dz) / (1 - dz);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
