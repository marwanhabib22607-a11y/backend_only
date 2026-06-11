import { Router } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  offersTable,
  offerNegotiationsTable,
  artisanProfilesTable,
  serviceRequestsTable,
  conversationsTable,
  usersTable,
} from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";

const router = Router();

async function buildOffer(offer: typeof offersTable.$inferSelect) {
  const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.id, offer.artisanId));
  let artisan = null;
  if (profile) {
    const [artisanUser] = await db.select().from(usersTable).where(eq(usersTable.id, profile.userId));
    const { passwordHash: _, ...safeUser } = artisanUser;
    artisan = { ...profile, user: safeUser, specialties: [] };
  }

  const [request] = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.id, offer.requestId));
  let reqObj = null;
  if (request) {
    const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, request.customerId));
    const { passwordHash: _, ...safeCust } = customer;
    reqObj = { ...request, images: [], customer: safeCust, offersCount: 0 };
  }

  return { ...offer, artisan, request: reqObj };
}

// List offers for request
router.get("/requests/:requestId/offers", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const requestId = parseInt(Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId, 10);
  const offers = await db.select().from(offersTable).where(eq(offersTable.requestId, requestId));
  const results = await Promise.all(offers.map(buildOffer));
  res.json(results);
});

// Submit offer
router.post("/requests/:requestId/offers", authenticate, requireRole("artisan"), async (req: AuthRequest, res): Promise<void> => {
  const requestId = parseInt(Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId, 10);
  const { price, arrivalTimeText, estimatedDurationText, message } = req.body;

  if (!price || !arrivalTimeText || !estimatedDurationText || !message) {
    res.status(400).json({ error: "جميع حقول العرض مطلوبة" });
    return;
  }

  const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.userId, req.userId!));
  if (!profile) {
    res.status(400).json({ error: "يجب إنشاء ملف حرفي أولاً" });
    return;
  }

  if (profile.verificationStatus !== "approved") {
    res.status(403).json({ error: "يجب أن يكون حسابك معتمداً لتقديم عروض" });
    return;
  }

  const [request] = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.id, requestId));
  if (!request || (request.status !== "open" && request.status !== "receiving_offers")) {
    res.status(400).json({ error: "هذا الطلب لا يقبل عروضاً" });
    return;
  }

  const existing = await db.select().from(offersTable).where(
    and(eq(offersTable.requestId, requestId), eq(offersTable.artisanId, profile.id))
  );
  if (existing.length > 0) {
    res.status(409).json({ error: "لديك عرض مسبق على هذا الطلب" });
    return;
  }

  const [newOffer] = await db.insert(offersTable).values({
    requestId,
    artisanId: profile.id,
    price: parseFloat(price),
    arrivalTimeText,
    estimatedDurationText,
    message,
    status: "pending",
  }).returning();

  await db.update(serviceRequestsTable).set({ status: "receiving_offers" }).where(eq(serviceRequestsTable.id, requestId));

  const result = await buildOffer(newOffer);
  res.status(201).json(result);
});

// My offers (artisan)
router.get("/offers/my", authenticate, requireRole("artisan"), async (req: AuthRequest, res): Promise<void> => {
  const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.userId, req.userId!));
  if (!profile) {
    res.json([]);
    return;
  }
  const offers = await db.select().from(offersTable).where(eq(offersTable.artisanId, profile.id));
  const results = await Promise.all(offers.map(buildOffer));
  res.json(results);
});

// Withdraw offer
router.post("/offers/:offerId/withdraw", authenticate, requireRole("artisan"), async (req: AuthRequest, res): Promise<void> => {
  const offerId = parseInt(Array.isArray(req.params.offerId) ? req.params.offerId[0] : req.params.offerId, 10);

  const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.userId, req.userId!));
  if (!profile) {
    res.status(404).json({ error: "الملف الشخصي غير موجود" });
    return;
  }

  const [offer] = await db.select().from(offersTable).where(
    and(eq(offersTable.id, offerId), eq(offersTable.artisanId, profile.id))
  );

  if (!offer) {
    res.status(404).json({ error: "العرض غير موجود" });
    return;
  }

  const [updated] = await db.update(offersTable).set({ status: "withdrawn" }).where(eq(offersTable.id, offerId)).returning();
  const result = await buildOffer(updated);
  res.json(result);
});

// ─── NEGOTIATION ENDPOINTS ────────────────────────────────────────────────────

