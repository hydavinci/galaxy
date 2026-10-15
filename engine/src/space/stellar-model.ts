import metadataJson from './stellar-metadata.json';
import { PARSEC_AU, type CatalogStar3D, type SpaceBody, type Vec3 } from './types';

/**
 * Catalog-backed display parameters, not stellar photographs or stellar dynamics.
 * A "reference" may itself be an observation-constrained literature model.
 * All general radii/temperatures and every returned bolometric luminosity are
 * estimates. See public/data/stellar-model-credits.json and STELLAR-PARAMETERS.md.
 */
export interface StellarModel {
  radiusKm:number;
  temperatureK:number;
  luminositySolar:number;
  spectralType:string|null;
  classification:string;
  radiusSource:string;
  temperatureSource:string;
  luminositySource:string;
  estimatedRadius:boolean;
  estimatedTemperature:boolean;
  estimatedLuminosity:boolean;
  references:string[];
  /** Normalized gamma-compressed Planck sample display tint, NOT linear flux. */
  color:[number,number,number];
  /** FNV-1a identity seed for an illustrative static pattern only. */
  seed:number;
  /** Existing HYG `hip` cross-ID only; HYG primary IDs are NOT HIP numbers. */
  hipNumber?:number;
}

type MetadataRow = [id:number, hip:number|null, rawSpectralType:string, bv:number, absoluteVisualMagnitude:number];
interface Anchor {
  id:number; name:string; radiusSolar:number; temperatureK:number;
  estimatedRadius:boolean; radiusSource:string; temperatureSource:string;
  classification:string; reference:string;
}
const metadata = metadataJson as unknown as { rows:MetadataRow[]; anchors:Anchor[] };
const rows = new Map(metadata.rows.map(row => [`hyg-${row[0]}`, row]));
const anchors = new Map(metadata.anchors.map(anchor => [anchor.id, anchor]));
const HYG_REFERENCE = 'https://github.com/astronexus/HYG-Database/blob/c7f7f883fe678cc7680169a50ccd7dcc49b060ce/hyg/README.md';
const TEMPERATURE_REFERENCE = 'https://arxiv.org/html/1201.1809v2';
const SOLAR_VISUAL_REFERENCE = 'https://arxiv.org/html/1804.07788';
const SOLAR_NOMINAL_REFERENCE = 'https://arxiv.org/abs/1510.07674';
const SOLAR_RADIUS_KM = 695700;
const SOLAR_TEMPERATURE_K = 5772;
const SOLAR_ABSOLUTE_V = 4.81;
// h*c/k (m K), exact SI constants; common prefactor cancels in ratios.
const SECOND_RADIATION_CONSTANT = 0.014387768775039337;
const VISUAL_WAVELENGTH_M = 550e-9;
const ORDINARY_BV_MIN = -0.4;
const ORDINARY_BV_MAX = 2;
const RETAINED_BV_MAX = 2.8;
const modelCache = new WeakMap<CatalogStar3D, {row:MetadataRow; model:StellarModel}>();
const bodyCache = new WeakMap<CatalogStar3D, {model:StellarModel; body:SpaceBody}>();

function validCatalogIdentity(star:CatalogStar3D):MetadataRow|null {
  if (!star || typeof star !== 'object' || typeof star.id !== 'string' || typeof star.name !== 'string' ||
      typeof star.sourceId !== 'string' || star.id !== `hyg-${star.sourceId}`) return null;
  const row = rows.get(star.id);
  // Match the already selected source record. Unknown/synthetic objects cannot
  // accidentally acquire a famous star's measured radius by name or guessed ID.
  if (!row || star.bv !== row[3] || star.absoluteMagnitude !== row[4]) return null;
  if (!Array.isArray(star.positionAU) || star.positionAU.length !== 3 || !star.positionAU.every(Number.isFinite) ||
      !Number.isFinite(star.distancePc) || star.distancePc <= 0 || star.distancePc > 100 ||
      !Number.isFinite(star.absoluteMagnitude) || !Number.isFinite(star.bv) ||
      star.bv < ORDINARY_BV_MIN || star.bv > RETAINED_BV_MAX) return null;
  const expected = star.distancePc * PARSEC_AU;
  const distance = Math.hypot(star.positionAU[0], star.positionAU[1], star.positionAU[2]);
  if (!(distance > 0) || Math.abs(distance / expected - 1) > 1e-5) return null;
  return row;
}

