import { env } from "@/lib/core/env";
import { smsProvider } from "@/lib/sms/provider-registry";

async function fetchText(url: string) {
  const response = await fetch(url);
  return (await response.text()).trim();
}

async function fetchJson(url: string) {
  const text = await fetchText(url);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function main() {
  const [countries, prices] = await Promise.all([
    fetchJson("https://5sim.net/v1/guest/countries"),
    fetchJson(
      `https://5sim.net/v1/guest/prices?country=${encodeURIComponent(env.SMS_COUNTRY_NAME)}&product=${encodeURIComponent(env.SMS_PRODUCT_CODE)}`
    )
  ]);

  const countryInfo = (countries as Record<string, { prefix?: Record<string, number> }>)[env.SMS_COUNTRY_NAME];
  const priceInfo =
    (prices as Record<string, Record<string, Record<string, { cost?: number; count?: number }>>>)[env.SMS_COUNTRY_NAME]?.[
      env.SMS_PRODUCT_CODE
    ] ?? prices;

  const hasToken = !!env.SMS_API_KEY && env.SMS_API_KEY !== "DUMMY_SMS_API_KEY";

  console.log(
    JSON.stringify(
      {
        provider: smsProvider.name,
        hasToken,
        targetCountry: env.SMS_COUNTRY_NAME,
        targetCountryLabel: env.SMS_COUNTRY_LABEL,
        targetCountryPrefix: env.SMS_COUNTRY_PREFIX,
        publicPrefixes: Object.keys(countryInfo?.prefix ?? {}),
        product: env.SMS_PRODUCT_CODE,
        productAvailability: priceInfo
      },
      null,
      2
    )
  );

  if (!hasToken) {
    return;
  }

  const balance = await smsProvider.getBalance();
  console.log(
    JSON.stringify(
      {
        balance: balance.balance
      },
      null,
      2
    )
  );

  if (process.env.SMS_SMOKE_BUY === "1") {
    const order = await smsProvider.acquireNumber();
    console.log(
      JSON.stringify(
        {
          smokeBuy: true,
          activationId: order.activationId,
          phoneNumber: order.phoneNumber
        },
        null,
        2
      )
    );
    await smsProvider.cancelActivation(order.activationId);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
