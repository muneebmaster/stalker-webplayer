import "dotenv/config";
import express from "express";
import cors from "cors";
import portalRouter from "./routes/portal.js";
import proxyRouter from "./routes/proxy.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());

app.use(
  cors({
    origin: allowedOrigins,
    allowedHeaders: ["Content-Type", "X-Session-Id"],
  })
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", portalRouter);
app.use("/api/proxy", proxyRouter);

app.listen(port, () => {
  console.log(`Stalker portal proxy listening on http://localhost:${port}`);
});
