CREATE UNIQUE INDEX IF NOT EXISTS "User_company_normalized_email_unique"
ON "User" ((lower(coalesce("emailPending", "email"))))
WHERE "role" IN ('ADMIN', 'INSTALLER', 'SENIOR_OPERATIONS_MANAGER', 'SENIOR_CUSTOMER_SUPPORT', 'CXO')
  AND ("email" IS NOT NULL OR "emailPending" IS NOT NULL);
