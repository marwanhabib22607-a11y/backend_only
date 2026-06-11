import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { plansTable, subscriptionsTable, artisanProfilesTable } from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";

const router = Router();

router.get("/plans", async (_req, res): Promise<void> => {
  const plans = await db.select().from(plansTable).where(eq(plansTable.isActive, true));
  res.json(plans);
});

// My subscription
router.get("/subscriptions/my", authenticate, requireRole("artisan"), async (req: AuthRequest, res): Promise<void> => {
  const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.userId, req.userId!));
  if (!profile) {
    res.status(404).json({ error: "الملف الشخصي غير موجود" });
    return;
  }

  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.artisanId, profile.id));
  if (!sub) {
    res.status(404).json({ error: "لا يوجد اشتراك" });
    return;
  }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, sub.planId));
  res.json({ ...sub, plan: plan || null, artisan: null });
});

// Create subscription
router.post("/subscriptions/my", authenticate, requireRole("artisan"), async (req: AuthRequest, res): Promise<void> => {
  const { planId, billingCycle } = req.body;

  if (!planId || !billingCycle) {
    res.status(400).json({ error: "يجب اختيار الخطة ودورة الفوترة" });
    return;
  }

  const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.userId, req.userId!));
  if (!profile) {
    res.status(404).json({ error: "الملف الشخصي غير موجود" });
    return;
  }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId));
  if (!plan) {
    res.status(404).json({ error: "الخطة غير موجودة" });
    return;
  }

  const startDate = new Date();
  const endDate = new Date();
  if (billingCycle === "monthly") {
    endDate.setMonth(endDate.getMonth() + 1);
  } else {
    endDate.setFullYear(endDate.getFullYear() + 1);
  }

  const existing = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.artisanId, profile.id));
  let sub;
  if (existing.length > 0) {
    [sub] = await db.update(subscriptionsTable).set({
      planId,
      status: "active",
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
      billingCycle,
    }).where(eq(subscriptionsTable.artisanId, profile.id)).returning();
  } else {
    [sub] = await db.insert(subscriptionsTable).values({
      artisanId: profile.id,
      planId,
      status: "active",
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
      billingCycle,
    }).returning();
  }

  res.status(201).json({ ...sub, plan, artisan: null });
});

export default router;
