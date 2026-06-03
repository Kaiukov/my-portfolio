import { query } from "../db.js";

export interface CurrencyExposureRow {
  currency: string;
  usd_value: number;
  pct: number;
  holdings_usd: number;
  cash_usd: number;
}

export interface CurrencyExposureResult {
  as_of_date: string;
  portfolio_value: number;
  rows: CurrencyExposureRow[];
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function str(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

export async function getCurrencyExposure(asOfDate?: string): Promise<CurrencyExposureResult> {
  const actualDate = asOfDate ?? new Date().toISOString().split("T")[0];

  const sql = `
    SELECT as_of_date, portfolio_value, currency, usd_value, pct, holdings_usd, cash_usd
    FROM portfolio_currency_exposure_sql($1)
  `;

  const rows = await query<Record<string, unknown>>(sql, [actualDate]);

  const exposureRows: CurrencyExposureRow[] = rows.map((r) => ({
    currency: str(r["currency"]),
    usd_value: num(r["usd_value"]),
    pct: num(r["pct"]),
    holdings_usd: num(r["holdings_usd"]),
    cash_usd: num(r["cash_usd"]),
  }));

  const portfolio_value =
    rows.length > 0 ? num(rows[0]["portfolio_value"]) : 0;

  return {
    as_of_date: str(rows.length > 0 ? rows[0]["as_of_date"] : actualDate),
    portfolio_value,
    rows: exposureRows,
  };
}
