export type SmsStatusResult =
  | { kind: "waiting"; raw: unknown }
  | { kind: "received"; code: string | null; text: string | null; raw: unknown }
  | { kind: "cancelled"; raw: unknown }
  | { kind: "failed"; reason: string; raw: unknown };

export type AcquireResult = {
  activationId: string;
  phoneNumber: string;
  raw: unknown;
};

export type BalanceResult = {
  balance: number;
  raw: unknown;
};

export interface SmsProvider {
  readonly name: string;
  acquireNumber(): Promise<AcquireResult>;
  getBalance(): Promise<BalanceResult>;
  getStatus(activationId: string): Promise<SmsStatusResult>;
  requestAnotherCode(activationId: string): Promise<void>;
  completeActivation(activationId: string): Promise<void>;
  cancelActivation(activationId: string): Promise<void>;
}
