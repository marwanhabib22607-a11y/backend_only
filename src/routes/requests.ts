import { Router } from "express";
import { eq, and, count, sql, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  serviceRequestsTable,
  serviceRequestImagesTable,
  usersTable,
  offersTable,
  artisanProfilesTable,
  artisanSpecialtiesTable,
  specialtiesTable,
  conversationsTable,
  reviewsTable,
} from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";

const router = Router();

async function buildRequestObject(req: typeof serviceRequestsTable.$inferSelect, includeOffers = false) {
  const images = await db
    .select({ imageUrl: serviceRequestImagesTable.imageUrl })
    .from(serviceRequestImagesTable)
    .where(eq(serviceRequestImagesTable.requestId, req.id));

  const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, req.customerId));
  const { passwordHash: _, ...safeCustomer } = customer || { passwordHash: "" };

  const offerRows = await db.select().from(offersTable).where(eq(offersTable.requestId, req.id));
  const offersCount = offerRows.length;

  const base = {
    ...req,
    images: images.map(i => i.imageUrl),
    customer: customer ? safeCustomer : null,
    offersCount,
  };

  if (!includeOffers) return base;

  const offersWithArtisan = await Promise.all(
    offerRows.map(async (offer) => {
      const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.id, offer.artisanId));
      if (profile) {
        const [artisanUser] = await db.select().from(usersTable).where(eq(usersTable.id, profile.userId));
        const { passwordHash: _p, ...safeArtisanUser } = artisanUser;
        return { ...offer, artisan: { ...profile, user: safeArtisanUser, specialties: [] }, request: null };
      }
      return { ...offer, artisan: null, request: null };
    })
  );

  const [conversation] = await db.select().from(conversationsTable).where(eq(conversationsTable.requestId, req.id));
  const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.requestId, req.id));

  return {
    ...base,
    offers: offersWithArtisan,
    conversation: conversation || null,
    review: review || null,
  };
}

// List requests — artisans see only requests matching their specialties
router.get("/requests", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const { category, city, status, mine } = req.query;

  let rows: (typeof serviceRequestsTable.$inferSelect)[] = [];

  if (mine === "true" || mine === true) {
    // Customer viewing their own requests
    if (req.userRole === "customer") {
      rows = await db.select().from(serviceRequestsTable)
        .where(eq(serviceRequestsTable.customerId, req.userId!))
        .orderBy(sql`${serviceRequestsTable.createdAt} DESC`);
    } else {
      rows = [];
    }
  } else if (req.userRole === "artisan") {
    // Artisans only see open requests matching their specialties
    const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.userId, req.userId!));

    if (!profile) {
      res.json([]);
      return;
    }

    // Get artisan's specialty names
    const artisanSpecs = await db
      .select({ name: specialtiesTable.name })
      .from(artisanSpecialtiesTable)
      .innerJoin(specialtiesTable, eq(artisanSpecialtiesTable.specialtyId, specialtiesTable.id))
      .where(eq(artisanSpecialtiesTable.artisanId, profile.id));

    const specialtyNames = artisanSpecs.map(s => s.name);

    if (specialtyNames.length === 0) {
      // No specialties set → show all open requests with a note that they should set their specialties
      rows = await db.select().from(serviceRequestsTable)
        .where(eq(serviceRequestsTable.status, "open"))
        .orderBy(sql`${serviceRequestsTable.createdAt} DESC`);
    } else {
      // Filter open requests by matching categories
      rows = await db.select().from(serviceRequestsTable)
        .where(and(
          eq(serviceRequestsTable.status, "open"),
          inArray(serviceRequestsTable.category, specialtyNames)
        ))
        .orderBy(sql`${serviceRequestsTable.createdAt} DESC`);
    }
  } else {
    // Admin or other roles see all
    rows = await db.select().from(serviceRequestsTable)
      .orderBy(sql`${serviceRequestsTable.createdAt} DESC`);
  }

  const filtered = rows.filter(r => {
    if (category && r.category !== category) return false;
    if (city && r.city !== city) return false;
    if (status && r.status !== status) return false;
    return true;
  });

  const results = await Promise.all(filtered.map(r => buildRequestObject(r, false)));
  res.json(results);
});

