import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import specialtiesRouter from "./specialties";
import artisansRouter from "./artisans";
import requestsRouter from "./requests";
import offersRouter from "./offers";
import jobsRouter from "./jobs";
import conversationsRouter from "./conversations";
import reviewsRouter from "./reviews";
import plansRouter from "./plans";
import notificationsRouter from "./notifications";
import dashboardRouter from "./dashboard";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(specialtiesRouter);
router.use(artisansRouter);
router.use(requestsRouter);
router.use(offersRouter);
router.use(jobsRouter);
router.use(conversationsRouter);
router.use(reviewsRouter);
router.use(plansRouter);
router.use(notificationsRouter);
router.use(dashboardRouter);
router.use(adminRouter);

export default router;
