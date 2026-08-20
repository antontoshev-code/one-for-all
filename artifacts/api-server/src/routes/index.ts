import { Router, type IRouter } from "express";
import healthRouter from "./health";
import vocabularyRouter from "./vocabulary";
import entriesRouter from "./entries";
import peopleRouter from "./people";
import aiRouter from "./ai";
import dataRouter from "./data";
import capturesRouter from "./captures";
import { requireAuth } from "../middlewares/require-auth";

const router: IRouter = Router();

// Health stays public so uptime checks work without a session.
router.use(healthRouter);

// Everything below reads or writes personal content and requires a session.
router.use(requireAuth);
router.use(entriesRouter);
router.use(peopleRouter);
router.use(aiRouter);
router.use(dataRouter);
router.use(vocabularyRouter);
router.use(capturesRouter);

export default router;
