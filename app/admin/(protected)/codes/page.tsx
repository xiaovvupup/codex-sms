"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatActivationCodeInput } from "@/lib/core/utils";

type CodeItem = {
  id: string;
  code: string;
  status: string;
  usageCount: number;
  expiresAt: string | null;
  createdAt: string;
};

type CodeDetail = {
  id: string;
  code: string;
  status: string;
  usageCount: number;
  expiresAt: string | null;
  reservedAt: string | null;
  usedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SmsBalancePayload = {
  balance: number;
  threshold: number;
  low: boolean;
  mailSent: boolean;
};

export default function AdminCodesPage() {
  const [items, setItems] = useState<CodeItem[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(20);
  const [count, setCount] = useState(20);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [singleCode, setSingleCode] = useState("");
  const [checkingCode, setCheckingCode] = useState(false);
  const [invalidatingCode, setInvalidatingCode] = useState(false);
  const [restoringCode, setRestoringCode] = useState(false);
  const [codeDetail, setCodeDetail] = useState<CodeDetail | null>(null);
  const [codeActionMessage, setCodeActionMessage] = useState<string | null>(null);
  const [codeActionError, setCodeActionError] = useState<string | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const [balanceInfo, setBalanceInfo] = useState<SmsBalancePayload | null>(null);
  const [balanceMessage, setBalanceMessage] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function loadData() {
    setLoading(true);
    try {
      const search = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        status
      });
      if (query.trim()) search.set("query", query.trim());
      const response = await fetch(`/api/admin/codes?${search.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.success) {
        setItems(payload.data.items);
        setTotal(payload.data.total);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status]);

  async function generateCodes() {
    setCreating(true);
    try {
      const response = await fetch("/api/admin/codes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count })
      });
      const payload = await response.json();
      if (response.ok && payload.success) {
        await loadData();
      }
    } finally {
      setCreating(false);
    }
  }

  async function checkSingleCode() {
    if (!singleCode.trim()) {
      setCodeActionError("请输入激活码");
      return;
    }
    setCheckingCode(true);
    setCodeActionError(null);
    setCodeActionMessage(null);
    try {
      const response = await fetch("/api/admin/codes/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activationCode: singleCode })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        setCodeDetail(null);
        setCodeActionError(payload.message ?? "查询失败");
        return;
      }
      setCodeDetail(payload.data as CodeDetail);
      setCodeActionMessage("查询成功");
    } catch {
      setCodeDetail(null);
      setCodeActionError("网络异常，请重试");
    } finally {
      setCheckingCode(false);
    }
  }

  async function invalidateSingleCode() {
    if (!singleCode.trim()) {
      setCodeActionError("请输入激活码");
      return;
    }
    if (!confirm("确认将该激活码设为失效（disabled）吗？")) {
      return;
    }
    setInvalidatingCode(true);
    setCodeActionError(null);
    setCodeActionMessage(null);
    try {
      const response = await fetch("/api/admin/codes/invalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activationCode: singleCode })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        setCodeActionError(payload.message ?? "失效操作失败");
        return;
      }
      setCodeDetail(payload.data.detail as CodeDetail);
      setCodeActionMessage(payload.message ?? (payload.data.changed ? "激活码已设为失效" : "激活码状态无需变更"));
      await loadData();
    } catch {
      setCodeActionError("网络异常，请重试");
    } finally {
      setInvalidatingCode(false);
    }
  }

  async function restoreSingleCode() {
    if (!singleCode.trim()) {
      setCodeActionError("请输入激活码");
      return;
    }
    if (!confirm("确认将该激活码恢复为可用状态（unused）吗？")) {
      return;
    }
    setRestoringCode(true);
    setCodeActionError(null);
    setCodeActionMessage(null);
    try {
      const response = await fetch("/api/admin/codes/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activationCode: singleCode })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        setCodeActionError(payload.message ?? "恢复操作失败");
        return;
      }
      setCodeDetail(payload.data.detail as CodeDetail);
      setCodeActionMessage(payload.message ?? (payload.data.changed ? "激活码已恢复可用" : "激活码已是可用状态"));
      await loadData();
    } catch {
      setCodeActionError("网络异常，请重试");
    } finally {
      setRestoringCode(false);
    }
  }

  async function checkSmsBalance() {
    setCheckingBalance(true);
    setBalanceError(null);
    setBalanceMessage(null);
    try {
      const response = await fetch("/api/admin/sms/balance", {
        method: "GET",
        cache: "no-store"
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        setBalanceError(payload.message ?? "余额查询失败");
        return;
      }
      const data = payload.data as SmsBalancePayload;
      setBalanceInfo(data);
      if (data.low) {
        setBalanceMessage(data.mailSent ? "余额低于阈值，已发送邮件提醒" : "余额低于阈值，请尽快充值");
      } else {
        setBalanceMessage("余额充足");
      }
    } catch {
      setBalanceError("网络异常，请重试");
    } finally {
      setCheckingBalance(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>激活码管理</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
          <div className="mb-3">
            <h3 className="text-base font-semibold">短信平台余额监控</h3>
            <p className="text-sm text-muted-foreground">点击查询实时余额；低于阈值会触发告警（支持邮件）。</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={checkSmsBalance} disabled={checkingBalance}>
              {checkingBalance ? "查询中..." : "查询短信平台余额"}
            </Button>
            {balanceInfo ? (
              <div className={`rounded-full px-3 py-1 text-sm ${balanceInfo.low ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                当前余额：${balanceInfo.balance.toFixed(4)}（阈值：${balanceInfo.threshold.toFixed(2)}）
              </div>
            ) : null}
          </div>
          {balanceMessage ? <div className="mt-3 text-sm text-emerald-700">{balanceMessage}</div> : null}
          {balanceError ? <div className="mt-3 text-sm text-red-600">{balanceError}</div> : null}
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
          <div className="mb-3">
            <h3 className="text-base font-semibold">单码状态检查 / 状态调整</h3>
            <p className="text-sm text-muted-foreground">
              输入激活码后可立即查看状态，并可设为失效或恢复为可用状态。
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
            <Input
              placeholder="输入激活码（例如 DK42BCPDPPRL）"
              value={singleCode}
              onChange={(e) => setSingleCode(formatActivationCodeInput(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  checkSingleCode();
                }
              }}
            />
            <Button variant="outline" onClick={checkSingleCode} disabled={checkingCode || invalidatingCode || restoringCode}>
              {checkingCode ? "查询中..." : "检查状态"}
            </Button>
            <Button variant="outline" onClick={restoreSingleCode} disabled={restoringCode || checkingCode || invalidatingCode}>
              {restoringCode ? "处理中..." : "恢复可用"}
            </Button>
            <Button onClick={invalidateSingleCode} disabled={invalidatingCode || checkingCode || restoringCode}>
              {invalidatingCode ? "处理中..." : "设为失效"}
            </Button>
          </div>
          {codeDetail ? (
            <div className="mt-4 grid grid-cols-1 gap-2 rounded-xl border border-border/50 bg-background/70 p-3 text-sm md:grid-cols-2">
              <div>
                激活码：<span className="font-mono">{codeDetail.code}</span>
              </div>
              <div>
                状态：<Badge variant="outline">{codeDetail.status}</Badge>
              </div>
              <div>使用次数：{codeDetail.usageCount}</div>
              <div>过期时间：{codeDetail.expiresAt ? new Date(codeDetail.expiresAt).toLocaleString() : "-"}</div>
              <div>锁定时间：{codeDetail.reservedAt ? new Date(codeDetail.reservedAt).toLocaleString() : "-"}</div>
              <div>核销时间：{codeDetail.usedAt ? new Date(codeDetail.usedAt).toLocaleString() : "-"}</div>
            </div>
          ) : null}
          {codeActionMessage ? <div className="mt-3 text-sm text-emerald-700">{codeActionMessage}</div> : null}
          {codeActionError ? <div className="mt-3 text-sm text-red-600">{codeActionError}</div> : null}
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
          <Input
            placeholder="搜索激活码/备注"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                loadData();
              }
            }}
          />
          <select
            className="h-11 rounded-xl border border-border bg-background px-3 text-sm"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="all">全部状态</option>
            <option value="unused">unused</option>
            <option value="reserved">reserved</option>
            <option value="used">used</option>
            <option value="expired">expired</option>
            <option value="disabled">disabled</option>
          </select>
          <Input type="number" min={1} max={500} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          <Button onClick={generateCodes} disabled={creating}>
            {creating ? "生成中..." : "批量生成"}
          </Button>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => loadData()} disabled={loading}>
            {loading ? "刷新中..." : "刷新"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setPage(1);
              loadData();
            }}
          >
            查询
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>激活码</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>使用次数</TableHead>
              <TableHead>过期时间</TableHead>
              <TableHead>创建时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono">{item.code}</TableCell>
                <TableCell>
                  <Badge variant="outline">{item.status}</Badge>
                </TableCell>
                <TableCell>{item.usageCount}</TableCell>
                <TableCell>{item.expiresAt ? new Date(item.expiresAt).toLocaleString() : "-"}</TableCell>
                <TableCell>{new Date(item.createdAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  暂无数据
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            第 {page} / {totalPages} 页，共 {total} 条
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              上一页
            </Button>
            <Button
              variant="outline"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              下一页
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
