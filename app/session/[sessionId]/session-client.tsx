"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type SessionPayload = {
  sessionId: string;
  activationCode: string;
  phoneNumber: string | null;
  status: string;
  verificationCode: string | null;
  verificationText: string | null;
  timeoutAt: string;
  failureReason: string | null;
  canStartReceiving: boolean;
  canChangeNumber: boolean;
  canRefreshCode: boolean;
  numberChangeCount: number;
  maxNumberChanges: number;
  manualRefreshCount: number;
  maxCodeRefreshes: number;
  changeNumberWaitSeconds: number;
  changeNumberAvailableAt: string;
  providerName: string;
  phoneCountryLabel: string;
  phoneCountryPrefix: string;
  isExpired: boolean;
};

const STATUS_TEXT: Record<string, string> = {
  pending: "待开始接码",
  number_acquired: "号码申请成功",
  waiting_sms: "等待短信中",
  code_received: "已收到验证码",
  timeout: "已超时",
  failed: "失败",
  cancelled: "已取消"
};

const FAILED_STATUSES = new Set(["timeout", "failed", "cancelled"]);

function getStatusVariant(status: string): "default" | "warning" | "danger" | "success" {
  if (status === "code_received") return "success";
  if (status === "timeout" || status === "failed" || status === "cancelled") return "danger";
  if (status === "waiting_sms" || status === "number_acquired") return "warning";
  return "default";
}

