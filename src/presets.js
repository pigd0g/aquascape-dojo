// Shared catalogue data: tank presets, substrate recipes, palette definitions.

export const TANK_PRESETS = [
  { id: '60p', name: 'ADA 60P', w: 60, d: 30, h: 36 },
  { id: '90p', name: 'ADA 90P', w: 90, d: 45, h: 45 },
  { id: '120p', name: 'ADA 120P', w: 120, d: 45, h: 45 },
  { id: '45p', name: 'ADA 45P', w: 45, d: 45, h: 45 },
  { id: 'cube30', name: 'Cube 30', w: 30, d: 30, h: 30 },
  { id: '10g', name: '10 gallon', w: 50, d: 25, h: 30 },
  { id: '20l', name: '20 gallon long', w: 76, d: 30, h: 30 },
  { id: '40b', name: '40 breeder', w: 91, d: 47, h: 43 },
  { id: 'shallow', name: 'Shallow 60×45×30', w: 60, d: 45, h: 30 },
];

export const STYLES = {
  dojoBlack: '#101014',
  panel: '#141419',
};

export const SUBSTRATES = {
  soil: {
    name: 'Aquarium soil',
    base: '#3a2f28',
    tints: ['#3a2f28', '#241b15', '#52412f', '#2f2c26', '#44392c'],
    grain: 0.9, granularity: 0.55, contrast: 0.28, sparkle: 0.0,
    rough: 0.97,
    // litres per cm of average depth over 100 cm² footprint… computed directly from heightfield
    density: 1.1, // kg per litre-ish (soil is light)
    kgPerL: 0.9,
  },
  gravel: {
    name: 'Natural gravel',
    base: '#8d7f6e',
    tints: ['#8d7f6e', '#6f6a63', '#a09484', '#7b746c', '#9c8b76'],
    grain: 1.6, granularity: 1.0, contrast: 0.45, sparkle: 0.25,
    rough: 0.8,
    kgPerL: 1.5,
  },
  sand: {
    name: 'Silica sand',
    base: '#d9c9ab',
    tints: ['#d9c9ab', '#e8dcc0', '#c9b291', '#b7a488', '#efe6d2'],
    grain: 1.1, granularity: 0.35, contrast: 0.14, sparkle: 0.18,
    rough: 0.75,
    kgPerL: 1.6,
  },
  blackSand: {
    name: 'Black sand',
    base: '#1c1d20',
    tints: ['#1c1d20', '#2a2c30', '#121214', '#33343a'],
    grain: 1.0, granularity: 0.4, contrast: 0.2, sparkle: 0.3,
    rough: 0.7,
    kgPerL: 1.6,
  },
  lava: {
    name: 'Lava substrate',
    base: '#4a3a35',
    tints: ['#4a3a35', '#5d4a42', '#33261f', '#6e5850'],
    grain: 1.4, granularity: 0.9, contrast: 0.4, sparkle: 0.05,
    rough: 0.95,
    kgPerL: 1.1,
  },
};

