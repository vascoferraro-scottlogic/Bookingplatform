-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('bookings_view', 'bookings_create', 'bookings_manage', 'bookings_admin_override', 'maintenance_view', 'maintenance_create', 'maintenance_assign', 'maintenance_close', 'events_view', 'events_create', 'events_manage', 'messaging_view', 'messaging_send', 'messaging_manage_channels', 'content_view', 'content_edit', 'content_publish', 'greens_view', 'greens_manage', 'streaming_view', 'streaming_manage', 'charity_view', 'charity_edit', 'charity_finalise_tar', 'charity_manage_funds', 'analytics_view', 'audit_view', 'help_view', 'help_manage_overrides', 'users_view', 'users_invite', 'users_manage', 'settings_view', 'settings_edit', 'billing_view', 'billing_manage', 'agents_view', 'agents_configure', 'agents_review_proposals', 'notifications_view', 'notifications_manage', 'federation_book_at_partners', 'federation_manage');

-- CreateEnum
CREATE TYPE "FederationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISSOLVED');

-- CreateEnum
CREATE TYPE "FederationBillingMode" AS ENUM ('FREE_ACCESS', 'REDUCED_RATE', 'HOST_CLUB_RATE');

-- CreateEnum
CREATE TYPE "FederationInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "PermissionGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionGrant" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,

    CONSTRAINT "PermissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Federation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "FederationStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxClubs" INTEGER NOT NULL DEFAULT 10,
    "createdByTenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Federation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederationMembership" (
    "id" TEXT NOT NULL,
    "federationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "billingMode" "FederationBillingMode" NOT NULL DEFAULT 'HOST_CLUB_RATE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "FederationMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederationInvite" (
    "id" TEXT NOT NULL,
    "federationId" TEXT NOT NULL,
    "inviterTenantId" TEXT NOT NULL,
    "inviteeTenantId" TEXT NOT NULL,
    "status" "FederationInviteStatus" NOT NULL DEFAULT 'PENDING',
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FederationInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PermissionGroup_tenantId_idx" ON "PermissionGroup"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionGroup_tenantId_name_key" ON "PermissionGroup"("tenantId", "name");

-- CreateIndex
CREATE INDEX "PermissionGrant_groupId_idx" ON "PermissionGrant"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionGrant_groupId_permission_key" ON "PermissionGrant"("groupId", "permission");

-- CreateIndex
CREATE INDEX "GroupMember_membershipId_idx" ON "GroupMember"("membershipId");

-- CreateIndex
CREATE INDEX "GroupMember_groupId_idx" ON "GroupMember"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_membershipId_key" ON "GroupMember"("groupId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Federation_name_key" ON "Federation"("name");

-- CreateIndex
CREATE INDEX "Federation_status_idx" ON "Federation"("status");

-- CreateIndex
CREATE INDEX "FederationMembership_tenantId_idx" ON "FederationMembership"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "FederationMembership_federationId_tenantId_key" ON "FederationMembership"("federationId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "FederationInvite_token_key" ON "FederationInvite"("token");

-- CreateIndex
CREATE INDEX "FederationInvite_federationId_status_idx" ON "FederationInvite"("federationId", "status");

-- CreateIndex
CREATE INDEX "FederationInvite_inviteeTenantId_status_idx" ON "FederationInvite"("inviteeTenantId", "status");

-- AddForeignKey
ALTER TABLE "PermissionGroup" ADD CONSTRAINT "PermissionGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PermissionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PermissionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Federation" ADD CONSTRAINT "Federation_createdByTenantId_fkey" FOREIGN KEY ("createdByTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederationMembership" ADD CONSTRAINT "FederationMembership_federationId_fkey" FOREIGN KEY ("federationId") REFERENCES "Federation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederationMembership" ADD CONSTRAINT "FederationMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederationInvite" ADD CONSTRAINT "FederationInvite_federationId_fkey" FOREIGN KEY ("federationId") REFERENCES "Federation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederationInvite" ADD CONSTRAINT "FederationInvite_inviterTenantId_fkey" FOREIGN KEY ("inviterTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederationInvite" ADD CONSTRAINT "FederationInvite_inviteeTenantId_fkey" FOREIGN KEY ("inviteeTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
