/**
 * mapData.ts
 * -----------------------------------------------------------------------------
 * Typed transcription of the original "Climb of Patience" map declared inside
 * AI_DIRECTIVES.txt. This is an original, non-copying surreal junkyard climb.
 *
 * Coordinates follow the directives: x = horizontal, y = vertical, origin at
 * the bottom-left of the world. The game plays on the z = 0 plane.
 */

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

export const CLIMB_OF_PATIENCE: ClimbMap = {
  mapName: 'Climb of Patience',
  style: 'surreal junkyard vertical climbing challenge',
  gravity: 9.81,
  worldBounds: { minX: -25, maxX: 35, minY: 0, maxY: 180 },
  playerStart: { x: 0, y: 2.3 },
  zones: [
    {
      id: 'zone_01_rust_pit',
      name: 'Rust Pit',
      yRange: [0, 18],
      mood: 'dirty, cramped, metallic',
      description:
        'The starting area is a shallow industrial pit filled with rusted containers, bent metal sheets, and broken pipes.',
      objects: [
        { id: 'start_bowl', type: 'solid', shape: 'concaveDish', position: { x: 0, y: 0.3 }, size: { width: 3.6, height: 1.7 }, rotation: 0, material: 'dark metal', notes: 'Starting container - concave cradle the cauldron rests in.' },
        { id: 'left_wall_low', type: 'solid', shape: 'rect', position: { x: -5, y: 4 }, size: { width: 1.2, height: 8 }, rotation: 0, material: 'concrete' },
        { id: 'rust_pipe_01', type: 'round', shape: 'cylinder', position: { x: 2.2, y: 4.7 }, size: { width: 5.6, height: 0.9 }, rotation: -18, material: 'rusted pipe', difficulty: 'easy hook' },
        { id: 'metal_plate_01', type: 'solid', shape: 'rect', position: { x: -1.2, y: 8.3 }, size: { width: 6.4, height: 0.45 }, rotation: 12, material: 'bent sheet metal' },
        { id: 'trash_barrel_01', type: 'round', shape: 'circle', position: { x: 4.8, y: 10.8 }, size: { radius: 1.25 }, material: 'blue plastic barrel', difficulty: 'rolling-like curved surface' },
        { id: 'scrap_step_01', type: 'thin', shape: 'rect', position: { x: 2.8, y: 13.2 }, size: { width: 2.8, height: 0.35 }, rotation: 6, material: 'rusted catwalk' },
        { id: 'exit_pipe_ledge', type: 'thin', shape: 'rect', position: { x: 0.5, y: 15.2 }, size: { width: 5.4, height: 0.36 }, rotation: -8, material: 'narrow pipe' },
      ],
    },
    {
      id: 'zone_02_drainpipe_yard',
      name: 'Drainpipe Yard',
      yRange: [18, 38],
      mood: 'wet, grey, industrial',
      description: 'A vertical yard made from stacked concrete drainage pipes.',
      objects: [
        { id: 'concrete_pipe_stack_01', type: 'round', shape: 'ring', position: { x: -3.5, y: 21.5 }, size: { outerRadius: 2.4, innerRadius: 1.4 }, material: 'concrete' },
        { id: 'concrete_pipe_stack_02', type: 'round', shape: 'ring', position: { x: 3.2, y: 25.4 }, size: { outerRadius: 2.7, innerRadius: 1.55 }, material: 'concrete' },
        { id: 'maintenance_ledge_01', type: 'thin', shape: 'rect', position: { x: 0.3, y: 28.8 }, size: { width: 3.1, height: 0.32 }, rotation: 4, material: 'service catwalk' },
        { id: 'sloped_drain_wall', type: 'slippery', shape: 'rect', position: { x: 7.8, y: 28.2 }, size: { width: 1.6, height: 10.5 }, rotation: -16, material: 'wet concrete' },
        { id: 'small_rebar_hook_01', type: 'thin', shape: 'rect', position: { x: 2.8, y: 31.5 }, size: { width: 0.34, height: 3.4 }, rotation: 70, material: 'exposed rebar', difficulty: 'precise hook' },
        { id: 'drain_brace_01', type: 'thin', shape: 'rect', position: { x: 4.8, y: 33.2 }, size: { width: 2.6, height: 0.28 }, rotation: -14, material: 'pipe brace' },
        { id: 'hanging_pipe_01', type: 'round', shape: 'cylinder', position: { x: -1.2, y: 35.5 }, size: { width: 6.6, height: 0.75 }, rotation: 6, material: 'steel pipe' },
      ],
    },
    {
      id: 'zone_03_furniture_collapse',
      name: 'Furniture Collapse',
      yRange: [38, 62],
      mood: 'absurd, domestic, unstable-looking',
      description: 'A chaotic tower of household objects: tables, wardrobes, chairs, shelves, cushions, and drawers.',
      objects: [
        { id: 'sofa_base', type: 'solid', shape: 'roundedRect', position: { x: -1.2, y: 41 }, size: { width: 7.5, height: 2 }, rotation: -4, material: 'old green sofa' },
        { id: 'chair_back_01', type: 'thin', shape: 'rect', position: { x: 3.6, y: 45.4 }, size: { width: 0.5, height: 4.5 }, rotation: 22, material: 'wood chair back' },
        { id: 'table_top_01', type: 'solid', shape: 'rect', position: { x: -3.6, y: 48.3 }, size: { width: 6.8, height: 0.45 }, rotation: 9, material: 'dark wooden table' },
        { id: 'ottoman_rest', type: 'solid', shape: 'roundedRect', position: { x: 1.4, y: 50.5 }, size: { width: 2.4, height: 0.75 }, rotation: 5, material: 'fabric ottoman' },
        { id: 'bookshelf_leaning', type: 'solid', shape: 'rect', position: { x: 2.1, y: 52.5 }, size: { width: 1.8, height: 8.5 }, rotation: -12, material: 'brown bookshelf' },
        { id: 'drawer_steps', type: 'solid', shape: 'staircase', position: { x: -3.4, y: 56 }, steps: 4, stepSize: { width: 1.4, height: 0.72 }, rotation: 0, material: 'white drawers' },
        { id: 'dresser_top', type: 'solid', shape: 'rect', position: { x: -0.2, y: 57.2 }, size: { width: 3.3, height: 0.4 }, rotation: -6, material: 'dresser top' },
        { id: 'lamp_hook', type: 'thin', shape: 'curvedHook', position: { x: 1.8, y: 59.7 }, size: { width: 1.8, height: 2.8 }, rotation: -24, material: 'brass floor lamp', difficulty: 'swing hook' },
      ],
    },
    {
      id: 'zone_04_tool_shed_wall',
      name: 'Tool Shed Wall',
      yRange: [62, 86],
      mood: 'sharp, narrow, mechanical',
      description: 'A steep wall made of ladders, planks, saw blades, clamps, buckets, and shelves.',
      objects: [
        { id: 'vertical_plank_wall', type: 'solid', shape: 'rect', position: { x: -6.5, y: 70 }, size: { width: 1.5, height: 18 }, rotation: 5, material: 'wooden shed wall' },
        { id: 'ladder_01', type: 'thin', shape: 'ladder', position: { x: -2.4, y: 67.5 }, size: { width: 2.6, height: 8.5 }, rotation: -8, material: 'aluminum ladder', notes: 'Each rung should be collidable.' },
        { id: 'paint_bucket_01', type: 'round', shape: 'circle', position: { x: 2.4, y: 70.8 }, size: { radius: 1.15 }, material: 'paint bucket' },
        { id: 'crate_bridge_01', type: 'solid', shape: 'rect', position: { x: 0.8, y: 73.0 }, size: { width: 2.8, height: 0.55 }, rotation: 7, material: 'tool crate lid' },
        { id: 'workbench_top', type: 'solid', shape: 'rect', position: { x: 4.4, y: 75.3 }, size: { width: 8.6, height: 0.6 }, rotation: -3, material: 'scratched workbench' },
        { id: 'clamp_hook_01', type: 'thin', shape: 'uHook', position: { x: 0.4, y: 79.8 }, size: { width: 1.9, height: 2.2 }, rotation: 14, material: 'red metal clamp', difficulty: 'precise inward hook' },
        { id: 'upper_support_01', type: 'thin', shape: 'rect', position: { x: -0.6, y: 82.1 }, size: { width: 3.4, height: 0.28 }, rotation: 10, material: 'support brace' },
        { id: 'thin_shelf_exit', type: 'thin', shape: 'rect', position: { x: -3, y: 84.2 }, size: { width: 5.8, height: 0.32 }, rotation: 0, material: 'thin shelf' },
      ],
    },
    {
      id: 'zone_05_roof_maze',
      name: 'Roof Maze',
      yRange: [86, 112],
      mood: 'suburban, windy, exposed',
      description: 'A series of rooftops, chimneys, gutters, and satellite dishes. Falling here can send the player back several zones.',
      objects: [
        { id: 'roof_left', type: 'solid', shape: 'triangleRoof', position: { x: -5.5, y: 90 }, size: { width: 10, height: 4.2 }, rotation: 0, material: 'red roof tiles' },
        { id: 'chimney_01', type: 'solid', shape: 'rect', position: { x: -2.1, y: 95.4 }, size: { width: 1.7, height: 4.6 }, rotation: 0, material: 'brick chimney' },
        { id: 'gutter_line_01', type: 'thin', shape: 'rect', position: { x: 3.2, y: 94.6 }, size: { width: 8.6, height: 0.25 }, rotation: -8, material: 'metal gutter' },
        { id: 'satellite_dish', type: 'round', shape: 'concaveDish', position: { x: 6, y: 99.4 }, size: { width: 4.2, height: 2.0 }, rotation: 24, material: 'grey satellite dish', difficulty: 'launch bowl' },
        { id: 'roof_bridge_01', type: 'thin', shape: 'rect', position: { x: 0.8, y: 100.8 }, size: { width: 4.4, height: 0.32 }, rotation: 6, material: 'roof ridge plank' },
        { id: 'roof_right', type: 'solid', shape: 'triangleRoof', position: { x: 0.6, y: 104.5 }, size: { width: 11.5, height: 5.3 }, rotation: 0, material: 'black shingles' },
        { id: 'vent_rest_01', type: 'solid', shape: 'rect', position: { x: -0.8, y: 107.2 }, size: { width: 2.6, height: 0.55 }, rotation: 0, material: 'roof vent' },
        { id: 'antenna_hook_low', type: 'thin', shape: 'rect', position: { x: -3.5, y: 109.5 }, size: { width: 0.34, height: 5.6 }, rotation: -28, material: 'bent antenna' },
      ],
      dangerDrops: [
        { id: 'roof_drop_left', area: { xMin: -20, xMax: -9, yMin: 70, yMax: 100 }, effect: 'fall back to Tool Shed Wall' },
      ],
    },
    {
      id: 'zone_06_cliffside_junk_trail',
      name: 'Cliffside Junk Trail',
      yRange: [112, 138],
      mood: 'lonely, rocky, unstable',
      description: 'The environment changes from human junk to natural cliff. Rusted cars, tires, road signs, and boulders embedded in the rock face.',
      objects: [
        {
          id: 'main_cliff_wall',
          type: 'solid',
          shape: 'irregularPolygon',
          position: { x: -8, y: 124 },
          points: [
            [-2, -12],
            [1, -9],
            [-1, -5],
            [2, -1],
            [0, 4],
            [3, 9],
            [-4, 12],
            [-5, -12],
          ],
          material: 'dark rock',
        },
        { id: 'half_car_body', type: 'solid', shape: 'roundedRect', position: { x: -2.4, y: 116.5 }, size: { width: 7, height: 2.3 }, rotation: -10, material: 'rusted car shell' },
        { id: 'tire_stack', type: 'round', shape: 'stackedRings', position: { x: 3.8, y: 121.5 }, count: 3, size: { outerRadius: 1.2, innerRadius: 0.6 }, rotation: 0, material: 'black rubber tires' },
        { id: 'road_sign_hook', type: 'thin', shape: 'rect', position: { x: -0.4, y: 126.8 }, size: { width: 0.36, height: 5.4 }, rotation: 42, material: 'bent road sign pole', difficulty: 'small diagonal catch' },
        { id: 'rock_shelf_01', type: 'solid', shape: 'rect', position: { x: 0.9, y: 128.6 }, size: { width: 3.6, height: 0.5 }, rotation: -8, material: 'stone shelf' },
        { id: 'boulder_01', type: 'round', shape: 'circle', position: { x: 2.8, y: 132.5 }, size: { radius: 2.0 }, material: 'granite boulder' },
        { id: 'stump_rest_01', type: 'solid', shape: 'roundedRect', position: { x: -4.1, y: 133.4 }, size: { width: 2.8, height: 0.7 }, rotation: 5, material: 'weathered stump' },
        { id: 'knife_edge_ledge', type: 'thin', shape: 'rect', position: { x: -2.8, y: 136.2 }, size: { width: 6.6, height: 0.3 }, rotation: 1, material: 'sharp rock ledge', difficulty: 'narrow rest point' },
      ],
    },
    {
      id: 'zone_07_frozen_observatory',
      name: 'Frozen Observatory',
      yRange: [138, 158],
      mood: 'cold, blue, slippery, quiet',
      description: 'A snowy high-altitude section with icy domes, telescope parts, frozen stairs, and glass panels.',
      objects: [
        { id: 'snow_slope_01', type: 'slippery', shape: 'rect', position: { x: 0.5, y: 141.5 }, size: { width: 10.5, height: 0.7 }, rotation: 12, material: 'packed snow' },
        { id: 'ice_shelf_01', type: 'thin', shape: 'rect', position: { x: -0.8, y: 145.0 }, size: { width: 4.4, height: 0.3 }, rotation: -5, material: 'ice ledge' },
        { id: 'ice_wall_left', type: 'slippery', shape: 'rect', position: { x: -5.2, y: 147.5 }, size: { width: 1.2, height: 10.4 }, rotation: -6, material: 'blue ice' },
        { id: 'observatory_dome', type: 'round', shape: 'semicircle', position: { x: 1.8, y: 149.2 }, size: { width: 8, height: 4.0 }, rotation: 0, material: 'white observatory dome' },
        { id: 'telescope_barrel', type: 'round', shape: 'cylinder', position: { x: 5.2, y: 153.4 }, size: { width: 7, height: 0.95 }, rotation: 28, material: 'black telescope tube' },
        { id: 'observation_platform', type: 'thin', shape: 'rect', position: { x: 2.6, y: 155.0 }, size: { width: 2.8, height: 0.28 }, rotation: 8, material: 'maintenance platform' },
        { id: 'frozen_ladder', type: 'thin', shape: 'ladder', position: { x: -2.2, y: 156.2 }, size: { width: 2.3, height: 5.6 }, rotation: 8, material: 'icy metal ladder' },
      ],
    },
    {
      id: 'zone_08_antenna_spire',
      name: 'Antenna Spire',
      yRange: [158, 174],
      mood: 'thin, dangerous, final test',
      description: 'A narrow final climb made from radio towers, cables, dishes, and tiny metal crossbars.',
      objects: [
        { id: 'radio_tower_base', type: 'thin', shape: 'trussTower', position: { x: 0.2, y: 162.2 }, size: { width: 4.8, height: 12.5 }, rotation: 0, material: 'red-white steel tower', notes: 'Diagonal braces and crossbars collidable.' },
        { id: 'crossbar_mid', type: 'thin', shape: 'rect', position: { x: 0.2, y: 160.7 }, size: { width: 3.8, height: 0.24 }, rotation: 2, material: 'steel brace' },
        { id: 'crossbar_01', type: 'thin', shape: 'rect', position: { x: -2.7, y: 164.2 }, size: { width: 5.4, height: 0.28 }, rotation: -8, material: 'steel' },
        { id: 'crossbar_02', type: 'thin', shape: 'rect', position: { x: 2.7, y: 167.4 }, size: { width: 5.4, height: 0.28 }, rotation: 10, material: 'steel' },
        { id: 'small_dish_final', type: 'round', shape: 'concaveDish', position: { x: -1.2, y: 170.2 }, size: { width: 3.2, height: 1.5 }, rotation: -18, material: 'small radio dish', difficulty: 'final launch cradle' },
        { id: 'final_brace_01', type: 'thin', shape: 'rect', position: { x: -0.4, y: 171.9 }, size: { width: 2.4, height: 0.22 }, rotation: -6, material: 'antenna bracket' },
        { id: 'needle_antenna', type: 'thin', shape: 'rect', position: { x: 0.7, y: 173 }, size: { width: 0.24, height: 5.2 }, rotation: 2, material: 'thin antenna mast', difficulty: 'final precise hook' },
      ],
      dangerDrops: [
        { id: 'spire_drop', area: { xMin: -12, xMax: 12, yMin: 145, yMax: 165 }, effect: 'fall back to Frozen Observatory or Cliffside Junk Trail' },
      ],
    },
    {
      id: 'zone_09_quiet_beyond',
      name: 'The Quiet Beyond',
      yRange: [174, 180],
      mood: 'peaceful, empty, surreal',
      description: 'The final area opens into a quiet sky-like space with a flat calm platform.',
      objects: [
        { id: 'final_platform', type: 'solid', shape: 'rect', position: { x: 0, y: 178 }, size: { width: 10, height: 0.5 }, rotation: 0, material: 'smooth pale stone' },
        { id: 'small_flag', type: 'decorative', shape: 'flag', position: { x: 3.5, y: 179 }, size: { width: 1.5, height: 2 }, material: 'white cloth' },
        { id: 'sky_gate', type: 'decorative', shape: 'arch', position: { x: 0, y: 181.5 }, size: { width: 6, height: 5 }, material: 'soft glowing outline' },
      ],
    },
  ],
  winCondition: {
    triggerArea: { xMin: -5, xMax: 5, yMin: 178, yMax: 182 },
    action: 'finishGame',
  },
};
