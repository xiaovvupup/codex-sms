import { env } from "@/lib/core/env";
import { AppError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { fetchWithTimeout } from "@/lib/core/timeout";
import type { AcquireResult, BalanceResult, SmsProvider, SmsStatusResult } from "@/lib/sms/provider";

class FiveSimClient implements SmsProvider {
  readonly name = "5sim";
  private readonly baseUrl = env.SMS_API_BASE_URL;
  private readonly apiKey = env.SMS_API_KEY;
  private readonly timeoutMs = env.SMS_TIMEOUT_MS;
  private readonly apiMode = env.SMS_API_MODE;

  private looksLikeJwtToken() {
    return this.apiKey.split(".").length === 3;
  }

  private useRestApi() {
    if (this.apiMode === "rest") return true;
    if (this.apiMode === "api1") return false;
    return this.looksLikeJwtToken() || this.baseUrl.includes("/v1");
  }

  private async requestApi1(action: string, params: Record<string, string | number | boolean | undefined>) {
    if (!this.apiKey || this.apiKey === "DUMMY_SMS_API_KEY") {
      throw new AppError("SMS_API_KEY 未配置", "SMS_CONFIG_MISSING", 500);
    }

    const url = new URL(this.baseUrl);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("action", action);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json,text/plain,*/*"
        }
      },
      this.timeoutMs
    );

    const rawText = (await response.text()).trim();
    let payload: unknown = rawText;
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = rawText;
    }

    if (!response.ok) {
      throw new AppError("SMS 平台请求失败", "SMS_HTTP_ERROR", 502, {
        status: response.status,
        body: payload
      });
    }

    return payload;
  }

  private async requestRest(pathname: string, query?: Record<string, string | number | boolean | undefined>) {
    if (!this.apiKey || this.apiKey === "DUMMY_SMS_API_KEY") {
      throw new AppError("SMS_API_KEY 未配置", "SMS_CONFIG_MISSING", 500);
    }

    const url = new URL(`${this.baseUrl.replace(/\/+$/, "")}${pathname}`);
    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json"
        }
      },
      this.timeoutMs
    );

    const rawText = (await response.text()).trim();
    let payload: unknown = rawText;
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = rawText;
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AppError("5sim protocol 鉴权失败，请使用后台 Get API key 里的 5sim protocol token", "SMS_AUTH_FAILED", 502, {
          status: response.status,
          body: payload
        });
      }
      throw new AppError("SMS 平台请求失败", "SMS_HTTP_ERROR", 502, {
        status: response.status,
        body: payload
      });
    }

    return payload;
  }

  async acquireNumber(): Promise<AcquireResult> {
    if (this.useRestApi()) {
      const payload = await this.requestRest(
        `/user/buy/activation/${env.SMS_COUNTRY_NAME}/${env.SMS_OPERATOR}/${env.SMS_PRODUCT_CODE}`,
        { maxPrice: env.SMS_MAX_PRICE }
      );

      if (payload && typeof payload === "object") {
        const order = payload as { id?: number | string; phone?: string };
        if (order.id && order.phone) {
          return { activationId: String(order.id), phoneNumber: order.phone, raw: payload };
        }
      }

      throw new AppError("SMS 平台返回格式异常", "SMS_INVALID_RESPONSE", 502, { payload });
    }

    const payload = await this.requestApi1("getNumber", {
      service: env.SMS_PRODUCT_CODE,
      forward: 0,
      operator: env.SMS_OPERATOR,
      country: env.SMS_COUNTRY_NAME
    });

    if (typeof payload === "string") {
      if (payload.startsWith("ACCESS_NUMBER:")) {
        const [, activationId, phoneNumber] = payload.split(":");
        if (activationId && phoneNumber) {
          return { activationId, phoneNumber, raw: payload };
        }
      }
      if (payload === "BAD_KEY") {
        throw new AppError("5sim API Key 无效，请检查当前 key 是否可用于 API1", "SMS_AUTH_FAILED", 502, { payload });
      }
      if (payload === "NO_NUMBERS") {
        throw new AppError("当前无可用号码，请稍后重试", "SMS_NUMBER_NOT_AVAILABLE", 503, { payload });
      }
      if (payload === "NO_BALANCE") {
        throw new AppError("5sim 余额不足", "SMS_NO_BALANCE", 503, { payload });
      }
      if (payload === "BAD_SERVICE") {
        throw new AppError("服务代码无效，请检查 SMS_PRODUCT_CODE", "SMS_BAD_SERVICE", 422, { payload });
      }
    }

    throw new AppError("SMS 平台返回格式异常", "SMS_INVALID_RESPONSE", 502, { payload });
  }

  async getBalance(): Promise<BalanceResult> {
    if (this.useRestApi()) {
      const payload = await this.requestRest("/user/profile");
      const balance = (payload as { balance?: string | number })?.balance;
      if (typeof balance === "number") {
        return { balance, raw: payload };
      }
      if (typeof balance === "string" && Number.isFinite(Number(balance))) {
        return { balance: Number(balance), raw: payload };
      }
      throw new AppError("SMS 平台余额返回格式异常", "SMS_INVALID_BALANCE_RESPONSE", 502, { payload });
    }

    const payload = await this.requestApi1("getBalance", {});

    if (typeof payload === "string") {
      if (payload === "BAD_KEY") {
        throw new AppError("5sim API Key 无效，请检查当前 key 是否可用于 API1", "SMS_AUTH_FAILED", 502, { payload });
      }
      const match = payload.match(/ACCESS_BALANCE:([0-9]+(?:\.[0-9]+)?)/);
      if (match) {
        return { balance: Number(match[1]), raw: payload };
      }
    }

    throw new AppError("SMS 平台余额返回格式异常", "SMS_INVALID_BALANCE_RESPONSE", 502, { payload });
  }

  async getStatus(activationId: string): Promise<SmsStatusResult> {
    if (this.useRestApi()) {
      const payload = await this.requestRest(`/user/check/${activationId}`);
      const order = payload as {
        status?: string;
        sms?: Array<{ code?: string | null; text?: string | null }>;
      };
      const latestSms = Array.isArray(order.sms) ? order.sms[order.sms.length - 1] : undefined;
      const status = String(order.status ?? "").toUpperCase();

      if (latestSms?.code || latestSms?.text) {
        return {
          kind: "received",
          code: latestSms.code ?? null,
          text: latestSms.text ?? null,
          raw: payload
        };
      }

      if (status === "PENDING" || status === "RECEIVED") {
        return { kind: "waiting", raw: payload };
      }
      if (status === "CANCELED") {
        return { kind: "cancelled", raw: payload };
      }
      return { kind: "failed", reason: status || "UNKNOWN_PROVIDER_STATUS", raw: payload };
    }

    const payload = await this.requestApi1("getStatus", { id: activationId });

    if (typeof payload === "string") {
      if (payload.startsWith("STATUS_OK")) {
        const code = payload.includes(":") ? payload.split(":").slice(1).join(":") : null;
        return { kind: "received", code, text: payload, raw: payload };
      }
      if (payload === "STATUS_WAIT_CODE" || payload === "STATUS_WAIT_RETRY" || payload === "STATUS_WAIT_RESEND") {
        return { kind: "waiting", raw: payload };
      }
      if (payload === "STATUS_CANCEL") {
        return { kind: "cancelled", raw: payload };
      }
      if (payload === "BAD_KEY") {
        return { kind: "failed", reason: "BAD_KEY", raw: payload };
      }
      return { kind: "failed", reason: payload, raw: payload };
    }

    throw new AppError("SMS 平台状态返回格式异常", "SMS_INVALID_STATUS_RESPONSE", 502, { payload });
  }

  async requestAnotherCode(activationId: string) {
    if (this.useRestApi()) {
      try {
        await this.requestRest(`/user/repeat/${activationId}`);
        return;
      } catch (error) {
        throw new AppError(
          error instanceof AppError ? error.message : "请求新验证码失败",
          "SMS_REFRESH_FAILED",
          502,
          error instanceof AppError ? error.details : undefined
        );
      }
    }

    const payload = await this.requestApi1("setStatus", {
      id: activationId,
      status: 3,
      forward: 0
    });

    if (typeof payload === "string" && (payload === "ACCESS_RETRY_GET" || payload === "ACCESS_READY")) {
      return;
    }
    if (typeof payload === "string" && payload === "BAD_KEY") {
      throw new AppError("5sim API Key 无效，请检查当前 key 是否可用于 API1", "SMS_AUTH_FAILED", 502, { payload });
    }
    throw new AppError("请求新验证码失败", "SMS_REFRESH_FAILED", 502, { payload });
  }

  async completeActivation(activationId: string) {
    try {
      if (this.useRestApi()) {
        await this.requestRest(`/user/finish/${activationId}`);
      } else {
        await this.requestApi1("setStatus", {
          id: activationId,
          status: 6,
          forward: 0
        });
      }
    } catch (error) {
      logger.warn("Failed to complete activation in provider", {
        activationId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async cancelActivation(activationId: string) {
    try {
      if (this.useRestApi()) {
        await this.requestRest(`/user/cancel/${activationId}`);
      } else {
        await this.requestApi1("setStatus", {
          id: activationId,
          status: -1,
          forward: 0
        });
      }
    } catch (error) {
      logger.warn("Failed to cancel activation in provider", {
        activationId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export const fiveSimClient = new FiveSimClient();
