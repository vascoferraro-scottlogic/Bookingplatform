---
title: Platform admin acting on behalf of a club
category: users-roles
audience: platform_admin
tags: [impersonation, platform-admin, support]
order: 100
excerpt: When and how to impersonate a tenant to perform admin tasks on their behalf.
updated: 2026-05-02
---

> This article is for **platform admins** only. Tenant admins won't see it in their help index.

Platform admins do **not** inherit any tenant powers by default. To make a change inside a club's data — fix a stuck booking, edit content, restore a deleted user — you must first start an **impersonation**.

## Starting an impersonation

1. From the **Platform Console** sidebar, open **Tenants**.
2. Click the tenant you want to act on, then **Act as tenant admin**.
3. Provide a short reason. This is recorded against the `Impersonation` row and shown in the club's audit log.

The orange impersonation banner stays visible at the top of every page until you exit. Every audited action records both your real identity *and* the impersonated tenant context.

## Etiquette

- Prefer guiding the club's own admins by phone or message rather than making changes for them.
- Where an action is unavoidable, leave a note in the relevant audit/messaging channel so the club has context.
- Exit impersonation as soon as you're done — platform-only operations refuse to run while impersonating.

## Audit trail

Every entry made during impersonation appears in the club's audit log as
`Jane Doe (PLATFORM_ADMIN acting as TENANT_ADMIN of <Club>)`. The full
impersonation history is browsable at
[`/dashboard/platform/impersonations`](/dashboard/platform/impersonations).