export const ROCK_TYPES = {
  ohko: {
    name: 'Ohko (Dragon stone)',
    brief: 'Tan sedimentary, lamellar strata & deep crevices',
    base: '#a3805c', tints: ['#a3805c', '#8f6e4d', '#b5946e', '#7d5f42'],
    scaleNoise: 3.1, ridgeAmt: 0.55, strata: true, strataFreq: 38, strataAmp: 0.10,
    crevices: 0.42, smooth: 0.25, angular: 0.30,
    rough: 0.95, kgPerL: 2.7,
  },
  seiryu: {
    name: 'Seiryu stone',
    brief: 'Grey-blue, dark veined, angular monoliths',
    base: '#7d8794', tints: ['#7d8794', '#5f6b78', '#96a0ab', '#4d565f'],
    scaleNoise: 1.6, ridgeAmt: 0.35, strata: false, strataFreq: 0, strataAmp: 0,
    crevices: 0.25, smooth: 0.12, angular: 0.72,
    rough: 0.85, kgPerL: 2.9,
    veins: true, darkPatch: true,
  },
  lava: {
    name: 'Lava rock',
    brief: 'Dark porous basalt, light in hand',
    base: '#3b3331', tints: ['#3b3331', '#2c2726', '#524642', '#4e403c'],
    scaleNoise: 2.6, ridgeAmt: 0.2, strata: false, strataFreq: 0, strataAmp: 0,
    crevices: 0.15, smooth: 0.35, angular: 0.25,
    rough: 1.0, kgPerL: 1.4,
    pores: true,
  },
  river: {
    name: 'River pebbles',
    brief: 'Flat smooth waterworn stones',
    base: '#9a9a96', tints: ['#9a9a96', '#8d8d8f', '#a3a39f', '#7b7b7d', '#6c6c6e', '#b0aca4'],
    scaleNoise: 1.1, ridgeAmt: 0.05, strata: false, strataFreq: 0, strataAmp: 0,
    crevices: 0.08, smooth: 0.75, angular: 0.1,
    rough: 0.85, kgPerL: 2.6,
    flatten: true,
    colorFlat: true, // even matte color — no crevice blotching (reads as stone, not metal)
  },
  slate: {
    name: 'Slate & pebbles',
    brief: 'Dark flat shards, stacked spires',
    base: '#585c63', tints: ['#585c63', '#43464c', '#6d7178', '#33363b'],
    scaleNoise: 2.0, ridgeAmt: 0.18, strata: true, strataFreq: 55, strataY: true,
    strataAmp: 0.14, crevices: 0.2, smooth: 0.3, angular: 0.6,
    rough: 0.6, kgPerL: 2.8,
  },
};

export const WOOD_TYPES = {
  spider: {
    name: 'Spiderwood',
    brief: 'Trunk with radiating root tendrils',
    trunkH: [0.9, 1.4], trunkR: [0.11, 0.17], bend: 0.35,
    branches: 5, branchLv: 2, spread: 1.05, tendril: 0.65, tendrilN: 6,
    bark: '#5d412c', barkColor: '#5d412c',
    tints: ['#5d412c', '#6e5238', '#4a3524', '#85644a', '#3c2b1d'],
  },
  malay: {
    name: 'Malaysian driftwood',
    brief: 'Gnarled horizontal spreader, sinks on its own',
    trunkH: [0.45, 0.7], trunkR: [0.16, 0.22], bend: 0.55,
    branches: 7, branchLv: 2, spread: 1.5, tendril: 0.15, tendrilN: 2,
    bark: '#4a3524', barkColor: '#4a3524',
    tints: ['#4a3524', '#5d4530', '#3a291c', '#6e523a'],
  },
  log: {
    name: 'Driftwood log',
    brief: 'Large gnarled trunk chunk, forks & snapped limbs',
    trunkH: [2.6, 4.2], trunkR: [0.34, 0.55], bend: 0.5,
    bark: '#5d412c',
    tints: ['#54371f', '#4a3a26', '#6b4a30', '#3e2c1c', '#5d4a34', '#46311f'],
  },
};

