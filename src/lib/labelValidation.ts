export const OTHER_LABEL_ERROR = 'Label cannot be Other, please be more specific';

export function isReservedOtherLabel(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'other';
}
