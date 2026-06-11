import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  serviceRequestsTable,
  serviceRequestImagesTable,
  artisanProfilesTable,
  usersTable,
  offersTable,
} from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";

const router = Router();

// My jobs (artisan) — returns requests + accepted offer details embedded
router.get("/jobs/my", authenticate, requireRole("artisan"), async (req: AuthRequest, res): Promise<void> => {
  const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.userId, req.userId!));
  if (!profile) {
    res.json([]);
    return;
  }

  const acceptedOffers = await db.select().from(offersTable).where(
    and(eq(offersTable.artisanId, profile.id), eq(offersTable.status, "accepted"))
  );

  const results = [];

  for (const offer of acceptedOffers) {
    const [request] = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.id, offer.requestId));
    if (!request) continue;

    const images = await db
      .select({ imageUrl: serviceRequestImagesTable.imageUrl })
      .from(serviceRequestImagesTable)
      .where(eq(serviceRequestImagesTable.requestId, request.id));

    const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, request.customerId));
    const { passwordHash: _, ...safeCustomer } = customer || { passwordHash: "" };

    results.push({
      ...request,
      images: images.map(i => i.imageUrl),
      customer: customer ? safeCustomer : null,
      acceptedOffer: {
        id: offer.id,
        price: offer.price,
        arrivalTime: offer.arrivalTimeText,
        duration: offer.estimatedDurationText,
        message: offer.message,
        status: offer.status,
        createdAt: offer.createdAt,
      },
    });
  }

  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json(results);
});

// Update job status (artisan)
router.patch("/jobs/:requestId/status", authenticate, requireRole("artisan"), async (req: AuthRequest, res): Promise<void> => {
  const requestId = parseInt(Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId, 10);
  const { status } = req.body;

  if (!status || !["in_progress", "completed"].includes(status)) {
    res.status(400).json({ error: "الحالة غير صحيحة" });
    return;
  }

  const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.userId, req.userId!));
  if (!profile) {
    res.status(404).json({ error: "الملف الشخصي غير موجود" });
    return;
  }

  const [request] = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.id, requestId));
  if (!request) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  const [updated] = await db
    .update(serviceRequestsTable)
    .set({ status })
    .where(eq(serviceRequestsTable.id, requestId))
    .returning();

  if (status === "completed") {
    await db
      .update(artisanProfilesTable)
      .set({ completedJobs: profile.completedJobs + 1 })
      .where(eq(artisanProfilesTable.id, profile.id));
  }

  const images = await db
    .select({ imageUrl: serviceRequestImagesTable.imageUrl })
    .from(serviceRequestImagesTable)
    .where(eq(serviceRequestImagesTable.requestId, updated.id));

  const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, updated.customerId));
  const { passwordHash: _, ...safeCustomer } = customer || { passwordHash: "" };

  const [offer] = await db.select().from(offersTable).where(
    and(eq(offersTable.requestId, requestId), eq(offersTable.artisanId, profile.id))
  );

  res.json({
    ...updated,
    images: images.map(i => i.imageUrl),
    customer: customer ? safeCustomer : null,
    acceptedOffer: offer ? {
      id: offer.id,
      price: offer.price,
      arrivalTime: offer.arrivalTimeText,
      duration: offer.estimatedDurationText,
      message: offer.message,
      status: offer.status,
      createdAt: offer.createdAt,
    } : null,
  });
});

export default router;
