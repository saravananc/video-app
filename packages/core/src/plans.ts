/** Subscription tiers + top-up packs (FAV-1201). Prices in USD cents. */

export interface PlanDef {
  id: "free" | "starter" | "pro" | "scale";
  name: string;
  priceCents: number;
  /** Credits granted each billing cycle (FAV-1204 monthly reset). */
  monthlyCredits: number;
  maxResolution: "1080p" | "4k";
  tiers: Array<"basic" | "premium" | "max">;
}

export const PLANS: Record<PlanDef["id"], PlanDef> = {
  free: {
    id: "free",
    name: "Free",
    priceCents: 0,
    monthlyCredits: 0,
    maxResolution: "1080p",
    tiers: ["basic"]
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceCents: 1900,
    monthlyCredits: 300,
    maxResolution: "1080p",
    tiers: ["basic", "premium"]
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceCents: 4900,
    monthlyCredits: 1000,
    maxResolution: "4k",
    tiers: ["basic", "premium", "max"]
  },
  scale: {
    id: "scale",
    name: "Scale",
    priceCents: 14900,
    monthlyCredits: 3500,
    maxResolution: "4k",
    tiers: ["basic", "premium", "max"]
  }
};

/** One-time top-ups — credits never expire (FAV-1203). */
export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: "pack_small", name: "Small pack", credits: 100, priceCents: 900 },
  { id: "pack_medium", name: "Medium pack", credits: 550, priceCents: 3900 },
  { id: "pack_large", name: "Large pack", credits: 1500, priceCents: 9900 }
];

export function planById(id: string): PlanDef | undefined {
  return (PLANS as Record<string, PlanDef>)[id];
}

export function packById(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}