// Create request
router.post("/requests", authenticate, requireRole("customer"), async (req: AuthRequest, res): Promise<void> => {
  const { title, category, description, city, locationText, preferredDate, images } = req.body;

  if (!title || !category || !description || !city || !locationText || !preferredDate) {
    res.status(400).json({ error: "جميع الحقول المطلوبة يجب ملؤها" });
    return;
  }

  const [newReq] = await db.insert(serviceRequestsTable).values({
    customerId: req.userId!,
    title,
    category,
    description,
    city,
    locationText,
    preferredDate,
    status: "open",
  }).returning();

  if (images && Array.isArray(images)) {
    for (const imageUrl of images) {
      await db.insert(serviceRequestImagesTable).values({ requestId: newReq.id, imageUrl });
    }
  }

  const result = await buildRequestObject(newReq, false);
  res.status(201).json(result);
});

// Get single request
router.get("/requests/:requestId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const requestId = parseInt(Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId, 10);
  const [request] = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.id, requestId));

  if (!request) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  const result = await buildRequestObject(request, true);
  res.json(result);
});

// Update request status (customer cancel)
router.patch("/requests/:requestId", authenticate, requireRole("customer"), async (req: AuthRequest, res): Promise<void> => {
  const requestId = parseInt(Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId, 10);
  const { status } = req.body;

  if (!status || status !== "cancelled") {
    res.status(400).json({ error: "الحالة غير صحيحة" });
    return;
  }

  const [request] = await db.select().from(serviceRequestsTable).where(
    and(eq(serviceRequestsTable.id, requestId), eq(serviceRequestsTable.customerId, req.userId!))
  );

  if (!request) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  const [updated] = await db
    .update(serviceRequestsTable)
    .set({ status: "cancelled" })
    .where(eq(serviceRequestsTable.id, requestId))
    .returning();

  const result = await buildRequestObject(updated, false);
  res.json(result);
});

// Select offer (accept an offer directly without negotiation)
router.post("/requests/:requestId/select-offer", authenticate, requireRole("customer"), async (req: AuthRequest, res): Promise<void> => {
  const requestId = parseInt(Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId, 10);
  const { offerId } = req.body;

  if (!offerId) {
    res.status(400).json({ error: "يجب تحديد العرض" });
    return;
  }

  const [request] = await db.select().from(serviceRequestsTable).where(
    and(eq(serviceRequestsTable.id, requestId), eq(serviceRequestsTable.customerId, req.userId!))
  );

  if (!request) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  const [offer] = await db.select().from(offersTable).where(
    and(eq(offersTable.id, offerId), eq(offersTable.requestId, requestId))
  );

  if (!offer) {
    res.status(404).json({ error: "العرض غير موجود" });
    return;
  }

  await db.update(offersTable).set({ status: "accepted" }).where(eq(offersTable.id, offerId));
  await db.update(offersTable).set({ status: "rejected" }).where(
    and(eq(offersTable.requestId, requestId), sql`${offersTable.id} != ${offerId}`)
  );

  const [updated] = await db
    .update(serviceRequestsTable)
    .set({ status: "offer_selected", selectedOfferId: offerId })
    .where(eq(serviceRequestsTable.id, requestId))
    .returning();

  const existing = await db.select().from(conversationsTable).where(eq(conversationsTable.requestId, requestId));
  if (existing.length === 0) {
    await db.insert(conversationsTable).values({
      requestId,
      customerId: req.userId!,
      artisanId: offer.artisanId,
    });
  }

  const result = await buildRequestObject(updated, false);
  res.json(result);
});

export default router;
