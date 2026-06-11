import { Router } from "express";
import { eq, and, count } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  artisanProfilesTable,
  artisanSpecialtiesTable,
  specialtiesTable,
  usersTable,
  offersTable,
  serviceRequestsTable,
} from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";

const router = Router();

async function getArtisanWithDetails(artisanId: number) {
  const [profile] = await db
    .select()
    .from(artisanProfilesTable)
    .where(eq(artisanProfilesTable.id, artisanId));
  if (!profile) return null;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, profile.userId));
  const specs = await db
    .select({ id: specialtiesTable.id, name: specialtiesTable.name })
    .from(artisanSpecialtiesTable)
    .innerJoin(specialtiesTable, eq(artisanSpecialtiesTable.specialtyId, specialtiesTable.id))
    .where(eq(artisanSpecialtiesTable.artisanId, artisanId));

  const { passwordHash: _, ...safeUser } = user;
  return { ...profile, user: safeUser, specialties: specs };
}

router.get("/artisans/profile", authenticate, requireRole("artisan"), async (req: AuthRequest, res): Promise<void> => {
  const [profile] = await db
    .select()
    .from(artisanProfilesTable)
    .where(eq(artisanProfilesTable.userId, req.userId!));

  if (!profile) {
    res.status(404).json({ error: "لم يتم العثور على الملف الشخصي" });
    return;
  }

  const result = await getArtisanWithDetails(profile.id);
  res.json(result);
});

router.put("/artisans/profile", authenticate, requireRole("artisan"), async (req: AuthRequest, res): Promise<void> => {
  const { bio, city, avatarUrl, nationalIdImageUrl, specialtyIds } = req.body;

  const [profile] = await db
    .select()
    .from(artisanProfilesTable)
    .where(eq(artisanProfilesTable.userId, req.userId!));

  if (!profile) {
    res.status(404).json({ error: "لم يتم العثور على الملف الشخصي" });
    return;
  }

  await db
    .update(artisanProfilesTable)
    .set({
      bio: bio ?? profile.bio,
      city: city ?? profile.city,
      avatarUrl: avatarUrl ?? profile.avatarUrl,
      nationalIdImageUrl: nationalIdImageUrl ?? profile.nationalIdImageUrl,
    })
    .where(eq(artisanProfilesTable.id, profile.id));

  if (specialtyIds && Array.isArray(specialtyIds)) {
    await db.delete(artisanSpecialtiesTable).where(eq(artisanSpecialtiesTable.artisanId, profile.id));
    for (const specialtyId of specialtyIds) {
      await db.insert(artisanSpecialtiesTable).values({ artisanId: profile.id, specialtyId }).onConflictDoNothing();
    }
  }

  const result = await getArtisanWithDetails(profile.id);
  res.json(result);
});

router.get("/artisans/dashboard/stats", authenticate, requireRole("artisan"), async (req: AuthRequest, res): Promise<void> => {
  const [profile] = await db
    .select()
    .from(artisanProfilesTable)
    .where(eq(artisanProfilesTable.userId, req.userId!));

  if (!profile) {
    res.status(404).json({ error: "الملف الشخصي غير موجود" });
    return;
  }

  const allOffers = await db.select().from(offersTable).where(eq(offersTable.artisanId, profile.id));
  const totalOffers = allOffers.length;
  const pendingOffers = allOffers.filter(o => o.status === "pending").length;
  const acceptedJobs = allOffers.filter(o => o.status === "accepted").length;

  res.json({
    totalOffers,
    acceptedJobs,
    completedJobs: profile.completedJobs,
    averageRating: profile.averageRating ?? null,
    reviewsCount: profile.reviewsCount,
    pendingOffers,
    monthlyEarnings: 0,
  });
});

router.get("/artisans/:artisanId", async (req, res): Promise<void> => {
  const artisanId = parseInt(Array.isArray(req.params.artisanId) ? req.params.artisanId[0] : req.params.artisanId, 10);
  if (isNaN(artisanId)) {
    res.status(400).json({ error: "معرف غير صحيح" });
    return;
  }

  const result = await getArtisanWithDetails(artisanId);
  if (!result) {
    res.status(404).json({ error: "الحرفي غير موجود" });
    return;
  }

  res.json(result);
});

export default router;
