import { Router } from "express";
import paymentRoutes from "./payment.routes.ts";

const router = Router();

router.use("/payments", paymentRoutes);

export default router;
