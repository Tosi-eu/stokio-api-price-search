export type { PriceSearchResult } from "@stokio/sdk";

export interface PriceSourceStrategy {
  readonly sourceName: string;

  supports(itemType: "medicine" | "input"): boolean;

  fetchPrices(params: {
    itemName: string;
    dosage?: string;
    measurementUnit?: string;
  }): Promise<number[]>;
}