export const PLANT_TYPES = {
  sword: {
    name: 'Sword (Echinodorus)',
    brief: 'Broad rosette blades, centerpiece leaves',
    kind: 'sword', h: [14, 30], leaves: [9, 14],
    green: [0.27, 0.47], huer: [-0.06, 0.06], sat: [0.5, 0.75],
    widthF: [3, 6], arch: 0.65,
    cat: 'Centerpiece',
  },
  anubias: {
    name: 'Anubias barteri',
    brief: 'Round dark leaves, rhizome hugger',
    kind: 'anubias', h: [8, 14], leaves: [7, 11],
    green: [0.26, 0.32], huer: [-0.03, 0.03], sat: [0.35, 0.5],
    widthF: [1.6, 2.6], arch: 0.3,
    cat: 'Epiphyte',
  },
  crypt: {
    name: 'Cryptocoryne',
    brief: 'Narrow bronzed rosette, midground tuft',
    kind: 'crypt', h: [8, 16], leaves: [8, 13],
    green: [0.30, 0.45], huer: [0.02, 0.10], sat: [0.4, 0.6],
    widthF: [1.0, 2.0], arch: 0.55,
    cat: 'Midground',
  },
  javafern: {
    name: 'Java fern',
    brief: 'Ribboned fronds, ruffled edge',
    kind: 'fern', h: [12, 25], leaves: [6, 9], rib: [6, 9],
    green: [0.29, 0.4], huer: [-0.02, 0.04], sat: [0.45, 0.6],
    cat: 'Fern',
  },
  bolbitis: {
    name: 'Bolbitis heudelotii',
    brief: 'Delicate translucent fernlets',
    kind: 'fern', h: [10, 22], leaves: [5, 8], rib: [7, 10],
    green: [0.3, 0.42], huer: [-0.05, 0.0], sat: [0.35, 0.55],
    cat: 'Fern',
  },
  hairgrass: {
    name: 'Dwarf hairgrass',
    brief: 'Fine quill clump, carpets when massed',
    kind: 'grass', h: [4, 9], leaves: [26, 42], spread: [0.03, 0.09],
    green: [0.23, 0.33], huer: [-0.04, 0.05], sat: [0.45, 0.65],
    cat: 'Carpet',
  },
  blyxa: {
    name: 'Blyxa japonica',
    brief: 'Soft curved grass tuft',
    kind: 'grass', h: [8, 15], leaves: [16, 26], spread: [0.08, 0.18],
    green: [0.25, 0.38], huer: [-0.03, 0.06], sat: [0.4, 0.6],
    cat: 'Grass',
  },
  vallis: {
    name: 'Vallisneria',
    long: 1,
    brief: 'Tall tape-grass ribbons, background wall',
    kind: 'ribbon', h: [25, 55], leaves: [7, 12],
    green: [0.26, 0.36], huer: [-0.04, 0.04], sat: [0.4, 0.6],
    cat: 'Background',
  },
  rotala: {
    name: 'Rotala rotundifolia',
    brief: 'Stem plant, pinks up under strong light',
    stemN: [3, 5], perStem: [6, 9], h: [12, 26],
    green: [0.30, 0.42], huer: [-0.02, 0.22], sat: [0.4, 0.7],
    cat: 'Stem',
  },
  ludwigia: {
    name: 'Ludwigia repens',
    brief: 'Broad-leafed red stem plant',
    stemN: [2, 4], perStem: [5, 8], h: [10, 22],
    green: [0.32, 0.42], huer: [-0.05, 0.25], sat: [0.45, 0.7],
    cat: 'Stem',
  },
  moss: {
    name: 'Java moss patch',
    brief: 'Fuzzy cushion, tie it to wood or rock',
    kind: 'moss', spread: [0.25, 0.5], height: [1.2, 2.6],
    green: [0.25, 0.35], huer: [-0.04, 0.04], sat: [0.35, 0.55],
    cat: 'Accent',
  },
  carpet: {
    name: 'Carpet patch (HC)',
    brief: 'Low creeping ground cover',
    kind: 'carpet', spread: [0.35, 0.6], height: [0.7, 1.4],
    green: [0.24, 0.32], huer: [-0.03, 0.03], sat: [0.4, 0.6],
    cat: 'Carpet',
  },
  montecarlo: {
    name: 'Monte carlo',
    brief: 'Rounded carpet pads, mid bright green',
    kind: 'carpet', spread: [0.3, 0.5], height: [0.8, 1.6],
    green: [0.28, 0.4], huer: [-0.02, 0.02], sat: [0.45, 0.65],
    cat: 'Carpet',
  },
};

export function fmt(n, dp = 0) {
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export const SUB_KG = { soil: 0.9, gravel: 1.5, sand: 1.6, blackSand: 1.6, lava: 1.1 };
