import { UIDevice } from '@/types/device';

export const LABEL_ORDER = [
  'Light',
  'Blind',
  'Motion Sensor',
  'Spotify',
  'Boiler',
  'Doorbell',
  'Home Security',
  'TV',
  'Speaker',
] as const;

export const OTHER_LABEL = 'Other';
const LABEL_ORDER_LOWER = LABEL_ORDER.map((label) => label.toLowerCase());

export function normalizeLabel(label?: string | null) {
  return label?.toString().trim() ?? '';
}

export function getPrimaryLabel(device: Pick<UIDevice, 'label' | 'labels' | 'labelCategory'>) {
  const overrideLabel = normalizeLabel(device.label);
  if (overrideLabel) return overrideLabel;
  const first =
    Array.isArray(device.labels) && device.labels.length > 0
      ? normalizeLabel(device.labels[0])
      : '';
  if (first) return first;
  return normalizeLabel(device.labelCategory) || OTHER_LABEL;
}

export function getAdditionalLabels(
  device: Pick<UIDevice, 'labels'>,
  primaryLabel: string
) {
  if (!Array.isArray(device.labels)) return [];
  const primaryLower = primaryLabel.toLowerCase();
  return device.labels
    .map((lbl) => normalizeLabel(lbl))
    .filter((lbl) => lbl && lbl.toLowerCase() !== primaryLower);
}

export function getGroupLabel(device: Pick<UIDevice, 'label' | 'labels' | 'labelCategory'>) {
  const label = getPrimaryLabel(device);
  const idx = LABEL_ORDER_LOWER.indexOf(label.toLowerCase());
  return idx >= 0 ? LABEL_ORDER[idx] : OTHER_LABEL;
}

export function sortLabels(labels: string[]) {
  return labels.sort((a, b) => {
    const idxA = LABEL_ORDER_LOWER.indexOf(a.toLowerCase());
    const idxB = LABEL_ORDER_LOWER.indexOf(b.toLowerCase());
    const normA = idxA === -1 ? LABEL_ORDER.length : idxA;
    const normB = idxB === -1 ? LABEL_ORDER.length : idxB;
    if (normA !== normB) return normA - normB;
    return a.localeCompare(b);
  });
}
