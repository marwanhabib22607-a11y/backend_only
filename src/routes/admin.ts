import { Router } from "express";
import { eq, and, count, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  artisanProfilesTable,
  artisanSpecialtiesTable,
  specialtiesTable,
  serviceRequestsTable,
  serviceRequestImagesTable,
  offersTable,
  plansTable,
  subscriptionsTable,
} from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";

const router = Router();

// Admin stats
router.get("/admin/stats", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const users = await db.select().from(usersTable);
  const totalUsers = users.length;
  const totalArtisans = users.filter(u => u.role === "artisan").length;
  const totalCustomers = users.filter(u => u.role === "customer").length;

  const requests = await db.select().from(serviceRequestsTable);
  const totalRequests = requests.length;
  const openRequests = requests.filter(r => r.status === "open" || r.status === "receiving_offers").length;
  const completedRequests = requests.filter(r => r.status === "completed").length;

  const offers = await db.select().from(offersTable);
  const totalOffers = offers.length;

  const artisans = await db.select().from(artisanProfilesTable);
  const pendingVerifications = artisans.filter(a => a.verificationStatus === "pending").length;

  const subs = await db.select().from(subscriptionsTable);
  const activeSubscriptions = subs.filter(s => s.status === "active").length;

  const activePlans = await db.select().from(plansTable);
  const totalRevenue = 0; // Mock for MVP

  res.json({
    totalUsers,
    totalArtisans,
    totalCustomers,
    totalRequests,
    openRequests,
    completedRequests,
    totalOffers,
    pendingVerifications,
    activeSubscriptions,
    totalRevenue,
  });
});

// List all users
router.get("/admin/users", authenticate, requireRole("admin"), async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.createdAt);
  const safeUsers = users.map(({ passwordHash: _, ...u }) => u);
  res.json(safeUsers);
});

// Update user status
router.patch("/admin/users/:userId/status", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const userId = parseInt(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId, 10);
  const { status } = req.body;

  if (!status || !["active", "suspended"].includes(status)) {
    res.status(400).json({ error: "الحالة غير صحيحة" });
    return;
  }

  const [updated] = await db.update(usersTable).set({ status }).where(eq(usersTable.id, userId)).returning();
  if (!updated) {
    res.status(404).json({ error: "المستخدم غير موجود" });
    return;
  }
  const { passwordHash: _, ...safe } = updated;
  res.json(safe);
});

// List artisans
router.get("/admin/artisans", authenticate, requireRole("admin"), async (_req, res): Promise<void> => {
  const artisans = await db.select().from(artisanProfilesTable).orderBy(artisanProfilesTable.createdAt);
  const results = await Promise.all(artisans.map(async (a) => {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, a.userId));
    const specs = await db
      .select({ id: specialtiesTable.id, name: specialtiesTable.name })
      .from(artisanSpecialtiesTable)
      .innerJoin(specialtiesTable, eq(artisanSpecialtiesTable.specialtyId, specialtiesTable.id))
      .where(eq(artisanSpecialtiesTable.artisanId, a.id));
    const { passwordHash: _, ...safeUser } = user || { passwordHash: "" };
    return { ...a, user: user ? safeUser : null, specialties: specs };
  }));
  res.json(results);
});

// Verify artisan
router.post("/admin/artisans/:artisanId/verify", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const artisanId = parseInt(Array.isArray(req.params.artisanId) ? req.params.artisanId[0] : req.params.artisanId, 10);
  const { status } = req.body;

  if (!status || !["approved", "rejected"].includes(status)) {
    res.status(400).json({ error: "الحالة غير صحيحة" });
    return;
  }

  const [updated] = await db
    .update(artisanProfilesTable)
    .set({ verificationStatus: status })
    .where(eq(artisanProfilesTable.id, artisanId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "الحرفي غير موجود" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, updated.userId));
  const specs = await db
    .select({ id: specialtiesTable.id, name: specialtiesTable.name })
    .from(artisanSpecialtiesTable)
    .innerJoin(specialtiesTable, eq(artisanSpecialtiesTable.specialtyId, specialtiesTable.id))
    .where(eq(artisanSpecialtiesTable.artisanId, artisanId));
  const { passwordHash: _, ...safeUser } = user || { passwordHash: "" };
  res.json({ ...updated, user: user ? safeUser : null, specialties: specs });
});

