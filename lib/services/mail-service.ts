import { env } from "@/lib/core/env";
import { logger } from "@/lib/core/logger";

type MailAttachment = {
  filename: string;
  content: string;
  contentType?: string;
};

type SendMailInput = {
  subject: string;
  text: string;
  to?: string;
  attachments?: MailAttachment[];
};

function canSendMail(to?: string) {
  return (
    env.MAIL_ENABLED &&
    !!env.MAIL_SMTP_HOST &&
    !!env.MAIL_SMTP_USER &&
    !!env.MAIL_SMTP_PASS &&
    !!env.MAIL_FROM &&
    !!(to ?? env.MAIL_TO)
  );
}

export const mailService = {
  async send(input: SendMailInput) {
    if (!canSendMail(input.to)) {
      logger.warn("Mail skipped because SMTP config is incomplete or disabled", {
        enabled: env.MAIL_ENABLED
      });
      return false;
    }

    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: env.MAIL_SMTP_HOST,
        port: env.MAIL_SMTP_PORT,
        secure: env.MAIL_SMTP_SECURE,
        auth: {
          user: env.MAIL_SMTP_USER,
          pass: env.MAIL_SMTP_PASS
        }
      });

      await transporter.sendMail({
        from: env.MAIL_FROM,
        to: input.to ?? env.MAIL_TO,
        subject: input.subject,
        text: input.text,
        attachments: input.attachments?.map((item) => ({
          filename: item.filename,
          content: item.content,
          contentType: item.contentType ?? "text/plain; charset=utf-8"
        }))
      });
      return true;
    } catch (error) {
      logger.error("Failed to send mail", {
        error: error instanceof Error ? error.message : String(error),
        subject: input.subject
      });
      return false;
    }
  }
};
