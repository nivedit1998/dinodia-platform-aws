-- Enforce: max 1 tenant + max 1 adminlike (admin/installer) per normalized email.
-- We use lower(coalesce(emailPending, email)) as the canonical email identity since accounts
-- are expected to have at most one of these set at a time.

CREATE UNIQUE INDEX IF NOT EXISTS "User_tenant_normalized_email_unique"
ON "User" ((lower(coalesce("emailPending", "email"))))
WHERE "role" = 'TENANT' AND ("email" IS NOT NULL OR "emailPending" IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS "User_adminlike_normalized_email_unique"
ON "User" ((lower(coalesce("emailPending", "email"))))
WHERE "role" IN ('ADMIN', 'INSTALLER') AND ("email" IS NOT NULL OR "emailPending" IS NOT NULL);

