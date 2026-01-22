import { AuthChallenge } from '@prisma/client';

export const SUPPORT_APPROVAL_WINDOW_MINUTES = 60;

export type SupportApprovalStatus = 'PENDING' | 'APPROVED' | 'EXPIRED' | 'CONSUMED' | 'NOT_FOUND';

export type SupportApprovalInfo = {
  status: SupportApprovalStatus;
  approvedAt: Date | null;
  expiresAt: Date | null;
  validUntil: Date | null;
};

export function computeSupportApproval(challenge: Pick<AuthChallenge, 'approvedAt' | 'expiresAt' | 'consumedAt'> | null): SupportApprovalInfo {
  if (!challenge) {
    return { status: 'NOT_FOUND', approvedAt: null, expiresAt: null, validUntil: null };
  }
  const now = new Date();

  if (challenge.consumedAt) {
    return {
      status: 'CONSUMED',
      approvedAt: challenge.approvedAt ?? null,
      expiresAt: challenge.expiresAt ?? null,
      validUntil: null,
    };
  }

  const expiresAt = challenge.expiresAt ?? null;
  const approvedAt = challenge.approvedAt ?? null;

  if (approvedAt) {
    const validUntil = new Date(approvedAt.getTime() + SUPPORT_APPROVAL_WINDOW_MINUTES * 60 * 1000);
    if (validUntil < now) {
      return { status: 'EXPIRED', approvedAt, expiresAt, validUntil };
    }
    return { status: 'APPROVED', approvedAt, expiresAt, validUntil };
  }

  if (expiresAt && expiresAt < now) {
    return { status: 'EXPIRED', approvedAt, expiresAt, validUntil: null };
  }

  return { status: 'PENDING', approvedAt, expiresAt, validUntil: null };
}
