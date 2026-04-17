import 'dotenv/config';
import http from 'http';
import app from './app.js';
import { connectDb } from './config/db.js';
import { initSocket } from './sockets/socketHub.js';

const PORT = process.env.PORT || 10000; // Render default

async function main() {
  await connectDb();

  const server = http.createServer(app);

  initSocket(server, {
    corsOrigin: process.env.CLIENT_ORIGIN || '*',
  });

  server.listen(PORT, () => {
    console.log(`🚀 CrisisSync backend running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('❌ Fatal startup error:', err);
  process.exit(1);
});