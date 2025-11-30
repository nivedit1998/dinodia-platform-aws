export type LabelCategory =
  | 'Light'
  | 'Blind'
  | 'TV'
  | 'Speaker'
  | 'Boiler'
  | 'Security'
  | 'Spotify'
  | 'Switch'
  | 'Thermostat'
  | 'Media'
  | 'Motion Sensor'
  | 'Sensor'
  | 'Vacuum'
  | 'Camera'
  | 'Other';

const LABEL_MAP: Record<string, LabelCategory> = {
  light: 'Light',
  lights: 'Light',
  blind: 'Blind',
  blinds: 'Blind',
  shade: 'Blind',
  shades: 'Blind',
  tv: 'TV',
  television: 'TV',
  speaker: 'Speaker',
  speakers: 'Speaker',
  audio: 'Speaker',
  boiler: 'Boiler',
  heating: 'Boiler',
  thermostat: 'Thermostat',
  doorbell: 'Security',
  security: 'Security',
  'home security': 'Security',
  spotify: 'Spotify',
  switch: 'Switch',
  switches: 'Switch',
  media: 'Media',
  'media player': 'Media',
  motion: 'Motion Sensor',
  'motion sensor': 'Motion Sensor',
  sensor: 'Sensor',
  vacuum: 'Vacuum',
  camera: 'Camera',
};

export function classifyDeviceByLabel(
  labels: string[]
): LabelCategory | null {
  const lower = labels.map((l) => l.toLowerCase());
  for (const [key, cat] of Object.entries(LABEL_MAP)) {
    if (lower.includes(key)) return cat;
  }
  return null;
}
