import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/core/env";
import { RedeemForm } from "./redeem-form";

export default function HomePage() {
  return (
    <main className="container-shell space-y-5">
      <Card className="fade-in-up overflow-hidden">
        <CardHeader className="space-y-5">
          <CardTitle className="text-4xl leading-tight md:text-6xl">
            输入激活码，获取 Codex 验证手机号。
          </CardTitle>
          <CardDescription className="max-w-5xl text-[15px] leading-7">
            本站不提供站内购买。请在这里完成核销、申请手机号并实时接收验证码。默认提供越南手机号，国际区号为 +84。激活码仅在第一次成功领取手机号后失效。
          </CardDescription>
          <div className="grid grid-cols-1 gap-2 text-sm text-muted-foreground md:grid-cols-2">
            <div className="surface-muted rounded-full px-4 py-2">当前服务：Codex 手机验证码校验</div>
            <div className="surface-muted rounded-full px-4 py-2">默认超时：{env.SESSION_TIMEOUT_SECONDS} 秒</div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
        <Card className="fade-in-up">
          <CardHeader>
            <CardTitle>核销与接码</CardTitle>
            <CardDescription>按下方步骤完成本次履约。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-5 w-fit rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
              步骤 1
            </div>
            <h3 className="mb-3 text-3xl font-bold md:text-4xl">输入激活码</h3>
            <p className="mb-7 text-[15px] leading-7 text-muted-foreground">
              校验通过后，系统会自动分配一个越南手机号（+84），并在接收短信后展示验证码。请在目标页面选择越南区号 +84 后再提交号码。
            </p>
            <RedeemForm />
          </CardContent>
        </Card>

        <Card className="fade-in-up">
          <CardHeader>
            <CardTitle>服务说明</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="surface-muted rounded-2xl p-4">
              <p className="mb-2 font-semibold text-foreground">你需要准备</p>
              <p>已收到激活码，并准备在目标页面填写越南手机号（+84）。</p>
            </div>
            <div className="surface-muted rounded-2xl p-4">
              <p className="mb-2 font-semibold text-foreground">激活码规则</p>
              <p>只有在第一次成功收到验证码后，激活码才会失效。失败不会失效。</p>
            </div>
            <div className="surface-muted rounded-2xl p-4">
              <p className="mb-2 font-semibold text-foreground">使用建议</p>
              <p>拿到手机号后尽快提交，页面中请选择越南区号 +84，避免等待超时。</p>
            </div>
            <div className="surface-muted rounded-2xl p-4">
              <p className="mb-2 font-semibold text-foreground">售后说明</p>
              <p>如页面异常，请携带支付凭证和激活码联系卖家处理。</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
