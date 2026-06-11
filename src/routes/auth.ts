import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  artisanProfilesTable,
  artisanSpecialtiesTable,
  specialtiesTable,
} from "@workspace/db";
import { hashPassword, comparePassword, signToken } from "../lib/auth";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";

const router = Router();

router.post("/auth/register", async (req, res): Promise<void> => {
  const { name, email, phone, password, role, city } = req.body;

  if (!name || !email || !password || !role) {
    res.status(400).json({ error: "جميع الحقول المطلوبة يجب ملؤها" });
    return;
  }
  if (!["customer", "artisan"].includes(role)) {
    res.status(400).json({ error: "نوع الحساب غير صحيح" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
    return;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing.length > 0) {
    res.status(409).json({ error: "البريد الإلكتروني مسجل مسبقاً" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({
    name,
    email,
    phone: phone || null,
    passwordHash,
    role,
    status: "active",
  }).returning();

  let artisanProfile = null;
  if (role === "artisan") {
    const [profile] = await db.insert(artisanProfilesTable).values({
      userId: user.id,
      city: city || null,
      verificationStatus: "pending",
      completedJobs: 0,
      reviewsCount: 0,
    }).returning();
    artisanProfile = { ...profile, specialties: [] };
  }

  const token = signToken({ userId: user.id, role: user.role });
  const { passwordHash: _, ...safeUser } = user;

  res.status(201).json({
    token,
    user: {
      ...safeUser,
      artisanProfile,
    },
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "البريد الإلكتروني وكلمة المرور مطلوبان" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    return;
  }

  if (user.status === "suspended") {
    res.status(401).json({ error: "حسابك موقوف، يرجى التواصل مع الدعم" });
    return;
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    return;
  }

  let artisanProfile = null;
  if (user.role === "artisan") {
    const [profile] = await db
      .select()
      .from(artisanProfilesTable)
      .where(eq(artisanProfilesTable.userId, user.id));
    if (profile) {
      const specs = await db
        .select({ id: specialtiesTable.id, name: specialtiesTable.name })
        .from(artisanSpecialtiesTable)
        .innerJoin(specialtiesTable, eq(artisanSpecialtiesTable.specialtyId, specialtiesTable.id))
        .where(eq(artisanSpecialtiesTable.artisanId, profile.id));
      artisanProfile = { ...profile, specialties: specs };
    }
  }

  const token = signToken({ userId: user.id, role: user.role });
  const { passwordHash: _, ...safeUser } = user;

  res.json({
    token,
    user: {
      ...safeUser,
      artisanProfile,
    },
  });
});

router.get("/auth/me", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) {
    res.status(401).json({ error: "المستخدم غير موجود" });
    return;
  }

  let artisanProfile = null;
  if (user.role === "artisan") {
    const [profile] = await db
      .select()
      .from(artisanProfilesTable)
      .where(eq(artisanProfilesTable.userId, user.id));
    if (profile) {
      const specs = await db
        .select({ id: specialtiesTable.id, name: specialtiesTable.name })
        .from(artisanSpecialtiesTable)
        .innerJoin(specialtiesTable, eq(artisanSpecialtiesTable.specialtyId, specialtiesTable.id))
        .where(eq(artisanSpecialtiesTable.artisanId, profile.id));
      artisanProfile = { ...profile, specialties: specs };
    }
  }

  const { passwordHash: _, ...safeUser } = user;
  res.json({ ...safeUser, artisanProfile });
});

export default router;
