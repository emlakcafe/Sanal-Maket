import type { EngineAsset, EngineJob } from "./types";

export interface SanalMaketEngine {
  name: string;
  supports(asset: EngineAsset): boolean;
  createJob(input: {
    projectId: string;
    assets: EngineAsset[];
  }): Promise<EngineJob>;
  getJob(jobId: string): Promise<EngineJob>;
}

export class CompositeSanalMaketEngine implements SanalMaketEngine {
  name = "emlak-cafe-composite-engine";

  constructor(private readonly engines: SanalMaketEngine[]) {}

  supports(asset: EngineAsset) {
    return this.engines.some(engine => engine.supports(asset));
  }

  async createJob(input: { projectId: string; assets: EngineAsset[] }): Promise<EngineJob> {
    return {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      status: "queued",
      progress: 0
    };
  }

  async getJob(jobId: string): Promise<EngineJob> {
    return {
      id: jobId,
      projectId: "pending",
      status: "queued",
      progress: 0
    };
  }
}
