import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    // Credentials must be allowed or the session cookie is never sent.
    // A wildcard origin is invalid alongside credentials, so echo the caller.
    origin: (origin, cb) => cb(null, origin ?? true),
    credentials: true,
  }),
);

// Better Auth mounts before express.json(): it reads the raw request body
// itself, and a body-parser upstream consumes the stream first.
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Global error handler — always returns JSON, never the default HTML error page
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error", detail: message });
});

export default app;
