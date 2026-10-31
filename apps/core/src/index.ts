import express, { type Request, type Response } from "express";
import type { HealthResponse } from "@odoo/shared";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  const health: HealthResponse = {
    ok: true,
    service: "@odoo/core",
    timestamp: new Date().toISOString(),
  };
  res.json(health);
});

app.listen(port, () => {
  console.log(`[@odoo/core] listening on http://localhost:${port}`);
});
