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
    tagline: "Sentinel-2 L2A monthly composites for the AOI.",
    what:
      "CDSE openEO query over the Rayong bbox. SCL classes 3 / 8 / 9 / 10 (cloud-shadow, mid + high cloud, cirrus) masked, then monthly median. 10 m bands (B02 / B03 / B04 / B08) kept at native; 20 m bands kept and bilinearly upsampled when used.",
    why:
      "Monthly medians cut clouds without losing seasonality. Reflectance scale keeps spectra comparable across months for NDVI etc.",
    completion:
      "One GeoTIFF per month in `cache/s2_monthly/<aoi>/`. done = months successfully fetched; total = months requested.",
    inputs: "AOI bbox · time window · max cloud cover 85 %",
    outputs: "GeoTIFFs · 10 m · 10 bands × N months",
    tools: [
      { name: "CDSE openEO", url: "https://openeo.dataspace.copernicus.eu/" },
      { name: "rasterio + rioxarray", url: "https://corteva.github.io/rioxarray/" },
    ],
  },
  sr: {
    emoji: "🔬",
    tagline: "Super-resolve 10 m → 2.5 m with OpenSR latent diffusion.",
    what:
      "`opensr_model.SRLatentDiffusion` on B02 / B03 / B04 / B08. 4× upsample in latent space, reflectance out. 20 m bands not run through the model — bilinear upsample only.",
    why:
      "10 m pixels alias narrow Rayong fields (5–15 m). 2.5 m gives RF features something to grip on for rubber rows, bunds, orchard headlands.",
    completion:
      "One SR GeoTIFF per month in `cache/s2_sr/<aoi>/`. done = SR tiles persisted; total = same as Data.",
    inputs: "Monthly composites · 10 m · B02 / B03 / B04 / B08",
    outputs: "SR GeoTIFFs · 2.5 m · same band order",
    tools: [
      { name: "opensr-model", url: "https://github.com/ESAOpenSR/opensr-model" },
      { name: "OmegaConf", url: "https://omegaconf.readthedocs.io/" },
    ],
  },
  gen: {
    emoji: "✨",
    tagline: "Latent-LoRA fine-tune of opensr-ldsrs2 per minority class.",
    what:
      "Sentinel-2 4-band patches are encoded to latent z₀ via the frozen CompVis VAE. UNet learns ε-prediction on the concat of (noisy latent, LR latent): L = E ‖ε − ε_θ([z_t ‖ z_c], t)‖² with z_t = √ᾱ_t z₀ + √(1−ᾱ_t) ε. Only LoRA adapters (rank 8, α 16) on the attention q/k/v/proj_out Conv2d projections receive gradients.",
    why:
      "DiffusionSat is RGB-only and OOD on Thai orchards. Plain oversampling duplicates noise. Latent-LoRA on the model already trained on Sentinel-2 keeps the radiometry honest and stays 4-band.",
    completion:
      "Per-class LoRA at `cache/lora/<class>.pt` (~10 MB) + ~200 synthetic patches at `cache/synth/<class>/`. done = classes with LoRA + patches written; total = `len(CFG.minority_classes)`.",
    inputs: "Real SR patches per minority class (≥ 100 each)",
    outputs: "LoRA adapters · .npy + RGB .png per patch · feature rows appended to pixel_table",
    tools: [
      { name: "opensr-model", url: "https://github.com/ESAOpenSR/opensr-model" },
      { name: "peft (LoRA)", url: "https://huggingface.co/docs/peft/" },
    ],
  },
  feat: {
    emoji: "🧮",
    tagline: "Per-pixel features from SR + landuse labels.",
    what:
      "Rasterise the LDD shapefile onto the SR grid for per-pixel `LU_CODE`. For each labelled pixel: monthly mean/std/min/max/p90 per band + NDVI / NDWI + GLCM/LBP texture in a small window. Synth rows from GenAI concatenated in the same DataFrame.",
    why:
      "Raw bands separate crops poorly; monthly stats + texture capture phenology. RF gets a flat tabular view without a time-series model.",
    completion:
      "`pixel_table.parquet` (or .pkl fallback) written. done = rows written; total = target pixel budget.",
    inputs: "SR stack · LDD landuse shapefile · `LU_CODE`",
    outputs: "pixel_table · ~25 features per pixel",
    tools: [
      { name: "rasterio.features", url: "https://rasterio.readthedocs.io/en/stable/topics/features.html" },
      { name: "scikit-image (GLCM, LBP)", url: "https://scikit-image.org/" },
    ],
  },
  rf: {
    emoji: "🌳",
    tagline: "Random Forest cascade per-pixel.",
    what:
      "Stage-1 RF over all `LU_CODE` classes. Stage-2 RF trained on minority pixels only. Samples route to stage-2 when stage-1 confidence < 0.6 or it predicts a non-minority class.",
    why:
      "Single RF drops borderline minority pixels into dominant classes. Cascade keeps minority recall without hurting dominant precision.",
    completion:
      "Stage-1 + stage-2 dumped as joblib pickles. done = models persisted; total = 2.",
    inputs: "pixel_table · train/val split stratified by class",
    outputs: "rf_stage1.joblib · rf_stage2_minor.joblib · confusion matrix · feature importance",
    tools: [
      { name: "scikit-learn RandomForestClassifier", url: "https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.RandomForestClassifier.html" },
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
            <h2 className="text-lg font-semibold text-ink mt-0.5">Stages, inputs, outputs</h2>
            <p className="text-xs text-muted mt-1 max-w-2xl">
              Click a stage for what it does and what &ldquo;done&rdquo; means. Numbers track the current board state.
            </p>
          </div>
          <a
            href="https://github.com/EarthWittawat/rayong-tracker/blob/main/notebooks/pipeline.ipynb"
            target="_blank"
            rel="noopener noreferrer"
            className="group relative inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md bg-ink text-bg shadow-card hover:shadow-cardHover hover:brightness-110 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent notebook-cta"
            title="Open the pipeline notebook on GitHub"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              <path d="M8 7h8M8 11h8M8 15h5" />
            </svg>
            <span className="tabular">Open notebook</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
              <path d="M7 17l10-10" />
              <path d="M17 7H7v10" />
            </svg>
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
              <div className="text-[10px] eyebrow text-muted2">{activeStage.short} · stage {activeIdx + 1}/{STAGES.length}</div>
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
