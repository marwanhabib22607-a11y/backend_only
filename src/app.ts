import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

/**
 * CORS must be FIRST
 */
app.use(cors({
  origin: "https://lightgoldenrodyellow-quail-312536.hostingersite.com",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.options("*", cors());

/**
 * Body parsers
 */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

/**
 * Logging (keep early so you see failed requests too)
 */
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
  })
);

/**
 * Main API router (ONLY ONCE)
 */
app.use("/api", (req, res) => {
  res.json({ test: "new deploy works" });
});

export default app;

console.log("BACKEND NEW VERSION RUNNING");