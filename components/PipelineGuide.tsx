"use client";

import { useState } from "react";
import type { Task, StageKey } from "@/lib/supabase";
import { STAGES } from "@/lib/supabase";
import { computeProgress } from "@/lib/progress";

type GuideEntry = {
  emoji: string;
  tagline: string;
  what: string;
  why: string;
  completion: string;
  inputs: string;
  outputs: string;
  tools: { name: string; url?: string }[];
};

const GUIDE: Record<StageKey, GuideEntry> = {
  data: {
    emoji: "🛰️",
    tagline: "Pull Sentinel-2 L2A monthly composites for the AOI.",
    what:
      "We query CDSE openEO for Sentinel-2 Level-2A scenes over the Rayong bounding box, then build a cloud-masked monthly median composite. Bands B02 / B03 / B04 / B08 stay at 10 m; B05–B07, B8A, B11, B12 are kept at their native 20 m and bilinearly upsampled later. SCL classes 3 / 8 / 9 / 10 (cloud-shadow, mid + high cloud, cirrus) are masked out before the temporal median.",
    why:
      "Monthly medians cut clouds and sensor noise without losing the seasonal signal that crop classifiers depend on. Working in reflectance keeps the spectra radiometrically comparable across months — important for indices like NDVI later.",
    completion:
      "One GeoTIFF per month written to `cache/s2_monthly/<aoi>/`. 'done' = cloud-free months successfully downloaded; 'total' = months requested (typically 12).",
    inputs: "Rayong AOI bbox · time window (yyyy-mm-dd → yyyy-mm-dd) · max cloud cover 85%",
    outputs: "GeoTIFFs · 10 m grid · 10 spectral bands × N months",
    tools: [
      { name: "CDSE openEO", url: "https://openeo.dataspace.copernicus.eu/" },
      { name: "rasterio + rioxarray", url: "https://corteva.github.io/rioxarray/" },
    ],
  },
  sr: {
    emoji: "🔬",
    tagline: "Super-resolve 10 m → 2.5 m with the OpenSR latent diffusion model.",
    what:
      "Each monthly composite is run through `opensr_model.SRLatentDiffusion`. The model takes 4-channel inputs (B02 / B03 / B04 / B08), denoises in latent space, and outputs a 4× upsampled reflectance image. 20 m bands are bilinearly upsampled afterward because the SR model wasn't trained on them — running them through would add noise.",
    why:
      "10 m pixels alias narrow fields (typical Rayong plot widths are 5–15 m). 2.5 m gives Random Forest features something to grip on, especially for narrow rubber rows, bunds, and orchard headlands.",
    completion:
      "One SR GeoTIFF per month in `cache/s2_sr/<aoi>/`. 'done' = SR tiles successfully persisted on disk; 'total' = same as the Data stage.",
    inputs: "Monthly composites · 10 m · B02 / B03 / B04 / B08",
    outputs: "SR GeoTIFFs · 2.5 m · same band order",
    tools: [
      { name: "opensr-model", url: "https://github.com/ESAOpenSR/opensr-model" },
      { name: "OmegaConf config loader", url: "https://omegaconf.readthedocs.io/" },
    ],
  },
  gen: {
    emoji: "✨",
    tagline: "Synthesize minority-class patches to balance the training set.",
    what:
      "Some Rayong crop classes have <1 % of pixels (specific orchards, palm-under-cover). Plain oversampling just duplicates noise, so we try two generative paths: (a) inject LoRA adapters into the OpenSR UNet and fine-tune per minority class on real SR patches, (b) sample from DiffusionSat with class conditioning. FID against a held-out real-class set is the sanity check.",
    why:
      "Class imbalance is the #1 failure mode for landuse Random Forest. Generative augmentation feeds the classifier realistic synthetic minority pixels without distorting the spectral distribution the way SMOTE does.",
    completion:
      "LoRA adapter (~10 MB) + ~200 synthetic patches per minority class. 'done' = minority classes with a trained adapter and a viable FID; 'total' = `len(CFG.minority_classes)`.",
    inputs: "SR patches of each minority class · ~200 real patches per class",
    outputs: "LoRA weights · synthetic 2.5 m patches · per-class FID report",
    tools: [
      { name: "peft (LoRA)", url: "https://huggingface.co/docs/peft/" },
      { name: "DiffusionSat", url: "https://github.com/samar-khanna/DiffusionSat" },
    ],
  },
  feat: {
    emoji: "🧮",
    tagline: "Extract per-pixel features from SR + landuse labels.",
    what:
      "Rasterize the LDD landuse shapefile onto the SR grid to get a per-pixel `LU_CODE`. For every labeled pixel we compute monthly temporal statistics (mean / std / min / max per band), vegetation indices (NDVI, NDWI, EVI), and GLCM + LBP texture descriptors from a small neighborhood window.",
    why:
      "Crop classes separate poorly on raw bands but well on temporal + texture features. Including phenology across months lets Random Forest tell rubber from cassava without an explicit time-series model.",
    completion:
      "A `pixel_table.parquet` file with one row per training pixel. 'done' = rows written (rounded to thousands); 'total' = target pixel budget.",
    inputs: "SR stack · LDD landuse shapefile · `LU_CODE` column",
    outputs: "pixel_table.parquet · ~40 features per pixel",
    tools: [
      { name: "rasterio.features.rasterize", url: "https://rasterio.readthedocs.io/en/stable/topics/features.html" },
      { name: "scikit-image (GLCM, LBP)", url: "https://scikit-image.org/" },
    ],
  },
  rf: {
    emoji: "🌳",
    tagline: "Train a Random Forest cascade per-pixel.",
    what:
      "Stage-1 Random Forest classifies every pixel into one of the `LU_CODE` classes. A second-stage RF is trained on the minority cohort only; pixels where stage-1 confidence < 0.6 — or where stage-1 picks a dominant class but the feature vector is close to a minority centroid — are routed to stage-2 for a sharper decision.",
    why:
      "A single RF tends to drop borderline minority pixels into dominant classes. The cascade preserves minority recall without sacrificing dominant-class precision, and is faster to retrain than swapping in a deep model.",
    completion:
      "Stage-1 + stage-2 models dumped as joblib pickles. 'done' = 1 per model trained + persisted; 'total' = 2.",
    inputs: "pixel_table.parquet · train / val split (stratified by class)",
    outputs: "rf_stage1.joblib · rf_stage2_minor.joblib · confusion matrix · feature importance plot",
    tools: [
      { name: "scikit-learn RandomForestClassifier", url: "https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.RandomForestClassifier.html" },
      { name: "imbalanced-learn", url: "https://imbalanced-learn.org/" },
    ],
  },
};

