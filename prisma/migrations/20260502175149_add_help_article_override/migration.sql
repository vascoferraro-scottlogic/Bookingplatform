-- CreateTable
CREATE TABLE "HelpArticleOverride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT,
    "body" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpArticleOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HelpArticleOverride_tenantId_slug_idx" ON "HelpArticleOverride"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "HelpArticleOverride_tenantId_slug_locale_key" ON "HelpArticleOverride"("tenantId", "slug", "locale");

-- AddForeignKey
ALTER TABLE "HelpArticleOverride" ADD CONSTRAINT "HelpArticleOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpArticleOverride" ADD CONSTRAINT "HelpArticleOverride_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpArticleOverride" ADD CONSTRAINT "HelpArticleOverride_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
