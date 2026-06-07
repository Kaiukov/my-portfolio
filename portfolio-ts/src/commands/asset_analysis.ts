import { analyzeAsset } from "../asset_analysis/analysis.js";
import type {
  AssetAnalysisData,
  AssetAnalysisOptions,
  AssetAnalysisProvider,
} from "../asset_analysis/types.js";

export interface AssetAnalysisCommandDeps {
  provider?: AssetAnalysisProvider;
}

export type AssetAnalysisCommandOptions = AssetAnalysisOptions;

export async function getAssetAnalysis(
  options: AssetAnalysisCommandOptions,
  deps: AssetAnalysisCommandDeps = {},
): Promise<AssetAnalysisData> {
  return analyzeAsset(options, deps.provider);
}