/** Ballesteros 2012 eq.14: approximate blackbody COLOR temperature. */
function colorTemperature(bv:number):number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

/**
 * Approximate V-band surface-brightness radius, NOT Lbol=HYG.lum.
 * R²/Rsun² = 10^(0.4*(MvSun-Mv)) * B_lambda(550nm,Tsun)/B_lambda(550nm,T).
 * Using one wavelength instead of a full V response/stellar atmosphere is an
 * explicit approximation. No class-dependent radius clamp or solar fallback.
 */
function visualRadiusSolar(absoluteMagnitude:number, temperatureK:number):number {
  const visualRatio = 10 ** (0.4 * (SOLAR_ABSOLUTE_V - absoluteMagnitude));
  const inverseSurfaceBrightness = Math.expm1(SECOND_RADIATION_CONSTANT / (VISUAL_WAVELENGTH_M * temperatureK)) /
    Math.expm1(SECOND_RADIATION_CONSTANT / (VISUAL_WAVELENGTH_M * SOLAR_TEMPERATURE_K));
  return Math.sqrt(visualRatio * inverseSurfaceBrightness);
}

/** Planck samples are deliberately a display tint, not CIE/sRGB colorimetry. */
function displayTint(temperatureK:number):[number,number,number] {
  const samples = [650e-9, 550e-9, 450e-9].map(wavelength =>
    (VISUAL_WAVELENGTH_M / wavelength) ** 5 /
    Math.expm1(SECOND_RADIATION_CONSTANT / (wavelength * temperatureK)));
  const peak = Math.max(...samples);
  return samples.map(value => Math.min(1, Math.max(0, (value / peak) ** (1 / 2.2)))) as [number,number,number];
}

function identitySeed(id:string):number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function classification(raw:string, fallback:boolean):string {
  const suffix = fallback ? '；B−V超范围，降级示意估算' : '；物理参数估算';
  if (!raw) return `光谱未载${suffix}`;
  if (/comp|[:?+]|\.{2,}/i.test(raw)) return `目录光谱不确定/复合；单球等效示意${suffix}`;
  if (/^D[A-Z0-9]/.test(raw)) return `白矮星类（目录光谱参考，黑体近似局限大）${suffix}`;
  const type = /^(?:sd)?([OBAFGKM])\d/.exec(raw)?.[1];
  if (!type) return `目录原始光谱参考（未推断演化分类）${suffix}`;
  let kind = '型恒星';
  if (/III|II/.test(raw)) kind = '型巨星/亮巨星';
  else if (/IV/.test(raw)) kind = '型亚巨星';
  else if (/V/.test(raw)) kind = '型主序星';
  return `${type}${kind}（目录光谱参考）${/var/i.test(raw) ? '；变星静态示意' : ''}${suffix}`;
}

/**
 * Same catalog object + unchanged validated photometry -> same frozen model.
 * No runtime fetch; null for unsupported IDs/photometry/positions. These records
 * are fixed-epoch catalog data: returning a radius never changes their positions.
 */
