/**
 * data/hammers.ts
 * -----------------------------------------------------------------------------
 * The selectable hammers and their LMB special abilities. Visuals (colours) and
 * the ability tuning live here; the AbilityController reads these to drive the
 * physics. Switch owned hammers with number keys 1-7 (see Game.ts).
 */

export type HammerId =
  | 'basic'
  | 'thor'
  | 'ice'
  | 'spiderman'
  | 'phoenix'
  | 'magnetar'
  | 'comet';

export interface HammerKind {
  id: HammerId;
  /** Display name (HUD). */
  name: string;
  /** One-line ability hint (HUD). */
  ability: string;
  /** Hammer head colour. */
  headColor: number;
  /** Hammer shaft colour. */
  shaftColor: number;
  /** Seconds before the ability can fire again (0 = no cooldown). */
  cooldownSec: number;
  /** Coin cost in the shop (0 = owned from the start). */
  price: number;
}

export const HAMMERS: Record<HammerId, HammerKind> = {
  basic: {
    id: 'basic',
    name: 'Yosemite',
    ability: 'Plain hammer - no special move',
    headColor: 0xb04a2a,
    shaftColor: 0x6b4a2f,
    cooldownSec: 0,
    price: 0,
  },
  thor: {
    id: 'thor',
    name: 'Mjolnir',
    ability: 'LMB: god-slam launch into the sky',
    headColor: 0x9fb8d8,
    shaftColor: 0x6b6f78,
    cooldownSec: 2.2,
    price: 100,
  },
  ice: {
    id: 'ice',
    name: 'Frostbite',
    ability: 'LMB: freeze + 3s slow-motion',
    headColor: 0x8fd8ef,
    shaftColor: 0xbfe9f5,
    cooldownSec: 6,
    price: 160,
  },
  spiderman: {
    id: 'spiderman',
    name: 'Web-Slinger',
    ability: 'Hold LMB: shoot a web and swing',
    headColor: 0xc0392b,
    shaftColor: 0x2a2a3a,
    cooldownSec: 0,
    price: 240,
  },
  phoenix: {
    id: 'phoenix',
    name: 'Skyfire',
    ability: 'LMB: fiery dash toward your cursor',
    headColor: 0xff7a1a,
    shaftColor: 0x5b2610,
    cooldownSec: 3.2,
    price: 360,
  },
  magnetar: {
    id: 'magnetar',
    name: 'Ironclaw',
    ability: 'LMB: yank your body toward the hammer head',
    headColor: 0x5ed3c8,
    shaftColor: 0x234449,
    cooldownSec: 4.2,
    price: 520,
  },
  comet: {
    id: 'comet',
    name: 'Starbreaker',
    ability: 'LMB: recoil blast away from your cursor',
    headColor: 0xf8d66d,
    shaftColor: 0x48392a,
    cooldownSec: 4.8,
    price: 760,
  },
};

export const HAMMER_ORDER: HammerId[] = [
  'basic',
  'thor',
  'ice',
  'spiderman',
  'phoenix',
  'magnetar',
  'comet',
];
