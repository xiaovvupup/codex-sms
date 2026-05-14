import type { SmsProvider } from "@/lib/sms/provider";
import { fiveSimClient } from "@/lib/sms/5sim-client";

export const smsProvider: SmsProvider = fiveSimClient;
