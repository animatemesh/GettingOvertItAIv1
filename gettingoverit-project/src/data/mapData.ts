/**
 * mapData.ts
 * -----------------------------------------------------------------------------
 * Types for the "Climb of Patience" map, plus the baked-in default map.
 *
 * The default map lives in `defaultMap.json` (authored in the in-game editor and
 * committed to version control) so it survives browser/origin/localStorage
 * changes. The editor still overrides it per-origin via localStorage — see
 * mapStore.ts. To change the permanent default, edit defaultMap.json (or export
 * a new one from /editor and replace it).
 *
 * Coordinates: x = horizontal, y = vertical, origin at the bottom-left of the
 * world. The game plays on the z = 0 plane.
 */

import defaultMap from './defaultMap.json';

export type ObjectType =
  | 'solid'
  | 'slippery'
  | 'round'
  | 'thin'
  | 'decorative'
  | 'dangerDrop';

export type ShapeKind =
  | 'rect'
  | 'roundedRect'
  | 'semicircle'
  | 'circle'
  | 'cylinder'
  | 'ring'
  | 'staircase'
  | 'curvedHook'
  | 'ladder'
  | 'uHook'
  | 'triangleRoof'
  | 'concaveDish'
  | 'irregularPolygon'
  | 'stackedRings'
  | 'trussTower'
  | 'flag'
  | 'arch';

export interface Vec2 {
  x: number;
  y: number;
}

export interface MapObject {
  id: string;
  type: ObjectType;
  shape: ShapeKind;
  position: Vec2;
  size?: {
    width?: number;
    height?: number;
    radius?: number;
    outerRadius?: number;
    innerRadius?: number;
  };
  rotation?: number;
  material?: string;
  difficulty?: string;
  notes?: string;
  steps?: number;
  stepSize?: { width: number; height: number };
  count?: number;
  points?: [number, number][];
}

export interface DangerDrop {
  id: string;
  area: { xMin: number; xMax: number; yMin: number; yMax: number };
  effect: string;
}

export interface Zone {
  id: string;
  name: string;
  yRange: [number, number];
  mood: string;
  description: string;
  objects: MapObject[];
  dangerDrops?: DangerDrop[];
}

export interface WinCondition {
  triggerArea: { xMin: number; xMax: number; yMin: number; yMax: number };
  action: string;
}

export interface ClimbMap {
  mapName: string;
  style: string;
  gravity: number;
  worldBounds: { minX: number; maxX: number; minY: number; maxY: number };
  playerStart: Vec2;
  zones: Zone[];
  winCondition: WinCondition;
}

export const CLIMB_OF_PATIENCE: ClimbMap = defaultMap as unknown as ClimbMap;