function secondsToClock(totalSeconds: number) {
  if (totalSeconds <= 0) return "00:00";
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatFailureReason(reason?: string | null) {
  if (!reason) return "短信接收失败，请稍后重试";
  if (reason === "SESSION_TIMEOUT") return "等待短信超时";
  return reason;
}

export function SessionClient({
  sessionId,
  initialResumed = false
}: {
  sessionId: string;
  initialResumed?: boolean;
}) {
  const router = useRouter();
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"start" | "change" | "refresh" | "retry" | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  async function loadSession() {
    const response = await fetch(`/api/session/${sessionId}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error(payload.message ?? "查询会话失败");
    }
    return payload.data as SessionPayload;
  }

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: NodeJS.Timeout | null = null;

    async function pull() {
      try {
        const data = await loadSession();
        if (!cancelled) {
          setSession(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "网络异常");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    pull();
    timer = setInterval(pull, 5000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [sessionId]);

  const remainingText = useMemo(() => {
    if (!session) return "--:--";
    const diff = new Date(session.timeoutAt).getTime() - now;
    if (diff <= 0) return "00:00";
    return secondsToClock(Math.floor(diff / 1000));
  }, [session, now]);

  const canShowWaiting = session && !session.canStartReceiving;
  const canCopyCode = !!session?.verificationCode;
  const isFailedSession = !!session && FAILED_STATUSES.has(session.status);

  async function copyText(value?: string | null) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setActionMessage("已复制到剪贴板");
  }

  async function handleStartReceiving() {
    setBusyAction("start");
    setError(null);
    setActionMessage(null);
    try {
      const response = await fetch(`/api/session/${sessionId}/start`, {
        method: "POST"
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "开始接码失败");
      }
      setSession(payload.data as SessionPayload);
      setActionMessage("已开始接收验证码");
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络异常");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleChangeNumber() {
    setBusyAction("change");
    setError(null);
    setActionMessage(null);
    try {
      const response = await fetch(`/api/session/${sessionId}/change-number`, {
        method: "POST"
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "换号失败");
      }
      setSession(payload.data as SessionPayload);
      setActionMessage("换号成功，已为你申请新号码");
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络异常");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRetryWithSameCode() {
    if (!session) return;
    setBusyAction("retry");
    setError(null);
    setActionMessage(null);
    try {
      const response = await fetch("/api/redeem-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activationCode: session.activationCode })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "重试失败");
      }
      const resumed = payload.data?.resumed ? "?resumed=1" : "";
      router.push(`/session/${payload.data.sessionId}${resumed}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络异常");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRefreshCode() {
    setBusyAction("refresh");
    setError(null);
    setActionMessage(null);
    try {
      const response = await fetch(`/api/session/${sessionId}/refresh-code`, {
        method: "POST"
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "刷新验证码失败");
      }
      setSession(payload.data as SessionPayload);
      setActionMessage("已刷新验证码状态");
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络异常");
    } finally {
      setBusyAction(null);
    }
  }

  if (loading) {
    return (
      <div className="container-shell">
        <Card className="fade-in-up">
          <CardContent className="flex items-center gap-2 p-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            会话初始化中...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="container-shell">
        <Card className="fade-in-up">
          <CardContent className="p-8 text-red-600">{error ?? "会话不存在"}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <main className="container-shell space-y-5">
      <Card className="fade-in-up">
        <CardHeader>
          <CardTitle className="text-3xl md:text-4xl">核销与接码</CardTitle>
          <CardDescription>按照下方步骤完成本次履约。</CardDescription>
        </CardHeader>
      </Card>

      <Card className="fade-in-up">
        <CardContent className="space-y-5 p-6">
          {!canShowWaiting ? (
            <>
              <div className="w-fit rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
                步骤 2
              </div>
              <h2 className="text-3xl font-bold md:text-4xl">激活码校验通过</h2>
              <p className="text-[15px] leading-7 text-muted-foreground">
                现在可以开始接码。只有真正收到验证码后，激活码才会失效。
              </p>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="surface-muted rounded-2xl p-4">
                  <p className="mb-1 text-xs text-muted-foreground">会话编号</p>
                  <p className="text-2xl font-bold md:text-3xl">{session.sessionId}</p>
                </div>
                <div className="surface-muted rounded-2xl p-4">
                  <p className="mb-1 text-xs text-muted-foreground">会话有效期</p>
                  <p className="text-2xl font-bold md:text-3xl">{new Date(session.timeoutAt).toLocaleString()}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Button className="h-14 text-xl" onClick={handleStartReceiving} disabled={busyAction !== null}>
                  {busyAction === "start" ? <Loader2 className="size-4 animate-spin" /> : "开始接收验证码"}
                </Button>
                <Link href="/" className="block">
                  <Button className="h-14 w-full text-xl" variant="outline">
                    重新输入激活码
                  </Button>
                </Link>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-700">
                {initialResumed
                  ? "已恢复到未完成的使用会话。"
                  : "激活码校验通过，点击上方按钮即可开始接码。"}
              </div>
            </>
          ) : isFailedSession ? (
            <>
              <div className="w-fit rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                失败
              </div>
              <h2 className="text-3xl font-bold md:text-4xl">本次尝试失败</h2>
              <p className="text-[15px] leading-7 text-muted-foreground">
                没关系，这不会让你的激活码失效。你可以稍后再次使用同一个激活码重新尝试。
              </p>

              <div className="rounded-2xl border border-red-200 bg-red-50/90 p-5">
                <p className="text-2xl font-bold text-foreground md:text-3xl">失败原因</p>
                <p className="mt-3 text-2xl text-muted-foreground md:text-3xl">{formatFailureReason(session.failureReason)}</p>
              </div>

              <Button className="h-14 text-xl" onClick={handleRetryWithSameCode} disabled={busyAction !== null}>
                {busyAction === "retry" ? <Loader2 className="size-4 animate-spin" /> : "使用同一激活码重试"}
              </Button>

              <div className="rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700">
                本次尝试失败，激活码仍可继续使用
              </div>
            </>
          ) : (
            <>
              <div className="w-fit rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
                步骤 3
              </div>
              <h2 className="text-3xl font-bold md:text-4xl">
                {session.status === "code_received" ? "验证码已收到" : "等待短信中"}
              </h2>
              <p className="text-[15px] leading-7 text-muted-foreground">
                复制下方号码，在目标页面选择 {session.phoneCountryLabel}（{session.phoneCountryPrefix}）后再粘贴提交。未显示验证码时，等待 90 秒后可以尝试换号。
              </p>

              <div className="surface-muted rounded-2xl p-4">
                <p className="mb-1 text-xs text-muted-foreground">
                  本次接码手机号（{session.phoneCountryLabel} {session.phoneCountryPrefix}）
                </p>
                <p className="text-4xl font-bold tracking-wide md:text-5xl">{session.phoneNumber ?? "--"}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => copyText(session.phoneNumber)}>
                    <Copy className="size-4" />
                    复制号码
                  </Button>
                  <Badge variant={getStatusVariant(session.status)}>{STATUS_TEXT[session.status] ?? session.status}</Badge>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="surface-muted rounded-2xl p-4">
                  <p className="text-xs text-muted-foreground">剩余等待时间</p>
                  <p className="text-4xl font-bold md:text-5xl">{remainingText}</p>
                </div>
                <div className="surface-muted rounded-2xl p-4">
                  <p className="text-xs text-muted-foreground">验证码</p>
                  <p className="text-4xl font-bold tracking-wider md:text-5xl">
                    {session.verificationCode ?? "等待中..."}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => copyText(session.verificationCode)}
                    disabled={!canCopyCode}
                  >
                    <Copy className="size-4" />
                    复制验证码
                  </Button>
                </div>
              </div>

              <div className="surface-muted rounded-2xl p-4 text-sm text-muted-foreground">
                <p>会话ID：{session.sessionId}</p>
                <p>等待截止时间：{new Date(session.timeoutAt).toLocaleString()}</p>
                <p>
                  换号次数：{session.numberChangeCount} / {session.maxNumberChanges}
                </p>
                <p>
                  刷新次数：{session.manualRefreshCount} / {session.maxCodeRefreshes}
                </p>
                {session.verificationText ? <p>短信正文：{session.verificationText}</p> : null}
                {session.failureReason ? <p className="text-red-600">失败原因：{session.failureReason}</p> : null}
              </div>

              <div className="space-y-2">
                <Button
                  className="h-12 w-full"
                  variant={session.canRefreshCode ? "outline" : "ghost"}
                  onClick={handleRefreshCode}
                  disabled={!session.canRefreshCode || busyAction !== null}
                >
                  {busyAction === "refresh"
                    ? <Loader2 className="size-4 animate-spin" />
                    : session.canRefreshCode
                      ? "刷新验证码"
                      : `刷新次数已用完（${session.manualRefreshCount}/${session.maxCodeRefreshes}）`}
                </Button>
                <Button
                  className="h-12 w-full"
                  variant={session.canChangeNumber ? "default" : "outline"}
                  onClick={handleChangeNumber}
                  disabled={!session.canChangeNumber || busyAction !== null}
                >
                  {busyAction === "change" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : session.status === "code_received" || session.verificationCode ? (
                    "已收到验证码，不能换号"
                  ) : session.canChangeNumber ? (
                    "换一个号码"
                  ) : (
                    `换号需等待 ${secondsToClock(session.changeNumberWaitSeconds)}`
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">
                  未显示验证码时，等待 90 秒后可更换手机号，单次会话最多换号 5 次；同一手机号支持手动刷新验证码 2 次。
                </p>
              </div>
            </>
          )}

          {actionMessage ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-700">
              {actionMessage}
            </div>
          ) : null}
          {error ? <div className="rounded-2xl bg-red-50/90 px-4 py-3 text-sm text-red-600">{error}</div> : null}
        </CardContent>
      </Card>
    </main>
  );
}
