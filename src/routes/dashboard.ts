import { Router } from "express";
import { eq, and, count } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  serviceRequestsTable,
  offersTable,
  serviceRequestImagesTable,
  usersTable,
} from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";

const router = Router();

router.get("/dashboard/customer", authenticate, requireRole("customer"), async (req: AuthRequest, res): Promise<void> => {
  const allRequests = await db
    .select()
    .from(serviceRequestsTable)
    .where(eq(serviceRequestsTable.customerId, req.userId!));

  const totalRequests = allRequests.length;
  const openRequests = allRequests.filter(r => r.status === "open" || r.status === "receiving_offers").length;
  const inProgressRequests = allRequests.filter(r => r.status === "in_progress" || r.status === "offer_selected").length;
  const completedRequests = allRequests.filter(r => r.status === "completed").length;

  const requestIds = allRequests.map(r => r.id);
  let totalOffers = 0;
  for (const rid of requestIds) {
    const offers = await db.select().from(offersTable).where(eq(offersTable.requestId, rid));
    totalOffers += offers.length;
  }

  const recentRequests = await Promise.all(
    allRequests.slice(0, 5).map(async (r) => {
      const images = await db.select({ imageUrl: serviceRequestImagesTable.imageUrl })
        .from(serviceRequestImagesTable)
        .where(eq(serviceRequestImagesTable.requestId, r.id));
      const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, r.customerId));
      const { passwordHash: _, ...safeCust } = customer || { passwordHash: "" };
      const offers = await db.select().from(offersTable).where(eq(offersTable.requestId, r.id));
      return { ...r, images: images.map(i => i.imageUrl), customer: safeCust, offersCount: offers.length };
    })
  );

  res.json({
    totalRequests,
    openRequests,
    inProgressRequests,
    completedRequests,
    totalOffers,
    recentRequests,
  });
});

export default router;
