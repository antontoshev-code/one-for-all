import { Router, type IRouter } from "express";
import healthRouter from "./health";
import entriesRouter from "./entries";
import peopleRouter from "./people";

const router: IRouter = Router();

router.use(healthRouter);
router.use(entriesRouter);
router.use(peopleRouter);

export default router;