// GET /offers/:offerId/negotiations — list negotiation history for an offer
router.get("/offers/:offerId/negotiations", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const offerId = parseInt(Array.isArray(req.params.offerId) ? req.params.offerId[0] : req.params.offerId, 10);

  const [offer] = await db.select().from(offersTable).where(eq(offersTable.id, offerId));
  if (!offer) {
    res.status(404).json({ error: "العرض غير موجود" });
    return;
  }

  // Ensure the requester is either the customer of the request or the artisan who owns the offer
  const [request] = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.id, offer.requestId));
  if (!request) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.id, offer.artisanId));
  const isCustomer = req.userId === request.customerId;
  const isArtisan = profile && req.userId === profile.userId;

  if (!isCustomer && !isArtisan) {
    res.status(403).json({ error: "غير مصرح" });
    return;
  }

  const rounds = await db
    .select()
    .from(offerNegotiationsTable)
    .where(eq(offerNegotiationsTable.offerId, offerId))
    .orderBy(offerNegotiationsTable.createdAt);

  res.json(rounds);
});

// POST /offers/:offerId/counter — submit a counter-offer (customer or artisan)
router.post("/offers/:offerId/counter", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const offerId = parseInt(Array.isArray(req.params.offerId) ? req.params.offerId[0] : req.params.offerId, 10);
  const { proposedPrice, message } = req.body;

  if (!proposedPrice || isNaN(parseFloat(proposedPrice))) {
    res.status(400).json({ error: "السعر المقترح مطلوب" });
    return;
  }

  const [offer] = await db.select().from(offersTable).where(eq(offersTable.id, offerId));
  if (!offer || offer.status !== "pending") {
    res.status(400).json({ error: "العرض غير قابل للتفاوض في حالته الحالية" });
    return;
  }

  const [request] = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.id, offer.requestId));
  if (!request) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.id, offer.artisanId));
  const isCustomer = req.userId === request.customerId;
  const isArtisan = profile && req.userId === profile.userId;

  if (!isCustomer && !isArtisan) {
    res.status(403).json({ error: "غير مصرح" });
    return;
  }

  const senderRole = isCustomer ? "customer" : "artisan";

  const [round] = await db.insert(offerNegotiationsTable).values({
    offerId,
    senderRole,
    proposedPrice: parseFloat(proposedPrice),
    message: message || null,
  }).returning();

  res.status(201).json(round);
});

// POST /offers/:offerId/accept-current — finalize offer at current price (customer or artisan)
router.post("/offers/:offerId/accept-current", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const offerId = parseInt(Array.isArray(req.params.offerId) ? req.params.offerId[0] : req.params.offerId, 10);

  const [offer] = await db.select().from(offersTable).where(eq(offersTable.id, offerId));
  if (!offer || offer.status !== "pending") {
    res.status(400).json({ error: "العرض غير قابل للقبول في حالته الحالية" });
    return;
  }

  const [request] = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.id, offer.requestId));
  if (!request) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.id, offer.artisanId));
  const isCustomer = req.userId === request.customerId;
  const isArtisan = profile && req.userId === profile.userId;

  if (!isCustomer && !isArtisan) {
    res.status(403).json({ error: "غير مصرح" });
    return;
  }

  // Determine the final agreed price:
  // Each party accepts the OPPOSITE party's latest proposed price.
  // Customer accepts → use the latest artisan-originated round (or original offer price).
  // Artisan accepts → use the latest customer-originated round (or original offer price).
  const rounds = await db
    .select()
    .from(offerNegotiationsTable)
    .where(eq(offerNegotiationsTable.offerId, offerId))
    .orderBy(offerNegotiationsTable.createdAt);

  const oppositeRole = isCustomer ? "artisan" : "customer";
  const oppositeRound = [...rounds].reverse().find(r => r.senderRole === oppositeRole);
  const finalPrice = oppositeRound ? oppositeRound.proposedPrice : offer.price;

  // Accept this offer at the final price, reject others
  await db.update(offersTable).set({ status: "accepted", price: finalPrice }).where(eq(offersTable.id, offerId));
  await db.update(offersTable).set({ status: "rejected" }).where(
    and(eq(offersTable.requestId, offer.requestId), sql`${offersTable.id} != ${offerId}`)
  );

  // Update the request
  await db.update(serviceRequestsTable)
    .set({ status: "offer_selected", selectedOfferId: offerId })
    .where(eq(serviceRequestsTable.id, offer.requestId));

  // Create a conversation if none exists
  const existing = await db.select().from(conversationsTable).where(eq(conversationsTable.requestId, offer.requestId));
  if (existing.length === 0 && profile) {
    await db.insert(conversationsTable).values({
      requestId: offer.requestId,
      customerId: request.customerId,
      artisanId: profile.id,
    });
  }

  const result = await buildOffer({ ...offer, status: "accepted", price: finalPrice });
  res.json({ ...result, finalPrice });
});

export default router;
