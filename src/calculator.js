// Live material calculator chips (substrate litres, rock kg, plant count, tank volume).
import { fmt, SUB_KG } from './presets.js';

export function updateChips(container, tank, substrate, placement) {
  const vol = (tank.state.w * tank.state.d * tank.state.h) / 1000;
  const subLitres = substrate.volumeLitres;

  let rockL = 0, woodL = 0, plants = 0;
  const stock = {};
  for (const o of placement.objects) {
    const u = o.userData;
    const s = o.scale.x;
    const size = u.sizeBase
      ? u.sizeBase.x * s * u.sizeBase.y * s * u.sizeBase.z * s / 1000 // cm³ → L (approx bounding)
      : 0;
    const li = Math.max(size * 0.38, 0.02); // average solid fraction
    if (u.kindKey === 'rock') rockL += li;
    else if (u.kindKey === 'wood') woodL += li;
    else if (u.kindKey === 'plant') {
      plants++;
      const nm = u.def?.name ?? u.typeKey;
      stock[nm] = (stock[nm] || 0) + 1;
    }
  }
  const rockKg = rockL * 2.7;
  const woodKg = woodL * 0.65;
  const subKg = subLitres * (SUB_KG[substrate.baseType] ?? 1.2);
  const chips = [
    `Tank <b>${tank.state.w}×${tank.state.d}×${tank.state.h}</b> cm · <b>${fmt(Math.round(vol))} L</b>`,
    `Substrate <b>${fmt(subLitres, 1)} L</b> (~${fmt(Math.round(subKg))} kg)`,
    `Rock <b>${fmt(rockL, 1)} L</b> ~<b>${fmt(Math.round(rockKg))} kg</b>`,
    `Wood <b>${fmt(woodL, 1)} L</b>`,
    `Plants <b>${plants}</b>`,
  ];
  container.innerHTML = chips.map((c) => `<span class="chip">${c}</span>`).join('');
}