/**
 * Official category map — labels captured from
 * https://nuerburgring.de/info/nuerburgring/records?locale=en
 * Chinese is a controlled translation table; official English stays verbatim.
 */

/** @typedef {{ trackId: string, groupKey: string, nameOfficial: string, nameEn: string, nameZh: string }} CategorySpec */

export const TRACKS = [
  {
    id: 'nordschleife',
    name_en: 'Nordschleife',
    name_zh: '纽博格林北环',
    distance_km: 20.832,
    timing_key: 'nordschleife-20.832-flying',
    source_url: 'https://nuerburgring.de/info/nuerburgring/records?locale=en',
  },
  {
    id: 'grand_prix',
    name_en: 'Grand-Prix Circuit',
    name_zh: '纽博格林大奖赛赛道',
    distance_km: 5.148,
    timing_key: 'grand-prix-5.148-flying',
    source_url: 'https://nuerburgring.de/info/nuerburgring/records?locale=en',
  },
];

export const GROUPS = {
  prototypes: {
    key: 'prototypes',
    name_en: 'Prototypes / pre-production vehicles',
    name_zh: '原型车 / 预生产车',
    name_official: 'Prototypes / pre-production vehicles',
  },
  combustion: {
    key: 'combustion',
    name_en: 'Combustion & hybrid vehicles',
    name_zh: '燃油与混动车辆',
    name_official: 'COMBUSTION & HYBRID VEHICLES',
  },
  electric: {
    key: 'electric',
    name_en: 'Electric vehicles',
    name_zh: '纯电车辆',
    name_official: 'ELECTRIC VEHICLES',
  },
  open: {
    key: 'open',
    name_en: 'Record times',
    name_zh: '纪录成绩',
    name_official: '',
  },
};

/** Official sub-category labels */
export const SUBCATEGORIES = {
  'compact-cars': { name_en: 'Compact cars', name_zh: '紧凑型车', name_official: 'Compact cars' },
  'mid-range-cars': { name_en: 'Mid-range cars', name_zh: '中型车', name_official: 'Mid-range cars' },
  'executive-cars': { name_en: 'Executive cars', name_zh: '行政级车', name_official: 'Executive cars' },
  'suvs': {
    name_en: 'SUVs, off-road vehicles, vans, pick-ups',
    name_zh: 'SUV、越野车、厢式车、皮卡',
    name_official: 'SUVs, off-road vehicles, vans, pick-ups',
  },
  'sports-cars': { name_en: 'Sports cars', name_zh: '跑车', name_official: 'Sports cars' },
  'super-sports-cars': {
    name_en: 'Super sports cars',
    name_zh: '超级跑车',
    name_official: 'Super sports cars',
  },
  'modified-vehicles': {
    name_en: 'Modified vehicles',
    name_zh: '改装车',
    name_official: 'Modified Vehicles',
  },
  'autonomous-driving': {
    name_en: 'Autonomous driving',
    name_zh: '自动驾驶',
    name_official: 'Autonomous Driving',
  },
  'prototypes': {
    name_en: 'Prototypes / pre-production vehicles',
    name_zh: '原型车 / 预生产车',
    name_official: 'Prototypes / pre-production vehicles',
  },
};

/**
 * Build category id + metadata from track/group/sub.
 * @param {string} trackId
 * @param {string} groupKey
 * @param {string} subKey
 */
export function categoryId(trackId, groupKey, subKey) {
  return `${trackId}/${groupKey}/${subKey}`;
}

/**
 * Resolve category labels from official accordion title + group description.
 * @param {string} trackId
 * @param {string} groupDesc
 * @param {string} categoryTitle
 */
export function resolveCategory(trackId, groupDesc, categoryTitle) {
  const title = String(categoryTitle || '').trim();
  const desc = String(groupDesc || '').trim();
  const lower = title.toLowerCase();

  let groupKey = 'open';
  if (/prototype|pre-production/i.test(title) && !desc) {
    groupKey = 'prototypes';
  } else if (/combustion|hybrid/i.test(desc)) {
    groupKey = 'combustion';
  } else if (/electric/i.test(desc)) {
    groupKey = 'electric';
  } else if (/prototype|pre-production/i.test(title)) {
    groupKey = 'prototypes';
  } else if (trackId === 'grand_prix') {
    groupKey = 'open';
  }

  let subKey = 'prototypes';
  if (/compact/i.test(lower)) subKey = 'compact-cars';
  else if (/mid-range|midrange|mid size/i.test(lower)) subKey = 'mid-range-cars';
  else if (/executive|luxury/i.test(lower)) subKey = 'executive-cars';
  else if (/suv|off-road|pick-up|pickup|van/i.test(lower)) subKey = 'suvs';
  else if (/super sports|supercar|super sports car/i.test(lower)) subKey = 'super-sports-cars';
  else if (/sports car/i.test(lower)) subKey = 'sports-cars';
  else if (/modified/i.test(lower)) subKey = 'modified-vehicles';
  else if (/autonomous/i.test(lower)) subKey = 'autonomous-driving';
  else if (/prototype|pre-production/i.test(lower)) subKey = 'prototypes';

  // Grand Prix super sports cars sit under open group
  if (trackId === 'grand_prix' && subKey === 'super-sports-cars') {
    groupKey = 'open';
  }

  const sub = SUBCATEGORIES[subKey] || {
    name_en: title,
    name_zh: title,
    name_official: title,
  };
  const group = GROUPS[groupKey] || GROUPS.open;

  return {
    id: categoryId(trackId, groupKey, subKey),
    track_id: trackId,
    parent_id: null,
    group_en: group.name_en,
    group_zh: group.name_zh,
    name_en: sub.name_en,
    name_zh: sub.name_zh,
    name_official: title || sub.name_official,
    sort_order: 0,
  };
}

/** UI tree for category navigation (derived from same map — not invented ranks). */
export function categoryTree() {
  return TRACKS.map((t) => ({
    id: t.id,
    name_en: t.name_en,
    name_zh: t.name_zh,
    distance_km: t.distance_km,
    timing_key: t.timing_key,
    groups: [
      {
        key: 'prototypes',
        name_en: GROUPS.prototypes.name_en,
        name_zh: GROUPS.prototypes.name_zh,
        name_official: GROUPS.prototypes.name_official,
        categories: [categoryId(t.id, 'prototypes', 'prototypes')],
      },
      {
        key: 'combustion',
        name_en: GROUPS.combustion.name_en,
        name_zh: GROUPS.combustion.name_zh,
        name_official: GROUPS.combustion.name_official,
        categories: ['compact-cars', 'mid-range-cars', 'executive-cars', 'suvs', 'sports-cars', 'super-sports-cars', 'modified-vehicles'].map(
          (s) => categoryId(t.id, 'combustion', s),
        ),
      },
      {
        key: 'electric',
        name_en: GROUPS.electric.name_en,
        name_zh: GROUPS.electric.name_zh,
        name_official: GROUPS.electric.name_official,
        categories: ['mid-range-cars', 'executive-cars', 'suvs', 'super-sports-cars', 'modified-vehicles', 'autonomous-driving'].map(
          (s) => categoryId(t.id, 'electric', s),
        ),
      },
      {
        key: 'open',
        name_en: GROUPS.open.name_en,
        name_zh: GROUPS.open.name_zh,
        name_official: GROUPS.open.name_official,
        categories: [categoryId(t.id, 'open', 'super-sports-cars')],
      },
    ],
  }));
}
