import { env } from "@/lib/core/env";
import { auditLogRepository } from "@/lib/repositories/audit-log-repository";
import { activationCodeRepository } from "@/lib/repositories/activation-code-repository";
import { adminService } from "@/lib/services/admin-service";
import { mailService } from "@/lib/services/mail-service";
import { smsProvider } from "@/lib/sms/provider-registry";

type LowBalanceAlertInput = {
  balance: number;
  threshold: number;
  source: "manual" | "daily";
};

async function sendLowBalanceAlert(input: LowBalanceAlertInput) {
  const text = [
    "短信平台余额告警",
    "",
    `当前余额：$${input.balance.toFixed(4)}`,
    `阈值：$${input.threshold.toFixed(2)}`,
    `触发来源：${input.source === "manual" ? "管理员手动查询" : "每日巡检"}`
  ].join("\n");

  const sent = await mailService.send({
    subject: `[告警] 短信平台余额不足（$${input.balance.toFixed(4)}）`,
    text
  });
  return sent;
}

export const opsService = {
  async checkSmsBalance(source: "manual" | "daily" = "manual", actorId?: string) {
    const { balance, raw } = await smsProvider.getBalance();
    const low = balance < env.LOW_BALANCE_THRESHOLD_USD;
    let mailSent = false;
    if (low) {
      mailSent = await sendLowBalanceAlert({
        balance,
        threshold: env.LOW_BALANCE_THRESHOLD_USD,
        source
      });
    }

    await auditLogRepository.write({
      actorType: source === "manual" ? "admin" : "system",
      actorId: actorId ?? null,
      action: "CHECK_SMS_BALANCE",
      entityType: "sms_provider",
      entityId: smsProvider.name,
      metadata: {
        provider: smsProvider.name,
        balance,
        threshold: env.LOW_BALANCE_THRESHOLD_USD,
        low,
        source,
        mailSent,
        raw
      }
    });

    return {
      balance,
      threshold: env.LOW_BALANCE_THRESHOLD_USD,
      low,
      mailSent
    };
  },

  async runDailyMaintenance() {
    const unusedBefore = await activationCodeRepository.countAvailableUnused();
    let generatedCount = 0;
    let generatedCodes: string[] = [];
    let generateTriggered = false;
    let generatedMailSent = false;

    if (unusedBefore < env.AUTO_GENERATE_UNUSED_THRESHOLD) {
      generateTriggered = true;
      const generated = await adminService.generateCodes({
        count: env.AUTO_GENERATE_BATCH_SIZE,
        note: "AUTO_DAILY_REPLENISH"
      });
      generatedCount = generated.insertedCount;
      generatedCodes = generated.codes;

      const content = generatedCodes.length > 0 ? `${generatedCodes.join("\n")}\n` : "";
      generatedMailSent = await mailService.send({
        subject: `[补码通知] 自动生成激活码 ${generatedCount} 个`,
        text: [
          "系统已执行每日库存巡检并自动补码。",
          "",
          `触发条件：unused 数量 < ${env.AUTO_GENERATE_UNUSED_THRESHOLD}`,
          `巡检前 unused：${unusedBefore}`,
          `本次生成：${generatedCount}`,
          "",
          "本次生成的激活码已作为 txt 附件发送。"
        ].join("\n"),
        attachments: [
          {
            filename: `activation-codes-${new Date().toISOString().slice(0, 10)}.txt`,
            content
          }
        ]
      });
    }

    const unusedAfter = await activationCodeRepository.countAvailableUnused();
    const balanceResult = await this.checkSmsBalance("daily");

    await auditLogRepository.write({
      actorType: "system",
      action: "DAILY_MAINTENANCE",
      entityType: "activation_code",
      entityId: "daily-maintenance",
      metadata: {
        threshold: env.AUTO_GENERATE_UNUSED_THRESHOLD,
        batchSize: env.AUTO_GENERATE_BATCH_SIZE,
        generateTriggered,
        generatedCount,
        generatedMailSent,
        unusedBefore,
        unusedAfter,
        balance: balanceResult.balance,
        lowBalance: balanceResult.low,
        lowBalanceMailSent: balanceResult.mailSent
      }
    });

    return {
      threshold: env.AUTO_GENERATE_UNUSED_THRESHOLD,
      batchSize: env.AUTO_GENERATE_BATCH_SIZE,
      generateTriggered,
      generatedCount,
      generatedMailSent,
      unusedBefore,
      unusedAfter,
      balance: balanceResult.balance,
      lowBalance: balanceResult.low,
      lowBalanceMailSent: balanceResult.mailSent
    };
  }
};
