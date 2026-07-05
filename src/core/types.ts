/* 型定義の根拠は docs/internal/specs/01-identity.md / 02-generation.md / 03-cosmic-web.md */

export type WebKind = "void" | "wall" | "filament" | "node";
export type SegChar = "W" | "C" | "G" | "Y" | "P" | "M";
export type Kind = SegChar | "S";

export interface WebF {
  kind: WebKind;
  id: number;
  local?: number;
}
export interface WSegment {
  k: "W";
  cell: number[];
  f: WebF;
}
export interface ISegment {
  k: Exclude<SegChar, "W">;
  i: number;
}
export type Segment = WSegment | ISegment;

export interface Address {
  seed: string;
  segs: Segment[];
}

export type ParseResult = { ok: true; addr: Address } | { ok: false; error: string };

/** [r, g, b] 各成分 0..1 */
export type Rgb = number[];

export interface Moon {
  size: number;
  dist: number;
  speed: number;
  phase: number;
  incl: number;
  shade: number;
}
export interface Ring {
  inner: number;
  outer: number;
  alpha: number;
  tint: Rgb;
  seed: number;
}
export type Archetype = "rocky" | "gas" | "ice";
export interface PlanetParams {
  archetype: Archetype;
  radius: number;
  base: Rgb;
  alt: Rgb;
  band: Rgb;
  pole: Rgb;
  atmo: Rgb;
  hasAtmo: boolean;
  bands: number;
  noiseScale: number;
  poleCap: number;
  tilt: number;
  spin: number;
  ring: Ring | null;
  moons: Moon[];
}
export interface ProxyParams {
  color: Rgb;
  radius: number;
  glow: number;
  pulse: number;
}

export interface PlanetDescriptor {
  kind: Kind;
  kindLabel: string;
  bodyType: "planet";
  params: PlanetParams;
  fingerprint: string;
  chain: number;
}
export interface ProxyDescriptor {
  kind: Kind;
  kindLabel: string;
  bodyType: "proxy";
  params: ProxyParams;
  fingerprint: string;
  chain: number;
}
export type Descriptor = PlanetDescriptor | ProxyDescriptor;

export interface WebNode {
  pos: number[];
  parents: string[];
}
export interface WebFilament {
  pos: number[];
  a: number[];
  b: number[];
}
export interface WebWall {
  pos: number[];
}
export interface WebVoid {
  pos: number[];
}
export interface CellFeatures {
  node: WebNode[];
  filament: WebFilament[];
  wall: WebWall[];
  void: WebVoid[];
}
export interface WebFeatureDetail {
  exists: boolean;
  kind?: WebKind;
  pos?: number[];
  a?: number[] | null;
  b?: number[] | null;
}
export interface Neighborhood {
  parent: Address | null;
  siblings: Address[];
  children: Address[];
}
export interface DustResult {
  pts: number[];
  w: number[];
}
export type Rng = () => number;
