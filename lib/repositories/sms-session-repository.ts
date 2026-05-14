import { Prisma, SmsSessionStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

type Tx = Prisma.TransactionClient;

const ACTIVE_STATUSES: SmsSessionStatus[] = [
  SmsSessionStatus.pending,
  SmsSessionStatus.number_acquired,
  SmsSessionStatus.waiting_sms,
  SmsSessionStatus.code_received
];

export const smsSessionRepository = {
  async createPending(
    data: {
      activationCodeId: string;
      providerName: string;
      timeoutAt: Date;
      userIp: string;
      metadata?: Prisma.InputJsonValue;
    },
    tx: Tx
  ) {
    return tx.smsSession.create({
      data: {
        activationCodeId: data.activationCodeId,
        providerName: data.providerName,
        status: SmsSessionStatus.pending,
        timeoutAt: data.timeoutAt,
        userIp: data.userIp,
        metadata: data.metadata
      }
    });
  },

  async findActiveByActivationCodeId(activationCodeId: string, tx?: Tx) {
    const db = tx ?? prisma;
    return db.smsSession.findFirst({
      where: {
        activationCodeId,
        status: { in: ACTIVE_STATUSES }
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async updateAcquired(
    sessionId: string,
    input: { activationId: string; phoneNumber: string; raw: unknown; isNumberChange?: boolean },
    tx?: Tx
  ) {
    const db = tx ?? prisma;
    const now = new Date();
    return db.smsSession.update({
      where: { id: sessionId },
      data: {
        providerActivationId: input.activationId,
        phoneNumber: input.phoneNumber,
        status: SmsSessionStatus.waiting_sms,
        startedAt: input.isNumberChange ? undefined : now,
        numberAcquiredAt: now,
        numberChangeCount: input.isNumberChange ? { increment: 1 } : undefined,
        manualRefreshCount: 0,
        failureReason: null,
        verificationCode: null,
        verificationText: null,
        completedAt: null,
        cancelledAt: null,
        metadata: input.raw as Prisma.InputJsonValue
      }
    });
  },

  async updateFailed(sessionId: string, reason: string, raw?: unknown, tx?: Tx) {
    const db = tx ?? prisma;
    return db.smsSession.update({
      where: { id: sessionId },
      data: {
        status: SmsSessionStatus.failed,
        failureReason: reason,
        metadata: raw as Prisma.InputJsonValue
      }
    });
  },

  async findById(sessionId: string) {
    return prisma.smsSession.findUnique({
      where: { id: sessionId },
      include: {
        activationCode: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 5
        }
      }
    });
  },

  async findByProviderActivationId(providerActivationId: string) {
    return prisma.smsSession.findUnique({
      where: { providerActivationId },
      include: {
        activationCode: true
      }
    });
  },

  async markCodeReceived(
    sessionId: string,
    verificationCode: string | null,
    text: string | null,
    raw?: unknown,
    tx?: Tx
  ) {
    const db = tx ?? prisma;
    return db.smsSession.update({
      where: { id: sessionId },
      data: {
        status: SmsSessionStatus.code_received,
        verificationCode,
        verificationText: text,
        metadata: raw as Prisma.InputJsonValue
      }
    });
  },

  async markTimeout(sessionId: string, reason = "SESSION_TIMEOUT", tx?: Tx) {
    const db = tx ?? prisma;
    return db.smsSession.update({
      where: { id: sessionId },
      data: {
        status: SmsSessionStatus.timeout,
        completedAt: new Date(),
        failureReason: reason
      }
    });
  },

  async markCancelled(sessionId: string, reason = "CANCELLED", tx?: Tx) {
    const db = tx ?? prisma;
    return db.smsSession.update({
      where: { id: sessionId },
      data: {
        status: SmsSessionStatus.cancelled,
        cancelledAt: new Date(),
        failureReason: reason
      }
    });
  },

  async touchPoll(sessionId: string) {
    return prisma.smsSession.update({
      where: { id: sessionId },
      data: {
        lastPolledAt: new Date(),
        pollAttempts: { increment: 1 }
      }
    });
  },

  async incrementManualRefreshCount(sessionId: string, tx?: Tx) {
    const db = tx ?? prisma;
    return db.smsSession.update({
      where: { id: sessionId },
      data: {
        manualRefreshCount: { increment: 1 },
        lastPolledAt: new Date(),
        pollAttempts: { increment: 1 }
      }
    });
  },

  async listPaged(params: {
    page: number;
    pageSize: number;
    query?: string;
    status?: SmsSessionStatus;
  }) {
    const where: Prisma.SmsSessionWhereInput = {
      ...(params.query
        ? {
            OR: [
              { id: { contains: params.query, mode: "insensitive" } },
              { phoneNumber: { contains: params.query, mode: "insensitive" } },
              { providerActivationId: { contains: params.query, mode: "insensitive" } },
              {
                activationCode: {
                  code: { contains: params.query, mode: "insensitive" }
                }
              }
            ]
          }
        : {}),
      ...(params.status ? { status: params.status } : {})
    };

    const [items, total] = await prisma.$transaction([
      prisma.smsSession.findMany({
        where,
        include: { activationCode: true },
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize
      }),
      prisma.smsSession.count({ where })
    ]);

    return {
      items,
      total,
      page: params.page,
      pageSize: params.pageSize
    };
  }
};
