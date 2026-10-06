import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Platform admin
  const adminHash = await bcrypt.hash("admin123", 12);
  const platformAdmin = await prisma.user.upsert({
    where: { email: "admin@wlbooking.com" },
    update: {},
    create: {
      email: "admin@wlbooking.com",
      name: "Platform Admin",
      passwordHash: adminHash,
      role: "PLATFORM_ADMIN",
    },
  });
  console.log("Platform admin:", platformAdmin.email);

  // Demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: "lakeview-bowls" },
    update: {},
    create: {
      name: "Lakeview Bowls Club",
      slug: "lakeview-bowls",
      brandColor: "#16a34a",
      locale: "en",
      seasonStart: "2026-04-01",
      seasonEnd: "2026-09-30",
      openingTime: "09:00",
      closingTime: "18:00",
      latitude: 54.9783,
      longitude: -1.6178,
    },
  });
  const tenantId = tenant.id;

  // Greens & rinks
  const green = await prisma.green.upsert({
    where: { id: "seed-green-1" },
    update: {},
    create: {
      id: "seed-green-1",
      name: "Main Green",
      tenantId: tenant.id,
      seasonStartMMDD: "04-01",
      seasonEndMMDD: "09-30",
    },
  });

  for (let i = 1; i <= 6; i++) {
    await prisma.rink.upsert({
      where: { id: `seed-rink-${i}` },
      update: {},
      create: {
        id: `seed-rink-${i}`,
        name: `Rink ${i}`,
        greenId: green.id,
      },
    });
  }

  // All-weather green (open year-round)
  const allWeatherGreen = await prisma.green.upsert({
    where: { id: "seed-green-2" },
    update: {},
    create: {
      id: "seed-green-2",
      name: "All Weather Green",
      tenantId: tenant.id,
      allWeather: true,
    },
  });

  for (let i = 7; i <= 9; i++) {
    await prisma.rink.upsert({
      where: { id: `seed-rink-${i}` },
      update: {},
      create: {
        id: `seed-rink-${i}`,
        name: `Rink ${i}`,
        greenId: allWeatherGreen.id,
      },
    });
  }

  // Demo GreenSeason override: 2027 season opened early for championship
  await prisma.greenSeason.upsert({
    where: { greenId_year: { greenId: green.id, year: 2027 } },
    update: {},
    create: {
      greenId: green.id,
      year: 2027,
      startDate: "2027-03-15",
      endDate: "2027-10-15",
      note: "Extended for County Championship",
    },
  });

  // Tenant admin user
  const tenantAdminHash = await bcrypt.hash("club123", 12);
  await prisma.user.upsert({
    where: { email: "admin@lakeview.club" },
    update: {},
    create: {
      email: "admin@lakeview.club",
      name: "Lakeview Admin",
      passwordHash: tenantAdminHash,
      role: "TENANT_ADMIN",
      tenantId: tenant.id,
    },
  });

  // Regular user
  const userHash = await bcrypt.hash("user123", 12);
  await prisma.user.upsert({
    where: { email: "user@lakeview.club" },
    update: {},
    create: {
      email: "user@lakeview.club",
      name: "Doris Smith",
      passwordHash: userHash,
      role: "USER",
      tenantId: tenant.id,
    },
  });

  // Maintenance user
  await prisma.user.upsert({
    where: { email: "maint@lakeview.club" },
    update: {},
    create: {
      email: "maint@lakeview.club",
      name: "Kevin Grounds",
      passwordHash: userHash,
      role: "MAINTENANCE",
      tenantId: tenant.id,
    },
  });

  // Feature flags — enable everything in dev so we don't have to toggle manually
  const enabledFlags = ["messaging", "events", "eventsShareExternal", "eventsShowExternal", "analytics", "publicContent", "publicEvents", "publicAvailability", "weather", "agent", "bookings", "liveStreaming", "federation", "helpOverrides", "funding", "businessInsights", "noShowPrediction", "modelOps"];
  const disabledFlags: string[] = [];
  for (const key of enabledFlags) {
    await prisma.featureFlag.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key } },
      update: {},
      create: { tenantId: tenant.id, key, enabled: true },
    });
  }
  for (const key of disabledFlags) {
    await prisma.featureFlag.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key } },
      update: {},
      create: { tenantId: tenant.id, key, enabled: false },
    });
  }

  // Sample events
  const tenantAdmin = await prisma.user.findUnique({ where: { email: "admin@lakeview.club" } });
  if (tenantAdmin) {
    const existingEvents = await prisma.event.count({ where: { tenantId: tenant.id } });
    if (existingEvents === 0) {
      await prisma.event.createMany({
        data: [
          {
            tenantId: tenant.id,
            title: "Summer Open Day",
            description: "Come and try bowls! Free taster sessions for new players of all ages.",
            category: "OPEN_DAY",
            date: "2026-06-15",
            startTime: "10:00",
            endTime: "16:00",
            visibility: "PUBLIC",
            status: "PUBLISHED",
            createdById: tenantAdmin.id,
          },
          {
            tenantId: tenant.id,
            title: "Club Pairs Championship",
            description: "Annual pairs knockout competition. Entry fee includes lunch.",
            category: "COMPETITION",
            format: "KNOCKOUT",
            playerCount: "PAIRS",
            date: "2026-07-12",
            startTime: "09:00",
            endTime: "17:00",
            capacity: 32,
            entryFee: 1500,
            contactName: "Lakeview Admin",
            contactEmail: "admin@lakeview.club",
            visibility: "MEMBERS_ONLY",
            status: "PUBLISHED",
            createdById: tenantAdmin.id,
          },
          {
            tenantId: tenant.id,
            title: "Friday Social Roll-Up",
            description: "Casual Friday afternoon social bowling. All welcome, no need to book.",
            category: "SOCIAL",
            date: "2026-06-20",
            startTime: "14:00",
            endTime: "17:00",
            visibility: "MEMBERS_ONLY",
            status: "DRAFT",
            createdById: tenantAdmin.id,
          },
        ],
      });
    }
  }

  // Streaming subscription (SILVER tier for demo)
  await prisma.tenantSubscription.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      tier: "SILVER",
      maxConcurrentStreams: 3,
      archiveRetentionDays: 7,
      priceMonthlyPence: 5000,
      status: "ACTIVE",
    },
  });
  console.log("Streaming subscription seeded (SILVER tier).");

  // ─── Platform Plans ──────────────────────────────────────────────
  const plans = [
    { id: "plan_starter_001", name: "Starter", slug: "starter", description: "For small clubs getting started", priceMonthlyPence: 2500, trialDays: 30, maxMembers: 50, maxGreens: 2, includedStreamingTier: "NONE" as const, featureFlags: { messaging: true, events: true }, sortOrder: 1 },
    { id: "plan_standard_001", name: "Standard", slug: "standard", description: "For established clubs with active membership", priceMonthlyPence: 5000, trialDays: 30, maxMembers: 150, maxGreens: 4, includedStreamingTier: "BRONZE" as const, featureFlags: { messaging: true, events: true, publicEvents: true, publicAvailability: true, liveStreaming: true }, sortOrder: 2 },
    { id: "plan_premium_001", name: "Premium", slug: "premium", description: "For large clubs wanting the full platform", priceMonthlyPence: 10000, trialDays: 30, maxMembers: 500, maxGreens: 10, includedStreamingTier: "GOLD" as const, featureFlags: { messaging: true, events: true, publicEvents: true, publicAvailability: true, liveStreaming: true, analytics: true }, sortOrder: 3 },
    { id: "plan_charity_001", name: "Charity Admin", slug: "charity-admin", description: "For registered charities and CIOs using funding and governance tools only", priceMonthlyPence: 2000, trialDays: 30, maxMembers: 200, maxGreens: 0, includedStreamingTier: "NONE" as const, featureFlags: { messaging: true, events: true, funding: true, charity: true }, sortOrder: 4 },
  ];
  for (const plan of plans) {
    await prisma.platformPlan.upsert({
      where: { slug: plan.slug },
      update: { priceMonthlyPence: plan.priceMonthlyPence, maxMembers: plan.maxMembers, maxGreens: plan.maxGreens, includedStreamingTier: plan.includedStreamingTier, featureFlags: plan.featureFlags, sortOrder: plan.sortOrder, active: true },
      create: plan,
    });
  }
  console.log("Platform plans seeded (Starter / Standard / Premium).");

  // Ensure demo tenant has a billing profile
  const existingProfile = await prisma.tenantBillingProfile.findUnique({ where: { tenantId: tenant.id } });
  if (!existingProfile) {
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await prisma.tenantBillingProfile.create({
      data: {
        tenantId: tenant.id,
        planId: "plan_starter_001",
        billingStatus: "TRIAL",
        currentPeriodStart: now,
        currentPeriodEnd: trialEnd,
        trialEndsAt: trialEnd,
      },
    });
  }
  console.log("Demo tenant billing profile seeded.");

  await seedPermissionGroups(tenant.id);
  await seedAgents(tenant.id);
  await seedMlFeatures();

  // Ensure demo users have Membership rows and are added to the built-in groups
  const tenantAdminUser = await prisma.user.findUnique({ where: { email: "admin@lakeview.club" } });
  if (tenantAdminUser) {
    await prisma.membership.upsert({
      where: { userId_tenantId: { userId: tenantAdminUser.id, tenantId } },
      update: {},
      create: { userId: tenantAdminUser.id, tenantId, role: "TENANT_ADMIN", kind: "STAFF", status: "ACTIVE" },
    });
  }

  const regularUser = await prisma.user.findUnique({ where: { email: "user@lakeview.club" } });
  if (regularUser) {
    await prisma.membership.upsert({
      where: { userId_tenantId: { userId: regularUser.id, tenantId } },
      update: {},
      create: { userId: regularUser.id, tenantId, role: "USER", kind: "MEMBER", status: "ACTIVE" },
    });
  }

  const maintUser = await prisma.user.findUnique({ where: { email: "maint@lakeview.club" } });
  if (maintUser) {
    await prisma.membership.upsert({
      where: { userId_tenantId: { userId: maintUser.id, tenantId } },
      update: {},
      create: { userId: maintUser.id, tenantId, role: "MAINTENANCE", kind: "MEMBER", status: "ACTIVE" },
    });
  }

  // Add demo memberships to built-in groups so they inherit the seeded grants
  const membersGroup = await prisma.permissionGroup.findUnique({ where: { tenantId_name: { tenantId, name: "Members" } } });
  const adminsGroup = await prisma.permissionGroup.findUnique({ where: { tenantId_name: { tenantId, name: "Administrators" } } });
  const maintenanceGroup = await prisma.permissionGroup.findUnique({ where: { tenantId_name: { tenantId, name: "Maintenance Staff" } } });

  if (membersGroup && regularUser) {
    const regMembership = await prisma.membership.findUnique({ where: { userId_tenantId: { userId: regularUser.id, tenantId } } });
    if (regMembership) {
      await prisma.groupMember.upsert({
        where: { groupId_membershipId: { groupId: membersGroup.id, membershipId: regMembership.id } },
        update: {},
        create: { groupId: membersGroup.id, membershipId: regMembership.id },
      });
    }
  }

  if (adminsGroup && tenantAdminUser) {
    const adminMembership = await prisma.membership.findUnique({ where: { userId_tenantId: { userId: tenantAdminUser.id, tenantId } } });
    if (adminMembership) {
      await prisma.groupMember.upsert({
        where: { groupId_membershipId: { groupId: adminsGroup.id, membershipId: adminMembership.id } },
        update: {},
        create: { groupId: adminsGroup.id, membershipId: adminMembership.id },
      });
    }
  }

  if (maintenanceGroup && maintUser) {
    const mMembership = await prisma.membership.findUnique({ where: { userId_tenantId: { userId: maintUser.id, tenantId } } });
    if (mMembership) {
      await prisma.groupMember.upsert({
        where: { groupId_membershipId: { groupId: maintenanceGroup.id, membershipId: mMembership.id } },
        update: {},
        create: { groupId: maintenanceGroup.id, membershipId: mMembership.id },
      });
    }
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

// ─── Permission Groups (built-in groups per tenant) ─────────────────
//
// Seeds three built-in groups that mirror the existing role tiers. Groups are
// additive — existing users keep working via role gates. Group membership is
// opt-in for new features. Safe to re-run (upsert on tenantId+name).

const BUILT_IN_GROUPS: { name: string; description: string; permissions: string[] }[] = [
  {
    name: "Members",
    description: "Standard member permissions — book, view events, message, view help.",
    permissions: [
      "bookings_view", "bookings_create",
      "events_view",
      "messaging_view", "messaging_send",
      "notifications_view",
      "help_view",
      // Allow regular members to submit maintenance tasks via permission grant
      "maintenance_create",
    ],
  },
  {
    name: "Maintenance Staff",
    description: "Members permissions plus maintenance task management and agent review.",
    permissions: [
      "bookings_view", "bookings_create",
      "events_view",
      "messaging_view", "messaging_send",
      "notifications_view",
      "help_view",
      "maintenance_view", "maintenance_create", "maintenance_assign", "maintenance_close",
      "agents_view", "agents_review_proposals",
    ],
  },
  {
    name: "Administrators",
    description: "All permissions. TENANT_ADMIN also has an implicit all-permissions bypass.",
    permissions: [
      "bookings_view", "bookings_create", "bookings_manage", "bookings_admin_override",
      "maintenance_view", "maintenance_create", "maintenance_assign", "maintenance_close",
      "events_view", "events_create", "events_manage",
      "messaging_view", "messaging_send", "messaging_manage_channels",
      "content_view", "content_edit", "content_publish",
      "greens_view", "greens_manage",
      "streaming_view", "streaming_manage",
      "charity_view", "charity_edit", "charity_finalise_tar", "charity_manage_funds",
      "analytics_view",
      "audit_view",
      "help_view", "help_manage_overrides",
      "users_view", "users_invite", "users_manage",
      "settings_view", "settings_edit",
      "billing_view", "billing_manage",
      "agents_view", "agents_configure", "agents_review_proposals",
      "notifications_view", "notifications_manage",
      "federation_book_at_partners", "federation_manage",
      "funding_view", "funding_manage",
    ],
  },
];

async function seedPermissionGroups(tenantId: string) {
  for (const group of BUILT_IN_GROUPS) {
    const existing = await prisma.permissionGroup.findUnique({
      where: { tenantId_name: { tenantId, name: group.name } },
      include: { grants: true },
    });
    if (existing) {
      // Ensure grants are up to date (idempotent)
      const existingPerms = new Set(existing.grants.map((g: { permission: string }) => g.permission));
      for (const perm of group.permissions) {
        if (!existingPerms.has(perm)) {
          await prisma.permissionGrant.create({
            data: { groupId: existing.id, permission: perm as any },
          });
        }
      }
    } else {
      await prisma.permissionGroup.create({
        data: {
          tenantId,
          name: group.name,
          description: group.description,
          isBuiltIn: true,
          grants: {
            create: group.permissions.map((p) => ({ permission: p as any })),
          },
        },
      });
    }
  }
  console.log("Permission groups seeded (3 built-in groups).");
}

// ─── Agent Framework Seeding ────────────────────────────────────────
//
// Creates two system users (one per agent), AgentDefinition rows that link
// each slug to its system user, and a starter knowledge base derived from
// STRI / IOG bowls turf guidance. All idempotent (upsert) so safe to re-run.

async function seedAgents(demoTenantId: string) {
  const agents = [
    { slug: "detector", name: "Complaint Detector", email: "detector@agent.system",
      description: "Monitors chat messages and converts complaints into maintenance tasks." },
    { slug: "no-show", name: "No-Show Risk Predictor", email: "noshow@agent.system",
      description: "Predicts booking no-show risk using machine learning and sends reminder proposals." },
    { slug: "triager", name: "Triage Officer", email: "triager@agent.system",
      description: "Prioritises and assigns submitted maintenance tasks using workload, weather and history." },
    { slug: "funding-app", name: "Funding Application Drafter", email: "funding-app@agent.system",
      description: "Drafts answers for DRAFT funding applications using club data and common grant question patterns." },
  ];

  const sysHash = await bcrypt.hash(`agent-system-${Date.now()}`, 12);

  for (const a of agents) {
    const user = await prisma.user.upsert({
      where: { email: a.email },
      update: { name: a.name },
      create: { email: a.email, name: a.name, passwordHash: sysHash, role: "PLATFORM_ADMIN" },
    });
    await prisma.agentDefinition.upsert({
      where: { slug: a.slug },
      update: { name: a.name, description: a.description },
      create: { slug: a.slug, name: a.name, description: a.description, systemUserId: user.id },
    });
    console.log(`Agent registered: ${a.slug}`);
  }

  // ── Knowledge: GLOBAL — agronomy basics (STRI / IOG informed) ──
  const globalKnowledge = [
    { category: "green_care", title: "Mowing height — playing season",
      content: "Bowls greens should be cut at 4–5 mm during competitive play, raised to 6–8 mm in shoulder seasons. Cutting below 4 mm stresses the sward and invites disease." },
    { category: "green_care", title: "Top-dressing schedule",
      content: "Apply 2–3 kg/m² of compatible sand-based dressing in spring and again post-renovation in autumn. Always brush in thoroughly." },
    { category: "green_care", title: "Verti-cutting and grooming",
      content: "Light grooming weekly during the season removes thatch and encourages upright growth. Aggressive verti-cutting should be reserved for shoulder seasons." },
    { category: "green_care", title: "Hollow-tine aeration",
      content: "Annual hollow-tine aeration in autumn (10–13 mm tines, 50 mm spacing) is essential to relieve compaction and gas exchange in the rootzone." },
    { category: "irrigation", title: "Watering principles",
      content: "Apply 6–10 mm of water 2–3 times per week, ideally before sunrise. Avoid daily light watering, which encourages shallow roots and Poa annua invasion." },
    { category: "disease", title: "Fusarium patch — early signs",
      content: "Look for small (5–10 cm) circular brown patches with a darker pink halo, typically after warm humid days followed by dewy nights. Improve airflow and reduce nitrogen if recurrent." },
    { category: "disease", title: "Anthracnose — stress trigger",
      content: "Yellow-orange patches under heat or drought stress on Poa-dominant swards. Maintain consistent moisture and avoid mowing too low during heat waves." },
    { category: "pests", title: "Leatherjackets and chafer grubs",
      content: "Indicated by yellow patches that lift easily, plus bird damage (corvids tearing turf). Inspect rootzone in autumn; biological control with nematodes is most effective at soil temperatures of 12 °C+." },
    { category: "weeds", title: "Poa annua management",
      content: "Annual meadow-grass thrives in compacted, over-irrigated turf. Manage via cultural practices: aeration, balanced nutrition, deeper less frequent watering." },
    { category: "safety", title: "Slip hazards on banks and steps",
      content: "Algae and moss on shaded paths/banks must be flagged as URGENT. Treat with iron sulphate or pressure wash; do not delay reporting." },
    { category: "safety", title: "Equipment lock-out",
      content: "Any unguarded blade, fuel leak, or live electrical fault is URGENT and triggers immediate equipment lock-out and isolation." },
    { category: "equipment", title: "Mower blade sharpness",
      content: "Cylinder mowers should be back-lapped weekly during peak season. Tearing rather than slicing leaves a yellow ragged tip on the leaf within 24 hours." },
    { category: "facilities", title: "Pavilion / clubhouse hazards",
      content: "Loose flooring, broken handrails, faulty lighting on stairs, and blocked fire exits are HIGH or URGENT depending on access. Treat as URGENT during event days." },
  ];
  for (const k of globalKnowledge) {
    await upsertGlobalKnowledge(k.category, k.title, k.content, 5);
  }

  // Detector-specific guidance: how to read complaints
  const detectorKnowledge = [
    { category: "complaint_classification", title: "Vocabulary for severity",
      content: "Treat words like 'dangerous', 'unsafe', 'injured', 'fell', 'fire' as URGENT. Words like 'broken', 'leak', 'not working' as HIGH. Cosmetic terms ('untidy', 'patchy', 'looks rough') as MEDIUM unless safety is implied." },
    { category: "complaint_classification", title: "Distinguish complaint from request",
      content: "A complaint reports a perceived problem (existing condition). A request asks for a new feature or change. Only complaints become tasks." },
    { category: "complaint_classification", title: "False positives to ignore",
      content: "Sarcasm, jokes, off-topic chat, and questions phrased as 'is anyone else…' without a concrete problem should NOT be treated as complaints. Confidence < 0.6." },
  ];
  for (const k of detectorKnowledge) {
    await upsertAgentScopedKnowledge("detector", k.category, k.title, k.content, 5);
  }

  // Triager-specific guidance
  const triagerKnowledge = [
    { category: "prioritisation", title: "Weather-aware urgency",
      content: "If heavy rain (>10 mm) is forecast in next 48h, deprioritise mowing and surface treatments; prioritise drainage clearance and bunker covers. If a heatwave (>25 °C max) is forecast, prioritise irrigation checks." },
    { category: "prioritisation", title: "Event-day amplification",
      content: "Tasks affecting greens, walkways, or facilities used by an upcoming event (within 7 days) should be promoted by one priority level." },
    { category: "assignment", title: "Workload balancing",
      content: "Avoid assigning a fifth open task to a staff member while another has fewer than two. Skill specialisation outweighs workload only for SAFETY/EQUIPMENT categories." },
    { category: "assignment", title: "Recent activity cooldown",
      content: "If maintenance history shows the same activity (e.g. mowing Green 4) was performed in the last 48 hours, demote duplicate-style tasks unless urgency dictates otherwise." },
  ];
  for (const k of triagerKnowledge) {
    await upsertAgentScopedKnowledge("triager", k.category, k.title, k.content, 5);
  }

  // REGIONAL — UK climate band (covers Lakeview's lat 54.97 → bucket LAT_54_LNG_-2)
  const regionalUK = [
    { category: "seasonal_calendar", title: "April — UK opening",
      content: "Greens typically open early April. First cut at 8 mm, lowering to 6 mm by month-end. Apply spring fertiliser (12-0-9) at 25 g/m²." },
    { category: "seasonal_calendar", title: "July — UK peak",
      content: "Watch for fusarium during humid spells; keep cut at 4 mm; irrigate 2× weekly deeply rather than daily. Watch for fairy ring." },
    { category: "seasonal_calendar", title: "September — UK renovation",
      content: "Renovation window: hollow-tine, scarify, overseed (browntop bent at 35 g/m²), top-dress 3 kg/m². Reduce nitrogen." },
  ];
  for (const k of regionalUK) {
    await upsertRegionalKnowledge("LAT_54_LNG_-2", k.category, k.title, k.content, 5);
  }

  // TENANT — demo tenant only, illustrative
  const tenantKnowledge = [
    { category: "site_specific", title: "Main Green — drainage history",
      content: "Main Green has historically poor drainage at the SE corner. After heavy rain (>15 mm), expect 24-hour playing restriction; flag drainage maintenance as HIGH." },
    { category: "site_specific", title: "Pavilion — known wear points",
      content: "Pavilion changing room door handle has been replaced twice in 2025. Treat any 'sticky door' complaint as a confirmed defect, not a one-off." },
  ];
  for (const k of tenantKnowledge) {
    await upsertTenantKnowledge(demoTenantId, k.category, k.title, k.content, 5);
  }

  console.log("Agent knowledge seeded.");
}

async function upsertGlobalKnowledge(category: string, title: string, content: string, priority: number) {
  const existing = await prisma.agentKnowledge.findFirst({
    where: { scope: "GLOBAL", category, title, agentId: null, tenantId: null },
  });
  if (existing) {
    await prisma.agentKnowledge.update({ where: { id: existing.id }, data: { content, priority } });
  } else {
    await prisma.agentKnowledge.create({
      data: { scope: "GLOBAL", category, title, content, priority, source: "MANUAL" },
    });
  }
}

async function upsertRegionalKnowledge(region: string, category: string, title: string, content: string, priority: number) {
  const existing = await prisma.agentKnowledge.findFirst({
    where: { scope: "REGIONAL", region, category, title, agentId: null, tenantId: null },
  });
  if (existing) {
    await prisma.agentKnowledge.update({ where: { id: existing.id }, data: { content, priority } });
  } else {
    await prisma.agentKnowledge.create({
      data: { scope: "REGIONAL", region, category, title, content, priority, source: "MANUAL" },
    });
  }
}

async function upsertTenantKnowledge(tenantId: string, category: string, title: string, content: string, priority: number) {
  const existing = await prisma.agentKnowledge.findFirst({
    where: { scope: "TENANT", tenantId, category, title, agentId: null },
  });
  if (existing) {
    await prisma.agentKnowledge.update({ where: { id: existing.id }, data: { content, priority } });
  } else {
    await prisma.agentKnowledge.create({
      data: { scope: "TENANT", tenantId, category, title, content, priority, source: "MANUAL" },
    });
  }
}

async function upsertAgentScopedKnowledge(slug: string, category: string, title: string, content: string, priority: number) {
  const def = await prisma.agentDefinition.findUnique({ where: { slug } });
  if (!def) return;
  const existing = await prisma.agentKnowledge.findFirst({
    where: { scope: "GLOBAL", agentId: def.id, category, title },
  });
  if (existing) {
    await prisma.agentKnowledge.update({ where: { id: existing.id }, data: { content, priority } });
  } else {
    await prisma.agentKnowledge.create({
      data: { scope: "GLOBAL", agentId: def.id, category, title, content, priority, source: "MANUAL" },
    });
  }
}

async function seedMlFeatures() {
  const features = [
    { key: "lead_time_days",      label: "Lead time (days)",       kind: "NUMERIC" as const,      description: "Days between booking creation and play date. Computed as (playDate - createdAt.date)." },
    { key: "hour_of_day",         label: "Hour of day",            kind: "NUMERIC" as const,      description: "Start hour of the booked time slot (0–23)." },
    { key: "is_weekend",          label: "Weekend flag",           kind: "NUMERIC" as const,      description: "1 if the booking is on a Saturday or Sunday, 0 otherwise." },
    { key: "is_all_weather",      label: "All-weather green",      kind: "NUMERIC" as const,      description: "1 if the green is designated all-weather, 0 otherwise." },
    { key: "tenure_days",         label: "Member tenure (days)",   kind: "NUMERIC" as const,      description: "Days between the member's account creation and the play date." },
    { key: "prior_no_show_count", label: "Prior no-shows",         kind: "NUMERIC" as const,      description: "Number of times this member has previously been marked NO_SHOW at this tenant." },
    { key: "day_of_week",         label: "Day of week",            kind: "CATEGORICAL" as const,  description: "ISO weekday of the booking date (0 = Monday, 6 = Sunday)." },
    { key: "month",               label: "Month",                  kind: "CATEGORICAL" as const,  description: "Calendar month of the booking date (1 = January … 12 = December)." },
  ];

  for (const f of features) {
    await prisma.mlFeatureDefinition.upsert({
      where: { key: f.key },
      update: { label: f.label, description: f.description },
      create: { key: f.key, label: f.label, kind: f.kind, status: "ENROLLED", description: f.description },
    });
  }
  console.log(`ML feature definitions seeded (${features.length} features, all ENROLLED).`);
}
