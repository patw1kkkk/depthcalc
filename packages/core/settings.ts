export const RADII = [20, 30, 40, 50, 100] as const;
export type Settings = {
  coverageGrid: number;
  coverageRadius: number;
  goodCount: number;
  gpsAccuracy: number;
  radius: number;
  interval: number;
  smoothColors: boolean;
  smoothing: number;
};
export const DEFAULT_SETTINGS: Settings = {
  coverageGrid: 13,
  coverageRadius: 20,
  goodCount: 3,
  gpsAccuracy: 35,
  radius: 100,
  interval: 2,
  smoothColors: true,
  smoothing: 30,
};
