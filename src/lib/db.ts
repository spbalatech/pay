import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/** Every agent action goes through here. The audit trail is a product feature, not debug logging. */
export async function audit(
  actor: string,
  action: string,
  targetType: string,
  targetId: string,
  payload: unknown = {},
) {
  await db.auditLog.create({
    data: { actor, action, targetType, targetId, payload: payload as object },
  });
}
