import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  reviewsTable,
  usersTable,
  artisanProfilesTable,
  serviceRequestsTable,
} from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";

const router = Router();

async function buildReview(review: typeof reviewsTable.$inferSelect) {
  const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, review.customerId));
  const [artisanProfile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.id, review.artisanId));
  const [request] = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.id, review.requestId));

  const { passwordHash: _c, ...safeCust } = customer || { passwordHash: "" };
  let artisanUser = null;
  if (artisanProfile) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, artisanProfile.userId));
    const { passwordHash: _a, ...safeAU } = u || { passwordHash: "" };
    artisanUser = u ? safeAU : null;
  }

  return {
    ...review,
    customer: customer ? safeCust : null,
    artisan: artisanProfile ? { ...artisanProfile, user: artisanUser, specialties: [] } : null,
    request: request ? { ...request, images: [], customer: null, offersCount: 0 } : null,
  };
}

router.post("/reviews", authenticate, requireRole("customer"), async (req: AuthRequest, res): Promise<void> => {
  const { requestId, artisanId, rating, comment } = req.body;

  if (!requestId || !artisanId || !rating) {
    res.status(400).json({ error: "جميع الحقول المطلوبة يجب ملؤها" });
    return;
  }
  if (rating < 1 || rating > 5) {
    res.status(400).json({ error: "التقييم يجب أن يكون بين 1 و 5" });
    return;
  }

  const existing = await db.select().from(reviewsTable).where(
    and(eq(reviewsTable.requestId, requestId), eq(reviewsTable.customerId, req.userId!))
  );
  if (existing.length > 0) {
    res.status(409).json({ error: "لقد قيّمت هذا الطلب مسبقاً" });
    return;
  }

  const [newReview] = await db.insert(reviewsTable).values({
    requestId,
    customerId: req.userId!,
    artisanId,
    rating,
    comment: comment || null,
  }).returning();

  // Update artisan average rating
  const allReviews = await db.select().from(reviewsTable).where(eq(reviewsTable.artisanId, artisanId));
  const totalRating = allReviews.reduce((sum, r) => sum + r.rating, 0);
  const avgRating = totalRating / allReviews.length;
  await db.update(artisanProfilesTable).set({
    averageRating: avgRating,
    reviewsCount: allReviews.length,
  }).where(eq(artisanProfilesTable.id, artisanId));

  const result = await buildReview(newReview);
  res.status(201).json(result);
});

router.get("/reviews/artisan/:artisanId", async (req, res): Promise<void> => {
  const artisanId = parseInt(Array.isArray(req.params.artisanId) ? req.params.artisanId[0] : req.params.artisanId, 10);
  const reviews = await db.select().from(reviewsTable).where(eq(reviewsTable.artisanId, artisanId));
  const results = await Promise.all(reviews.map(buildReview));
  res.json(results);
});

router.get("/reviews/my", authenticate, async (req: AuthRequest, res): Promise<void> => {
  let reviews;
  if (req.userRole === "customer") {
    reviews = await db.select().from(reviewsTable).where(eq(reviewsTable.customerId, req.userId!));
  } else if (req.userRole === "artisan") {
    const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.userId, req.userId!));
    if (!profile) {
      res.json([]);
      return;
    }
    reviews = await db.select().from(reviewsTable).where(eq(reviewsTable.artisanId, profile.id));
  } else {
    reviews = [];
  }
  const results = await Promise.all(reviews.map(buildReview));
  res.json(results);
});

export default router;
