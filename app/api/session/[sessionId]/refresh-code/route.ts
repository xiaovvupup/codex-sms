import { randomUUID } from "crypto";
import { type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/core/api-response";
import { handleRouteError } from "@/lib/api/route-helpers";
import { checkRateLimit } from "@/lib/core/rate-limit";
import { env } from "@/lib/core/env";
import { getClientIp } from "@/lib/core/utils";
import { sessionService } from "@/lib/services/session-service";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: {
    params: { sessionId: string };
  }
) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    const ip = getClientIp(request.headers);
    const rateLimit = checkRateLimit(`session-refresh:${ip}`, env.SESSION_RATE_LIMIT, 60_000);
    if (!rateLimit.allowed) {
      return apiError(requestId, "请求过于频繁，请稍后重试", "RATE_LIMITED", 429);
    }

    const data = await sessionService.refreshCode(context.params.sessionId);
    return apiSuccess(requestId, data, "验证码已刷新");
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
