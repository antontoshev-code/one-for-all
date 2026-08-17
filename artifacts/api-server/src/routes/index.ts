import { Router, type IRouter } from "express";
import healthRouter from "./health";
import entriesRouter from "./entries";
import peopleRouter from "./people";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(entriesRouter);
router.use(peopleRouter);
router.use(aiRouter);

export default router;