export function PipelineGuide({ tasks }: { tasks: Task[] }) {
  const [active, setActive] = useState<StageKey>("data");

  const stageStats = STAGES.map(s => {
    const sub = tasks.filter(t => t.stage === s.key);
    const stats = computeProgress(sub);
    return { stage: s, pct: stats.weightedPct, done: stats.done, total: stats.total };
  });

  const activeIdx = STAGES.findIndex(s => s.key === active);
  const activeStage = STAGES[activeIdx];
  const g = GUIDE[active];

  return (
    <section className="rounded-xl2 bg-surface border border-border shadow-card overflow-hidden">
      <div className="px-6 pt-5 pb-3 border-b border-border">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted2 font-medium">Pipeline guide</div>
            <h2 className="text-lg font-semibold text-ink mt-0.5">How crops get classified, stage by stage</h2>
            <p className="text-xs text-muted mt-1 max-w-2xl">
              Click a stage to read what happens in it, why it matters, and what &ldquo;done&rdquo; looks like for the team board. Progress numbers reflect the current state of all member cards.
            </p>
          </div>
          <a
            href="https://github.com/EarthWittawat/rayong-tracker/blob/main/notebooks/pipeline.ipynb"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] eyebrow inline-flex items-center gap-1 px-2.5 py-1 rounded border border-border text-muted hover:text-ink hover:bg-surface2 transition-colors"
            title="Open the pipeline notebook on GitHub"
          >
            Notebook
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17l10-10M17 7H7v10" /></svg>
          </a>
        </div>
      </div>

      {/* stepper */}
      <div className="px-6 pt-4 pb-3 overflow-x-auto">
        <div className="flex items-stretch gap-2 min-w-max">
          {stageStats.map(({ stage, pct }, i) => {
            const isActive = stage.key === active;
            const guide = GUIDE[stage.key];
            return (
              <div key={stage.key} className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => setActive(stage.key)}
                  className={`flex flex-col items-start gap-1.5 px-3 py-2.5 rounded-md border min-w-[140px] text-left transition-all ${isActive ? "border-accent bg-accent/5 shadow-card" : "border-border bg-surface hover:bg-surface2"}`}
                  aria-pressed={isActive}
                >
                  <div className="flex items-center gap-2 w-full">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold tabular bg-surface2 text-muted border border-border">{i + 1}</span>
                    <span className="text-base">{guide.emoji}</span>
                    <span className="ml-auto text-[10px] tabular text-muted2">{pct.toFixed(0)}%</span>
                  </div>
                  <span className="text-sm font-semibold text-ink leading-tight">{stage.short}</span>
                  <span className="text-[10px] text-muted2 leading-tight">{stage.label}</span>
                  <div className="h-1 w-full rounded-full bg-surface2 overflow-hidden mt-1">
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </button>
                {i < stageStats.length - 1 && (
                  <div className="self-center text-muted2 text-lg select-none" aria-hidden>→</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* detail */}
      <div className="px-6 pb-6 pt-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="md:col-span-2 space-y-4">
            <div>
              <div className="text-[10px] eyebrow text-muted2">Stage {activeIdx + 1} of {STAGES.length} · {activeStage.short}</div>
              <h3 className="text-xl font-semibold text-ink mt-0.5 flex items-center gap-2">
                <span className="text-2xl" aria-hidden>{g.emoji}</span>
                {activeStage.label}
              </h3>
              <p className="text-sm text-muted italic mt-1">{g.tagline}</p>
            </div>

            <Block label="What happens" body={g.what} />
            <Block label="Why it matters" body={g.why} />
            <Block label="Done means" body={g.completion} accent />
          </div>

          <div className="space-y-3">
            <SideBlock label="Inputs" body={g.inputs} />
            <SideBlock label="Outputs" body={g.outputs} />
            <div className="rounded-md border border-border bg-surface2/40 px-3 py-2">
              <div className="text-[10px] eyebrow text-muted2 mb-1.5">Tools</div>
              <ul className="space-y-1">
                {g.tools.map(t => (
                  <li key={t.name} className="text-xs flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-muted2" />
                    {t.url ? (
                      <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-info hover:underline inline-flex items-center gap-0.5">
                        {t.name}
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M7 17l10-10M17 7H7v10" /></svg>
                      </a>
                    ) : (
                      <span className="text-ink">{t.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* stage navigation */}
        <div className="mt-5 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => setActive(STAGES[Math.max(0, activeIdx - 1)].key)}
            disabled={activeIdx === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border text-muted hover:text-ink hover:bg-surface2 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted transition-colors"
          >
            ← {activeIdx > 0 ? STAGES[activeIdx - 1].short : "start"}
          </button>
          <button
            type="button"
            onClick={() => setActive(STAGES[Math.min(STAGES.length - 1, activeIdx + 1)].key)}
            disabled={activeIdx === STAGES.length - 1}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border text-muted hover:text-ink hover:bg-surface2 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted transition-colors"
          >
            {activeIdx < STAGES.length - 1 ? STAGES[activeIdx + 1].short : "end"} →
          </button>
        </div>
      </div>
    </section>
  );
}

function Block({ label, body, accent }: { label: string; body: string; accent?: boolean }) {
  return (
    <div className={accent ? "rounded-md border border-accent/30 bg-accent/5 px-3 py-2.5" : ""}>
      <div className="text-[10px] eyebrow text-muted2 mb-1">{label}</div>
      <p className="text-sm text-ink leading-relaxed">{body}</p>
    </div>
  );
}

function SideBlock({ label, body }: { label: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-surface2/40 px-3 py-2">
      <div className="text-[10px] eyebrow text-muted2 mb-1">{label}</div>
      <p className="text-xs text-ink leading-relaxed">{body}</p>
    </div>
  );
}
