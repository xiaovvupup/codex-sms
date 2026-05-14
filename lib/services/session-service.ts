import { Prisma, SmsSessionStatus } from "@prisma/client";
import { env } from "@/lib/core/env";
import { AppError } from "@/lib/core/errors";
import { extractVerificationCode } from "@/lib/core/utils";
import { prisma } from "@/lib/db/prisma";
import { smsSessionRepository } from "@/lib/repositories/sms-session-repository";
import { auditLogRepository } from "@/lib/repositories/audit-log-repository";
import { activationCodeRepository } from "@/lib/repositories/activation-code-repository";
import { activationCodeFileService } from "@/lib/services/activation-code-file-service";
import { smsProvider } from "@/lib/sms/provider-registry";
import { mailService } from "@/lib/services/mail-service";

const CLOSED_STATUSES = new Set<SmsSessionStatus>([
  SmsSessionStatus.timeout,
  SmsSessionStatus.failed,
  SmsSessionStatus.cancelled
]);

async function notifyPhoneAcquired(session: {
  id: string;
  activationCodeId: string;
  activationCode: { code: string };
  phoneNumber: string | null;
}) {
  if (!session.phoneNumber) {
    return;
  }
  await mailService.send({
    to: env.PHONE_NOTIFY_EMAIL,
    subject: `新手机号已获取：${session.phoneNumber}`,
    text: [
      "用户已获取新的验证码手机号。",
      "",
      `手机号：${session.phoneNumber}`,
      `国家：${env.SMS_COUNTRY_LABEL} ${env.SMS_COUNTRY_PREFIX}`,
      `会话 ID：${session.id}`,
      `激活码：${session.activationCode.code}`,
      `时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`
    ].join("\n")
  });
}

async function persistLatestSms(session: Awaited<ReturnType<typeof smsSessionRepository.findById>>, result: { code: string | null; text: string | null; raw: unknown }) {
  if (!session) {
    throw new AppError("会话不存在", "SESSION_NOT_FOUND", 404);
  }

  const code = extractVerificationCode(result.text, result.code);
  const text = result.text ?? "";
  const hasNewSms = !!text && (session.verificationText !== text || session.verificationCode !== code);
  const shouldMarkActivationUsed = session.activationCode.status !== "used";

  await prisma.$transaction(async (tx) => {
    if (hasNewSms) {
      await tx.smsMessage.create({
        data: {
          sessionId: session.id,
          text,
          code,
          rawPayload: result.raw as Prisma.InputJsonValue
        }
      });
    }

    await smsSessionRepository.markCodeReceived(session.id, code, text || session.verificationText || null, result.raw, tx);

    if (shouldMarkActivationUsed) {
      await activationCodeRepository.markUsed(session.activationCodeId, tx);
    }
  });

  await auditLogRepository.write({
    actorType: "system",
    action: "SESSION_CODE_RECEIVED",
    entityType: "sms_session",
    entityId: session.id,
    metadata: { code, manualRefreshCount: session.manualRefreshCount }
  });
  await activationCodeFileService.syncTxtSnapshot();
}

function sessionHasReceivedCode(session: {
  status: SmsSessionStatus;
  verificationCode: string | null;
  verificationText: string | null;
  messages?: Array<{ code: string | null; text: string }>;
}) {
  return (
    session.status === SmsSessionStatus.code_received ||
    !!session.verificationCode ||
    !!session.verificationText ||
    !!session.messages?.some((message) => !!message.code || !!message.text)
  );
}

