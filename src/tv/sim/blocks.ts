export type BlockType =
  | 'wood'
  | 'plank'
  | 'stone'
  | 'silver'
  | 'gold'
  | 'gem'
  | 'skull'
  | 'bomb'
  | 'chem'
  | 'ice'
  | 'ghost'
  | 'jenga'
  | 'crown';

export interface BlockTypeDef {
  /** points for knocking it off its stand (negative = penalty) */
  points: number;
  density: number;
  friction: number;
  restitution: number;
  label: string;
}

export const BLOCK_TYPES: Record<BlockType, BlockTypeDef> = {
  wood: { points: 1, density: 1.0, friction: 0.7, restitution: 0.05, label: 'Wood' },
  plank: { points: 1, density: 0.9, friction: 0.55, restitution: 0.05, label: 'Plank' },
  stone: { points: 1, density: 2.6, friction: 0.85, restitution: 0.02, label: 'Stone' },
  silver: { points: 5, density: 1.2, friction: 0.6, restitution: 0.1, label: 'Silver' },
  gold: { points: 10, density: 1.4, friction: 0.6, restitution: 0.1, label: 'Gold' },
  gem: { points: 25, density: 1.0, friction: 0.5, restitution: 0.15, label: 'Gem' },
  skull: { points: -10, density: 1.0, friction: 0.7, restitution: 0.05, label: 'Skull' },
  bomb: { points: 3, density: 1.3, friction: 0.7, restitution: 0.05, label: 'Bomb' },
  chem: { points: 3, density: 1.0, friction: 0.6, restitution: 0.05, label: 'Chemical' },
  ice: { points: 2, density: 0.9, friction: 0.03, restitution: 0.02, label: 'Ice' },
  ghost: { points: 2, density: 0.5, friction: 0.6, restitution: 0.05, label: 'Ghost' },
  jenga: { points: 0, density: 0.8, friction: 0.3, restitution: 0.0, label: 'Tower block' },
  crown: { points: 0, density: 0.6, friction: 0.6, restitution: 0.0, label: 'Crown' },
};

/** Blocks worth chasing: used to decide when a Blast level has been cleared. */
export const isPrize = (t: BlockType) => BLOCK_TYPES[t].points >= 5;