// List all requests
router.get("/admin/requests", authenticate, requireRole("admin"), async (_req, res): Promise<void> => {
  const requests = await db.select().from(serviceRequestsTable).orderBy(serviceRequestsTable.createdAt);
  const results = await Promise.all(requests.map(async (r) => {
    const images = await db.select({ imageUrl: serviceRequestImagesTable.imageUrl })
      .from(serviceRequestImagesTable)
      .where(eq(serviceRequestImagesTable.requestId, r.id));
    const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, r.customerId));
    const { passwordHash: _, ...safeCust } = customer || { passwordHash: "" };
    const offerRows = await db.select().from(offersTable).where(eq(offersTable.requestId, r.id));
    return { ...r, images: images.map(i => i.imageUrl), customer: customer ? safeCust : null, offersCount: offerRows.length };
  }));
  res.json(results.reverse());
});

// List all offers
router.get("/admin/offers", authenticate, requireRole("admin"), async (_req, res): Promise<void> => {
  const offers = await db.select().from(offersTable).orderBy(offersTable.createdAt);
  const results = await Promise.all(offers.map(async (offer) => {
    const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.id, offer.artisanId));
    let artisan = null;
    if (profile) {
      const [artisanUser] = await db.select().from(usersTable).where(eq(usersTable.id, profile.userId));
      const { passwordHash: _, ...safeUser } = artisanUser || { passwordHash: "" };
      artisan = { ...profile, user: artisanUser ? safeUser : null, specialties: [] };
    }
    return { ...offer, artisan, request: null };
  }));
  res.json(results.reverse());
});

// Plans CRUD
router.get("/admin/plans", authenticate, requireRole("admin"), async (_req, res): Promise<void> => {
  const plans = await db.select().from(plansTable).orderBy(plansTable.createdAt);
  res.json(plans);
});

router.post("/admin/plans", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const { name, price, description, features, isActive } = req.body;

  if (!name || price === undefined) {
    res.status(400).json({ error: "اسم الخطة والسعر مطلوبان" });
    return;
  }

  const [plan] = await db.insert(plansTable).values({
    name,
    price: parseFloat(price),
    description: description || null,
    features: features || [],
    isActive: isActive !== false,
  }).returning();

  res.status(201).json(plan);
});

router.patch("/admin/plans/:planId", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const planId = parseInt(Array.isArray(req.params.planId) ? req.params.planId[0] : req.params.planId, 10);
  const { name, price, description, features, isActive } = req.body;

  const updateData: Partial<typeof plansTable.$inferInsert> = {};
  if (name !== undefined) updateData.name = name;
  if (price !== undefined) updateData.price = parseFloat(price);
  if (description !== undefined) updateData.description = description;
  if (features !== undefined) updateData.features = features;
  if (isActive !== undefined) updateData.isActive = isActive;

  const [updated] = await db.update(plansTable).set(updateData).where(eq(plansTable.id, planId)).returning();
  if (!updated) {
    res.status(404).json({ error: "الخطة غير موجودة" });
    return;
  }
  res.json(updated);
});

// Subscriptions
router.get("/admin/subscriptions", authenticate, requireRole("admin"), async (_req, res): Promise<void> => {
  const subs = await db.select().from(subscriptionsTable).orderBy(subscriptionsTable.createdAt);
  const results = await Promise.all(subs.map(async (sub) => {
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, sub.planId));
    const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.id, sub.artisanId));
    let artisan = null;
    if (profile) {
      const [artisanUser] = await db.select().from(usersTable).where(eq(usersTable.id, profile.userId));
      const { passwordHash: _, ...safeUser } = artisanUser || { passwordHash: "" };
      artisan = { ...profile, user: artisanUser ? safeUser : null, specialties: [] };
    }
    return { ...sub, plan: plan || null, artisan };
  }));
  res.json(results.reverse());
});

router.patch("/admin/subscriptions/:subscriptionId/status", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const subscriptionId = parseInt(Array.isArray(req.params.subscriptionId) ? req.params.subscriptionId[0] : req.params.subscriptionId, 10);
  const { status } = req.body;

  if (!status || !["inactive", "active", "expired", "cancelled"].includes(status)) {
    res.status(400).json({ error: "الحالة غير صحيحة" });
    return;
  }

  const [updated] = await db
    .update(subscriptionsTable)
    .set({ status })
    .where(eq(subscriptionsTable.id, subscriptionId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "الاشتراك غير موجود" });
    return;
  }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, updated.planId));
  res.json({ ...updated, plan: plan || null, artisan: null });
});

export default router;
