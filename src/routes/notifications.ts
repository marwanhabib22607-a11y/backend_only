import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";

const router = Router();

router.get("/notifications", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, req.userId!))
    .orderBy(notificationsTable.createdAt);
  res.json(notifications.reverse());
});

router.post("/notifications/:notificationId/read", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const notificationId = parseInt(Array.isArray(req.params.notificationId) ? req.params.notificationId[0] : req.params.notificationId, 10);

  const [updated] = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.id, notificationId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "الإشعار غير موجود" });
    return;
  }

  res.json(updated);
});

router.post("/notifications/read-all", authenticate, async (req: AuthRequest, res): Promise<void> => {
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.userId, req.userId!));
  res.json({ success: true, message: "تم تعليم جميع الإشعارات كمقروءة" });
});

export default router;
