import { Router, type IRouter } from "express";
import healthRouter from "./health";
import entriesRouter from "./entries";
import peopleRouter from "./people";
import aiRouter from "./ai";
import dataRouter from "./data";
import capturesRouter from "./captures";

const router: IRouter = Router();

router.use(healthRouter);
router.use(entriesRouter);
router.use(peopleRouter);
router.use(aiRouter);
router.use(dataRouter);
router.use(capturesRouter);

export default router;
