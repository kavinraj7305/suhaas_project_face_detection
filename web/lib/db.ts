import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!global.__pgPool) {
    global.__pgPool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
  }

  return global.__pgPool;
}

export const db = {
  query: (text: string, params?: unknown[]) => getPool().query(text, params),
  connect: () => getPool().connect()
};
