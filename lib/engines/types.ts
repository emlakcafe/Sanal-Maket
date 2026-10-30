export type EngineAssetKind = "floorplan" | "facade" | "interior" | "siteplan" | "other";

export type EngineAsset = {
  id: string;
  name: string;
  mimeType: string;
  kind: EngineAssetKind;
  storageUrl?: string;
};

export type EngineJobStatus =
  | "queued"
  | "analyzing"
  | "geometry"
  | "materials"
  | "assembling"
  | "quality-check"
  | "complete"
  | "failed";

export type EngineJob = {
  id: string;
  projectId: string;
  status: EngineJobStatus;
  progress: number;
  outputModelUrl?: string;
  quality?: {
    geometry: number;
    facade: number;
    materials: number;
    planConsistency: number;
  };
};
