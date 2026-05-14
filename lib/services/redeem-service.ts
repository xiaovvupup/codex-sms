import { Prisma, ActivationCodeStatus, SmsSessionStatus } from "@prisma/client";
import { env } from "@/lib/core/env";
import { AppError } from "@/lib/core/errors";
import { normalizeActivationCode } from "@/lib/core/utils";
import { prisma } from "@/lib/db/prisma";
import { activationCodeRepository } from "@/lib/repositories/activation-code-repository";
import { smsSessionRepository } from "@/lib/repositories/sms-session-repository";
import { auditLogRepository } from "@/lib/repositories/audit-log-repository";
import { activationCodeFileService } from "@/lib/services/activation-code-file-service";
import { smsProvider } from "@/lib/sms/provider-registry";

export const redeemService = {
  async redeemCode(rawCode: string, userIp: string) {
    const activationCode = normalizeActivationCode(rawCode);
    if (!activationCode) {
      throw new AppError("激活码格式错误，应为 12 位字母数字组合（如 DK42BCPDPPRL）", "INVALID_ACTIVATION_CODE", 422);
    }

    const now = new Date();
    const timeoutAt = new Date(now.getTime() + env.SESSION_TIMEOUT_SECONDS * 1000);
    let payload: {
      resumed: boolean;
      session: {
        id: string;
        status: SmsSessionStatus;
        timeoutAt: Date;
      };
    };

    try {
      payload = await prisma.$transaction(
        async (tx) => {
        const code = await activationCodeRepository.findByCode(activationCode, tx);
        if (!code) {
          throw new AppError("激活码不存在", "CODE_NOT_FOUND", 404);
        }
        if (code.status === ActivationCodeStatus.disabled) {
          throw new AppError("激活码已禁用", "CODE_DISABLED", 403);
        }
        if (code.status === ActivationCodeStatus.used) {
          throw new AppError("激活码已失效", "CODE_ALREADY_USED", 409);
        }
        if (code.expiresAt && code.expiresAt <= now) {
          await tx.activationCode.update({
            where: { id: code.id },
            data: { status: ActivationCodeStatus.expired }
          });
          throw new AppError("激活码已过期", "CODE_EXPIRED", 410);
        }

        if (code.status === ActivationCodeStatus.reserved) {
          const activeSession = await smsSessionRepository.findActiveByActivationCodeId(code.id, tx);
          if (activeSession) {
            if (activeSession.timeoutAt <= now) {
              await smsSessionRepository.markTimeout(
                activeSession.id,
                `等待短信超过 ${env.SESSION_TIMEOUT_SECONDS} 秒`,
                tx
              );
              await activationCodeRepository.revertReservedToUnused(code.id, tx);
            } else {
              return {
                resumed: true,
                session: activeSession
              };
            }
          }
        }

        if (code.status === ActivationCodeStatus.unused) {
          const reserved = await activationCodeRepository.reserveCode(code.code, userIp, tx);
          if (!reserved) {
            const latestCode = await activationCodeRepository.findByCode(code.code, tx);
            if (latestCode?.status === ActivationCodeStatus.reserved) {
              const activeSession = await smsSessionRepository.findActiveByActivationCodeId(code.id, tx);
              if (activeSession && activeSession.timeoutAt > now) {
                return {
                  resumed: true,
                  session: activeSession
                };
              }
            }
            throw new AppError("激活码正在处理中，请重试", "CODE_BUSY", 409);
          }
        } else if (code.status === ActivationCodeStatus.reserved) {
          await activationCodeRepository.markReservedById(code.id, userIp, tx);
        }

        const session = await smsSessionRepository.createPending(
          {
            activationCodeId: code.id,
            providerName: smsProvider.name,
            timeoutAt,
            userIp
          },
          tx
        );

        return {
          resumed: false,
          session
        };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (error instanceof AppError && error.code === "CODE_EXPIRED") {
        await activationCodeFileService.syncTxtSnapshot();
      }
      throw error;
    }

    await auditLogRepository.write({
      actorType: "user",
      action: payload.resumed ? "REDEEM_RESUME_SESSION" : "REDEEM_VALIDATE_SUCCESS",
      entityType: "sms_session",
      entityId: payload.session.id,
      metadata: {
        activationCode,
        status: payload.session.status
      }
    });

    return {
      sessionId: payload.session.id,
      status: payload.session.status,
      timeoutAt: payload.session.timeoutAt,
      resumed: payload.resumed,
      shouldStartReceiving: payload.session.status === SmsSessionStatus.pending
    };
  }
};
