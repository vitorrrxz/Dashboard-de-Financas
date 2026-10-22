// FIN-120 — função serverless da Vercel: toda requisição a /api/* chega aqui (rewrite do vercel.json)
// e é atendida pelo mesmo app Express do desenvolvimento, sem `app.listen`.
import { app } from '../Backend/server.js';

export default app;
