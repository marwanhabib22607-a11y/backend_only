import { Router } from "express";
import { db } from "@workspace/db";
import { specialtiesTable } from "@workspace/db";

const router = Router();

router.get("/specialties", async (_req, res): Promise<void> => {
  const specs = await db.select().from(specialtiesTable).orderBy(specialtiesTable.name);
  res.json(specs);
});

export default router;
