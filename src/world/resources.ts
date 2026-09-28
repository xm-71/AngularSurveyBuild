export type ResourceId =
  | 'carbon' | 'iron' | 'sodium' | 'oxygen' | 'hydrogen' | 'tritium'
  | 'copper' | 'cobalt' | 'gold' | 'silver' | 'platinum' | 'uranium' | 'phosphorus' | 'ammonia';

export interface ResourceDef {
  id: ResourceId;
  name: string;
  symbol: string;
  color: string;
  description: string;
  rare?: boolean;
  value: number;
}

export const RESOURCES: Record<ResourceId, ResourceDef> = {
  carbon: { id: 'carbon', name: 'Carbon', symbol: 'C', color: '#e0574a', value: 12, description: 'Harvested from plants and trees. Recharges the mining beam and exosuit health.' },
  iron: { id: 'iron', name: 'Iron', symbol: 'Fe', color: '#c9c3b6', value: 14, description: 'Found in rocks and boulders. Repairs ship shields.' },
  sodium: { id: 'sodium', name: 'Sodium', symbol: 'Na', color: '#ffc545', value: 20, description: 'Grows in yellow sodium plants. Recharges hazard protection.' },
  oxygen: { id: 'oxygen', name: 'Oxygen', symbol: 'O₂', color: '#ff8fa6', value: 24, description: 'Grows in red oxygen plants. Refills life support.' },
  hydrogen: { id: 'hydrogen', name: 'Hydrogen', symbol: 'H', color: '#57a8ff', value: 18, description: 'Blue crystals on planet surfaces. Fuels the launch thrusters.' },
  tritium: { id: 'tritium', name: 'Tritium', symbol: 'Tr', color: '#a3e86f', value: 10, description: 'Mined from asteroids with ship lasers. Fuels the pulse drive.' },
  copper: { id: 'copper', name: 'Copper', symbol: 'Cu', color: '#e8894c', rare: true, value: 110, description: 'Metallic deposit found on temperate and desert worlds.' },
  cobalt: { id: 'cobalt', name: 'Cobalt', symbol: 'Co', color: '#4f7bff', rare: true, value: 130, description: 'Blue mineral that forms in cold caverns and ice fields.' },
  gold: { id: 'gold', name: 'Gold', symbol: 'Au', color: '#f4cf52', rare: true, value: 220, description: 'Precious metal in rich surface deposits.' },
  silver: { id: 'silver', name: 'Silver', symbol: 'Ag', color: '#dfe5ee', rare: true, value: 160, description: 'Bright deposits scattered across rocky worlds.' },
  platinum: { id: 'platinum', name: 'Platinum', symbol: 'Pt', color: '#b8e4ef', rare: true, value: 260, description: 'Dense metal found on airless moons.' },
  uranium: { id: 'uranium', name: 'Uranium', symbol: 'U', color: '#86ef3c', rare: true, value: 190, description: 'Radioactive ore. Handle with care.' },
  phosphorus: { id: 'phosphorus', name: 'Phosphorus', symbol: 'P', color: '#ff6b3d', rare: true, value: 180, description: 'Reactive mineral from scorched volcanic worlds.' },
  ammonia: { id: 'ammonia', name: 'Ammonia', symbol: 'NH₃', color: '#6fd8c3', rare: true, value: 170, description: 'Crystallised compound from toxic worlds.' },
};

export const RESOURCE_ORDER: ResourceId[] = [
  'carbon', 'iron', 'sodium', 'oxygen', 'hydrogen', 'tritium',
  'copper', 'cobalt', 'gold', 'silver', 'platinum', 'uranium', 'phosphorus', 'ammonia',
];
