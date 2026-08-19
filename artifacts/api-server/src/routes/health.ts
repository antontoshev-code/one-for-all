import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Replit's platform healthcheck probes `/api` itself, not `/api/healthz`.
 * Without this route it fell through to the error handler and answered 500 on
 * every probe — hundreds of "healthcheck failed" lines per deploy, and an
 * instance the platform believed was unhealthy while it was serving fine.
 */
router.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