export const sessionService = {
  async startReceiving(sessionId: string) {
    const session = await smsSessionRepository.findById(sessionId);
    if (!session) {
      throw new AppError("会话不存在", "SESSION_NOT_FOUND", 404);
    }
    if (session.status === SmsSessionStatus.code_received) {
      return this.getSessionDetail(sessionId, false);
    }
    if (session.timeoutAt <= new Date()) {
      await this.markTimeoutAndRelease(
        sessionId,
        session.providerActivationId,
        session.activationCodeId,
        `等待短信超过 ${env.SESSION_TIMEOUT_SECONDS} 秒`
      );
      throw new AppError("会话已超时，请重新输入激活码", "SESSION_TIMEOUT", 410);
    }
    if (
      (session.status === SmsSessionStatus.number_acquired || session.status === SmsSessionStatus.waiting_sms) &&
      session.phoneNumber &&
      session.providerActivationId
    ) {
      return this.getSessionDetail(sessionId, false);
    }
    if (session.status !== SmsSessionStatus.pending) {
      throw new AppError("当前会话状态不允许开始接码", "SESSION_INVALID_STATE", 409);
    }

    const acquire = await smsProvider.acquireNumber();
    const updated = await smsSessionRepository.updateAcquired(sessionId, {
      activationId: acquire.activationId,
      phoneNumber: acquire.phoneNumber,
      raw: acquire.raw,
      isNumberChange: false
    });
    const latest = await smsSessionRepository.findById(updated.id);
    if (latest) {
      await notifyPhoneAcquired(latest);
    }

    await auditLogRepository.write({
      actorType: "user",
      action: "SESSION_START_RECEIVING",
      entityType: "sms_session",
      entityId: sessionId,
      metadata: { phoneNumber: acquire.phoneNumber }
    });

    return this.getSessionDetail(sessionId, false);
  },

  async changeNumber(sessionId: string) {
    const session = await smsSessionRepository.findById(sessionId);
    if (!session) {
      throw new AppError("会话不存在", "SESSION_NOT_FOUND", 404);
    }
    if (session.timeoutAt <= new Date()) {
      await this.markTimeoutAndRelease(
        sessionId,
        session.providerActivationId,
        session.activationCodeId,
        `等待短信超过 ${env.SESSION_TIMEOUT_SECONDS} 秒`
      );
      throw new AppError("会话已超时，请重新输入激活码", "SESSION_TIMEOUT", 410);
    }
    if (!session.providerActivationId || !session.phoneNumber) {
      throw new AppError("尚未开始接收验证码", "SESSION_NOT_STARTED", 409);
    }
    if (CLOSED_STATUSES.has(session.status) || session.status === SmsSessionStatus.pending) {
      throw new AppError("当前会话状态不允许换号", "SESSION_INVALID_STATE", 409);
    }
    if (sessionHasReceivedCode(session)) {
      throw new AppError("已经收到验证码，当前号码不能再更换", "SESSION_CODE_ALREADY_RECEIVED", 409);
    }
    if (session.numberChangeCount >= env.MAX_NUMBER_CHANGES) {
      throw new AppError("已达到本次会话换号上限", "NUMBER_CHANGE_LIMIT_REACHED", 409);
    }

    const acquiredAt = session.numberAcquiredAt ?? session.startedAt ?? session.createdAt;
    const cooldownEnd = acquiredAt.getTime() + env.CHANGE_NUMBER_COOLDOWN_SECONDS * 1000;
    if (Date.now() < cooldownEnd) {
      const waitSeconds = Math.ceil((cooldownEnd - Date.now()) / 1000);
      throw new AppError(
        `换号还需等待 ${waitSeconds} 秒`,
        "NUMBER_CHANGE_COOLDOWN",
        409,
        { waitSeconds }
      );
    }

    const acquire = await smsProvider.acquireNumber();
    await smsProvider.cancelActivation(session.providerActivationId);
    const updated = await smsSessionRepository.updateAcquired(sessionId, {
      activationId: acquire.activationId,
      phoneNumber: acquire.phoneNumber,
      raw: acquire.raw,
      isNumberChange: true
    });
    const latest = await smsSessionRepository.findById(updated.id);
    if (latest) {
      await notifyPhoneAcquired(latest);
    }

    await auditLogRepository.write({
      actorType: "user",
      action: "SESSION_CHANGE_NUMBER",
      entityType: "sms_session",
      entityId: sessionId,
      metadata: { phoneNumber: acquire.phoneNumber }
    });

    return this.getSessionDetail(sessionId, false);
  },

  async getSessionDetail(sessionId: string, triggerPoll = true) {
    const session = await smsSessionRepository.findById(sessionId);
    if (!session) {
      throw new AppError("会话不存在", "SESSION_NOT_FOUND", 404);
    }

    let currentStatus = session.status;

    if (currentStatus !== SmsSessionStatus.code_received && !CLOSED_STATUSES.has(currentStatus) && session.timeoutAt <= new Date()) {
      await this.markTimeoutAndRelease(
        session.id,
        session.providerActivationId,
        session.activationCodeId,
        `等待短信超过 ${env.SESSION_TIMEOUT_SECONDS} 秒`
      );
      currentStatus = SmsSessionStatus.timeout;
    }

    if (
      triggerPoll &&
      session.providerActivationId &&
      !CLOSED_STATUSES.has(currentStatus) &&
      currentStatus !== SmsSessionStatus.code_received &&
      session.status !== SmsSessionStatus.pending &&
      session.timeoutAt > new Date()
    ) {
      await smsSessionRepository.touchPoll(session.id);
      const result = await smsProvider.getStatus(session.providerActivationId);

      if (result.kind === "received") {
        await persistLatestSms(session, result);
        currentStatus = SmsSessionStatus.code_received;
      } else if (result.kind === "cancelled") {
        await this.markCancelledAndRelease(session.id, session.activationCodeId);
        currentStatus = SmsSessionStatus.cancelled;
      } else if (result.kind === "failed") {
        await this.markFailedAndRelease(session.id, result.reason, result.raw, session.activationCodeId);
        currentStatus = SmsSessionStatus.failed;
      }
    }

    const latest = await smsSessionRepository.findById(sessionId);
    if (!latest) {
      throw new AppError("会话不存在", "SESSION_NOT_FOUND", 404);
    }

    const acquiredAt = latest.numberAcquiredAt ?? latest.startedAt ?? latest.createdAt;
    const changeAvailableAt = new Date(acquiredAt.getTime() + env.CHANGE_NUMBER_COOLDOWN_SECONDS * 1000);
    const changeWaitSeconds = Math.max(0, Math.ceil((changeAvailableAt.getTime() - Date.now()) / 1000));
    const isSessionExpired = latest.timeoutAt <= new Date();
    const hasReceivedCode = sessionHasReceivedCode(latest);
    const canChangeNumber =
      !!latest.providerActivationId &&
      !!latest.phoneNumber &&
      !CLOSED_STATUSES.has(latest.status) &&
      !hasReceivedCode &&
      latest.status !== SmsSessionStatus.pending &&
      !isSessionExpired &&
      latest.numberChangeCount < env.MAX_NUMBER_CHANGES &&
      changeWaitSeconds === 0;
    const canRefreshCode =
      !!latest.providerActivationId &&
      !!latest.phoneNumber &&
      !CLOSED_STATUSES.has(latest.status) &&
      latest.status !== SmsSessionStatus.pending &&
      hasReceivedCode &&
      !isSessionExpired &&
      latest.manualRefreshCount < env.MAX_CODE_REFRESHES;

    return {
      sessionId: latest.id,
      activationCode: latest.activationCode.code,
      phoneNumber: latest.phoneNumber,
      status: latest.status,
      verificationCode: latest.verificationCode,
      verificationText: latest.verificationText,
      timeoutAt: latest.timeoutAt,
      pollAttempts: latest.pollAttempts,
      failureReason: latest.failureReason,
      providerActivationId: latest.providerActivationId,
      numberAcquiredAt: latest.numberAcquiredAt,
      numberChangeCount: latest.numberChangeCount,
      maxNumberChanges: env.MAX_NUMBER_CHANGES,
      manualRefreshCount: latest.manualRefreshCount,
      maxCodeRefreshes: env.MAX_CODE_REFRESHES,
      providerName: latest.providerName,
      phoneCountryLabel: env.SMS_COUNTRY_LABEL,
      phoneCountryPrefix: env.SMS_COUNTRY_PREFIX,
      changeNumberAvailableAt: changeAvailableAt,
      changeNumberWaitSeconds: changeWaitSeconds,
      canStartReceiving: latest.status === SmsSessionStatus.pending && !isSessionExpired,
      canChangeNumber,
      canRefreshCode,
      isExpired: isSessionExpired,
      messages: latest.messages.map((item) => ({
        id: item.id,
        text: item.text,
        code: item.code,
        receivedAt: item.receivedAt ?? item.createdAt
      })),
      createdAt: latest.createdAt,
      updatedAt: latest.updatedAt
    };
  },

  async handleIncomingWebhook(input: {
    activationId: string;
    text: string;
    code?: string | null;
    raw: unknown;
    receivedAt?: Date;
  }) {
    const session = await smsSessionRepository.findByProviderActivationId(input.activationId);
    if (!session) {
      throw new AppError("无法匹配到会话", "SESSION_NOT_FOUND", 404);
    }
    if (CLOSED_STATUSES.has(session.status)) {
      return { sessionId: session.id };
    }

    const latestSession = await smsSessionRepository.findById(session.id);
    await persistLatestSms(latestSession, {
      code: input.code ?? null,
      text: input.text,
      raw: input.raw
    });
    await auditLogRepository.write({
      actorType: "system",
      action: "WEBHOOK_SMS_RECEIVED",
      entityType: "sms_session",
      entityId: session.id
    });
    await activationCodeFileService.syncTxtSnapshot();

    return { sessionId: session.id };
  },

  async refreshCode(sessionId: string) {
    const session = await smsSessionRepository.findById(sessionId);
    if (!session) {
      throw new AppError("会话不存在", "SESSION_NOT_FOUND", 404);
    }
    if (!session.providerActivationId || !session.phoneNumber) {
      throw new AppError("尚未获取手机号", "SESSION_NOT_STARTED", 409);
    }
    if (CLOSED_STATUSES.has(session.status)) {
      throw new AppError("当前会话已结束，无法刷新验证码", "SESSION_CLOSED", 409);
    }
    if (session.timeoutAt <= new Date()) {
      throw new AppError("当前会话已过期，无法刷新验证码", "SESSION_EXPIRED", 410);
    }
    if (!sessionHasReceivedCode(session)) {
      throw new AppError("出现验证码后才能刷新验证码", "SESSION_CODE_NOT_RECEIVED", 409);
    }
    if (session.manualRefreshCount >= env.MAX_CODE_REFRESHES) {
      throw new AppError("已达到验证码刷新上限", "REFRESH_LIMIT_REACHED", 409);
    }

    await smsSessionRepository.incrementManualRefreshCount(session.id);
    await smsProvider.requestAnotherCode(session.providerActivationId);
    const result = await smsProvider.getStatus(session.providerActivationId);

    if (result.kind === "received") {
      const latestSession = await smsSessionRepository.findById(sessionId);
      await persistLatestSms(latestSession, result);
    } else if (result.kind === "cancelled") {
      await this.markCancelledAndRelease(session.id, session.activationCodeId);
    } else if (result.kind === "failed") {
      await this.markFailedAndRelease(session.id, result.reason, result.raw, session.activationCodeId);
    }

    return this.getSessionDetail(sessionId, false);
  },

  async markTimeoutAndRelease(
    sessionId: string,
    activationId?: string | null,
    activationCodeId?: string,
    reason = "SESSION_TIMEOUT"
  ) {
    await prisma.$transaction(async (tx) => {
      await smsSessionRepository.markTimeout(sessionId, reason, tx);
      if (activationCodeId) {
        await activationCodeRepository.revertReservedToUnused(activationCodeId, tx);
      }
    });
    if (activationId) {
      await smsProvider.cancelActivation(activationId);
    }
    await activationCodeFileService.syncTxtSnapshot();
  },

  async markFailedAndRelease(
    sessionId: string,
    reason: string,
    raw: unknown,
    activationCodeId: string
  ) {
    await prisma.$transaction(async (tx) => {
      await smsSessionRepository.updateFailed(sessionId, reason, raw, tx);
      await activationCodeRepository.revertReservedToUnused(activationCodeId, tx);
    });
    await activationCodeFileService.syncTxtSnapshot();
  },

  async markCancelledAndRelease(sessionId: string, activationCodeId: string) {
    await prisma.$transaction(async (tx) => {
      await smsSessionRepository.markCancelled(sessionId, "PROVIDER_CANCELLED", tx);
      await activationCodeRepository.revertReservedToUnused(activationCodeId, tx);
    });
    await activationCodeFileService.syncTxtSnapshot();
  }
};