export function getStellarModel(star:CatalogStar3D):StellarModel|null {
  const row = validCatalogIdentity(star);
  if (!row) return null;
  const cached = modelCache.get(star);
  if (cached?.row === row) return cached.model;
  const anchor = anchors.get(row[0]);
  const fallback = star.bv > ORDINARY_BV_MAX;
  const temperatureK = anchor?.temperatureK ?? colorTemperature(fallback ? ORDINARY_BV_MAX : star.bv);
  const radiusSolar = anchor?.radiusSolar ?? visualRadiusSolar(star.absoluteMagnitude, temperatureK);
  const radiusKm = radiusSolar * SOLAR_RADIUS_KM;
  // The estimate belongs to THIS displayed spherical model, even when inputs
  // are literature references. Never silently copy visual luminosity from HYG.
  const luminositySolar = radiusSolar ** 2 * (temperatureK / SOLAR_TEMPERATURE_K) ** 4;
  if (![temperatureK, radiusKm, luminositySolar].every(value => Number.isFinite(value) && value > 0)) return null;
  const color = displayTint(temperatureK);
  if (!color.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return null;
  const references = anchor ? [anchor.reference, HYG_REFERENCE, SOLAR_NOMINAL_REFERENCE]
    : [HYG_REFERENCE, TEMPERATURE_REFERENCE, SOLAR_VISUAL_REFERENCE, SOLAR_NOMINAL_REFERENCE];
  const uncertainty = '；未校正消光/金属丰度/重力，冷星分子吸收与复合光可能显著偏离';
  const model:StellarModel = {
    radiusKm, temperatureK, luminositySolar,
    spectralType:row[2] || null,
    classification:anchor?.classification ?? classification(row[2], fallback),
    radiusSource:anchor?.radiusSource ?? `估算：绝对V星等＋550 nm黑体表面亮度，太阳标定${fallback ? '；采用超范围B−V的边界温度降级示意' : ''}${uncertainty}`,
    temperatureSource:anchor?.temperatureSource ?? (fallback
      ? `估算（降级示意）：目录B−V=${star.bv}超出本模型[-0.4,2.0]范围，暂用B−V=2.0边界色温；非该星有效温度测量`
      : `估算：目录B−V＋Ballesteros（2012）黑体色温关系；不是独立有效温度测量${uncertainty}`),
    luminositySource:`估算：由所示半径和温度按Stefan–Boltzmann关系计算的球形模型总光度；非HYG视觉光度${fallback ? '；继承边界温度降级假设' : ''}`,
    estimatedRadius:anchor?.estimatedRadius ?? true,
    estimatedTemperature:!anchor,
    estimatedLuminosity:true,
    references, color, seed:identitySeed(star.id),
    ...(row[1] === null ? {} : { hipNumber:row[1] }),
  };
  Object.freeze(color);
  Object.freeze(references);
  Object.freeze(model);
  modelCache.set(star, {row, model});
  return model;
}

const AXIS_NORTH = Object.freeze([0, 1, 0]) as unknown as Vec3;
const AXIS_PRIME = Object.freeze([1, 0, 0]) as unknown as Vec3;
// Same reflected Y-up convention as the shared Solar-body optics:
// cross(prime,east) = -north. No measured stellar pole/rotation is claimed.
const AXIS_EAST = Object.freeze([0, 0, 1]) as unknown as Vec3;

/**
 * Radius/orientation adapter for bodyFrame/bodyHitDistance ONLY.
 * Never append this to SpaceSnapshot, ephemeris bodies or planetary textures.
 */
export function stellarBody(star:CatalogStar3D):SpaceBody|null {
  const model = getStellarModel(star);
  if (!model) return null;
  const cached = bodyCache.get(star);
  if (cached?.model === model && cached.body.positionAU === star.positionAU &&
      cached.body.name === (star.nameZh || star.name) && cached.body.nameEn === star.name) return cached.body;
  const color = '#' + model.color.map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('');
  const body:SpaceBody = {
    id:star.id, name:star.nameZh || star.name, nameEn:star.name,
    kind:'star', positionAU:star.positionAU, radiusKm:model.radiusKm, color, textureId:'',
    axisNorth:AXIS_NORTH, axisPrime:AXIS_PRIME, axisEast:AXIS_EAST,
  };
  Object.freeze(body);
  bodyCache.set(star, {model, body});
  return body;
}
