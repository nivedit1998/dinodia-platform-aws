import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { Role } from '@prisma/client';
import { createAuthChallenge, buildVerifyUrl, getAppUrl } from '@/lib/authChallenges';
import { buildVerifyLinkEmail } from '@/lib/emailTemplates';
import { sendEmail } from '@/lib/email';
import { HubInstallError, verifyBootstrapClaim } from '@/lib/hubInstall';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      username,
      password,
      email,
      haUsername,
      haPassword,
      haBaseUrl,
      haLongLivedToken,
      deviceId,
      deviceLabel,
      dinodiaSerial,
      bootstrapSecret,
    } = body;

    if (
      !username ||
      !password ||
      !haUsername ||
      !haPassword ||
      !haBaseUrl ||
      !haLongLivedToken ||
      !email ||
      !deviceId ||
      !dinodiaSerial ||
      !bootstrapSecret
    ) {
      return NextResponse.json(
        { error: 'Please fill in all fields to connect your Dinodia Hub.' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Please enter a valid email address.' },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: 'That username is already taken. Try another one.' }, { status: 400 });
    }

    const normalizedToken = haLongLivedToken.trim();
    if (normalizedToken.length === 0) {
      return NextResponse.json({ error: 'Please fill in all fields to connect your Dinodia Hub.' }, { status: 400 });
    }

    const existingHub = await prisma.haConnection.findFirst({
      where: { longLivedToken: normalizedToken },
      select: { id: true },
    });
    if (existingHub) {
      return NextResponse.json({ error: 'Dinodia Hub already owned' }, { status: 409 });
    }

    let hubInstall;
    try {
      hubInstall = await verifyBootstrapClaim(dinodiaSerial, bootstrapSecret);
    } catch (err) {
      if (err instanceof HubInstallError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    const passwordHash = await hashPassword(password);

    const { admin } = await prisma.$transaction(async (tx) => {
      const haConnection = await tx.haConnection.create({
        data: {
          baseUrl: haBaseUrl.trim().replace(/\/+$/, ''),
          cloudUrl: null,
          haUsername,
          haPassword,
          longLivedToken: normalizedToken,
        },
      });

      const home = await tx.home.create({
        data: {
          haConnectionId: haConnection.id,
          addressLine1: '',
          addressLine2: null,
          city: '',
          state: null,
          postcode: '',
          country: '',
        },
      });

      const createdAdmin = await tx.user.create({
        data: {
          username,
          passwordHash,
          role: Role.ADMIN,
          emailPending: email,
          emailVerifiedAt: null,
          homeId: home.id,
          haConnectionId: haConnection.id,
        },
      });

      await tx.haConnection.update({
        where: { id: haConnection.id },
        data: { ownerId: createdAdmin.id },
      });

      await tx.hubInstall.update({
        where: { id: hubInstall.id },
        data: { homeId: home.id },
      });

      return { admin: createdAdmin };
    });

    const challenge = await createAuthChallenge({
      userId: admin.id,
      purpose: 'ADMIN_EMAIL_VERIFY',
      email,
      deviceId,
    });

    const appUrl = getAppUrl();
    const verifyUrl = buildVerifyUrl(challenge.token);
    const emailContent = buildVerifyLinkEmail({
      kind: 'ADMIN_EMAIL_VERIFY',
      verifyUrl,
      appUrl,
      username: admin.username,
      deviceLabel,
    });

    await sendEmail({
      to: email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      replyTo: 'niveditgupta@dinodiasmartliving.com',
    });

    return NextResponse.json({
      ok: true,
      requiresEmailVerification: true,
      challengeId: challenge.id,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: 'We couldn’t finish setting up the homeowner account. Please try again.' },
      { status: 500 }
    );
  }
}
