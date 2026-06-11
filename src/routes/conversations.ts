import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  usersTable,
  artisanProfilesTable,
  serviceRequestsTable,
  serviceRequestImagesTable,
} from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";

const router = Router();

router.get("/conversations", authenticate, async (req: AuthRequest, res): Promise<void> => {
  let convs;
  if (req.userRole === "artisan") {
    const [profile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.userId, req.userId!));
    if (!profile) {
      res.json([]);
      return;
    }
    convs = await db.select().from(conversationsTable).where(eq(conversationsTable.artisanId, profile.id));
  } else {
    convs = await db.select().from(conversationsTable).where(eq(conversationsTable.customerId, req.userId!));
  }

  const results = await Promise.all(convs.map(async (conv) => {
    const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, conv.customerId));
    const [artisanProfile] = await db.select().from(artisanProfilesTable).where(eq(artisanProfilesTable.id, conv.artisanId));
    const [artisanUser] = artisanProfile
      ? await db.select().from(usersTable).where(eq(usersTable.id, artisanProfile.userId))
      : [null];
    const [request] = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.id, conv.requestId));
    const [lastMsg] = await db.select().from(messagesTable)
      .where(eq(messagesTable.conversationId, conv.id))
      .orderBy(desc(messagesTable.createdAt))
      .limit(1);

    const { passwordHash: _c, ...safeCust } = customer || { passwordHash: "" };
    const { passwordHash: _a, ...safeArtUser } = artisanUser || { passwordHash: "" };

    let lastMsgObj = null;
    if (lastMsg) {
      const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, lastMsg.senderId));
      const { passwordHash: _s, ...safeSender } = sender || { passwordHash: "" };
      lastMsgObj = { ...lastMsg, sender: sender ? safeSender : null };
    }

    return {
      ...conv,
      customer: customer ? safeCust : null,
      artisan: artisanProfile ? { ...artisanProfile, user: artisanUser ? safeArtUser : null, specialties: [] } : null,
      request: request ? { ...request, images: [], customer: null, offersCount: 0 } : null,
      lastMessage: lastMsgObj,
    };
  }));

  res.json(results);
});

router.get("/conversations/:conversationId/messages", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const conversationId = parseInt(Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId, 10);

  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(messagesTable.createdAt);

  const results = await Promise.all(messages.map(async (msg) => {
    const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, msg.senderId));
    const { passwordHash: _, ...safeSender } = sender || { passwordHash: "" };
    return { ...msg, sender: sender ? safeSender : null };
  }));

  res.json(results);
});

router.post("/conversations/:conversationId/messages", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const conversationId = parseInt(Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId, 10);
  const { message } = req.body;

  if (!message) {
    res.status(400).json({ error: "الرسالة مطلوبة" });
    return;
  }

  const [newMsg] = await db.insert(messagesTable).values({
    conversationId,
    senderId: req.userId!,
    message,
  }).returning();

  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, newMsg.senderId));
  const { passwordHash: _, ...safeSender } = sender || { passwordHash: "" };

  res.status(201).json({ ...newMsg, sender: sender ? safeSender : null });
});

export default router;
