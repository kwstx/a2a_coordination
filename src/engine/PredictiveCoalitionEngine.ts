import { CollaborationRecord, SynergyMetrics } from '../schema/ReputationSchema';

export interface CoalitionRecommendationRequest {
  candidateAgents: string[];
  maxCoalitionSize?: number;
  topK?: number;
}

export interface CoalitionRecommendation {
  agents: string[];
  predictedSuccessScore: number;
  predictedEconomicScore: number;
  predictedSynergyScore: number;
  predictedCollectiveImpact: number;
  confidence: number;
  rationale: string[];
}

export interface CoalitionRecommendationResponse {
  generatedAt: string;
  recommendations: CoalitionRecommendation[];
}

interface AgentAggregate {
  count: number;
  successRate: number;
  reliability: number;
  economicPerformance: number;
  cooperativeImpact: number;
}

export class PredictiveCoalitionEngine {
  public recommend(
    request: CoalitionRecommendationRequest,
    history: CollaborationRecord[],
    synergyLinks: SynergyMetrics[]
  ): CoalitionRecommendationResponse {
    const uniqueAgents = Array.from(new Set(request.candidateAgents)).filter(Boolean);
    const maxCoalitionSize = this.normalizeMaxCoalitionSize(request.maxCoalitionSize, uniqueAgents.length);
    const topK = request.topK ?? 5;

    if (uniqueAgents.length < 2) {
      return { generatedAt: new Date().toISOString(), recommendations: [] };
    }

    const aggregates = this.buildAgentAggregates(history);
    const synergyMap = this.buildSynergyMap(synergyLinks);
    const coalitions = this.generateCoalitions(uniqueAgents, maxCoalitionSize);

    const recommendations = coalitions.map((agents) =>
      this.scoreCoalition(agents, aggregates, synergyMap)
    );

    recommendations.sort((a, b) => b.predictedCollectiveImpact - a.predictedCollectiveImpact);

    return {
      generatedAt: new Date().toISOString(),
      recommendations: recommendations.slice(0, Math.max(1, topK))
    };
  }

  private normalizeMaxCoalitionSize(size: number | undefined, availableAgents: number): number {
    if (!size || size < 2) {
      return Math.min(3, availableAgents);
    }
    return Math.max(2, Math.min(size, availableAgents));
  }

  private buildAgentAggregates(history: CollaborationRecord[]): Map<string, AgentAggregate> {
    const grouped = new Map<string, CollaborationRecord[]>();
    history.forEach((record) => {
      const list = grouped.get(record.agentId) ?? [];
      list.push(record);
      grouped.set(record.agentId, list);
    });

    const aggregates = new Map<string, AgentAggregate>();
    grouped.forEach((records, agentId) => {
      const count = records.length;
      const successes = records.filter((r) => r.outcome === 'SUCCESS').length;
      const successRate = count === 0 ? 0.5 : successes / count;
      const reliability = this.average(records.map((r) => r.reliability), 0.5);
      const economicPerformance = this.average(records.map((r) => r.economicPerformance), 0.5);
      const cooperativeImpact = this.average(records.map((r) => r.cooperativeImpact), 0.5);

      aggregates.set(agentId, {
        count,
        successRate,
        reliability,
        economicPerformance,
        cooperativeImpact
      });
    });

    return aggregates;
  }

  private buildSynergyMap(links: SynergyMetrics[]): Map<string, SynergyMetrics> {
    const map = new Map<string, SynergyMetrics>();
    links.forEach((link) => {
      const key = this.getSynergyKey(link.agentA, link.agentB);
      map.set(key, link);
    });
    return map;
  }

  private scoreCoalition(
    agents: string[],
    aggregates: Map<string, AgentAggregate>,
    synergyMap: Map<string, SynergyMetrics>
  ): CoalitionRecommendation {
    const stats = agents.map((agentId) => aggregates.get(agentId) ?? this.defaultAggregate());

    const predictedSuccessScore = this.average(
      stats.map((s) => (s.successRate * 0.6) + (s.reliability * 0.4)),
      0.5
    );
    const predictedEconomicScore = this.average(stats.map((s) => s.economicPerformance), 0.5);

    const pairSynergies: number[] = [];
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const key = this.getSynergyKey(agents[i], agents[j]);
        const link = synergyMap.get(key);
        pairSynergies.push(link?.compatibilityScore ?? 0.5);
      }
    }
    const predictedSynergyScore = this.average(pairSynergies, 0.5);

    const predictedCollectiveImpact =
      predictedSuccessScore * 0.35 +
      predictedEconomicScore * 0.35 +
      predictedSynergyScore * 0.30;

    const confidence = this.calculateConfidence(agents, stats, pairSynergies);

    const rationale = [
      `success=${predictedSuccessScore.toFixed(2)} from historical outcomes/reliability`,
      `economics=${predictedEconomicScore.toFixed(2)} from prior economic performance`,
      `synergy=${predictedSynergyScore.toFixed(2)} from pair compatibility network`,
      `confidence=${confidence.toFixed(2)} based on sample depth and pair coverage`
    ];

    return {
      agents,
      predictedSuccessScore,
      predictedEconomicScore,
      predictedSynergyScore,
      predictedCollectiveImpact,
      confidence,
      rationale
    };
  }

  private calculateConfidence(
    agents: string[],
    stats: AgentAggregate[],
    pairSynergies: number[]
  ): number {
    const historyDepth = this.average(stats.map((s) => Math.min(1, s.count / 10)), 0.2);
    const synergyCoverage = this.average(
      pairSynergies.map((score) => (score > 0.5 ? 1 : 0.4)),
      0.4
    );
    const breadthPenalty = agents.length > 2 ? 0.95 : 1;
    return Math.max(0, Math.min(1, ((historyDepth * 0.55) + (synergyCoverage * 0.45)) * breadthPenalty));
  }

  private defaultAggregate(): AgentAggregate {
    return {
      count: 0,
      successRate: 0.5,
      reliability: 0.5,
      economicPerformance: 0.5,
      cooperativeImpact: 0.5
    };
  }

  private generateCoalitions(agents: string[], maxSize: number): string[][] {
    const output: string[][] = [];
    for (let size = 2; size <= maxSize; size++) {
      this.combine(agents, size, 0, [], output);
    }
    return output;
  }

  private combine(
    source: string[],
    size: number,
    start: number,
    current: string[],
    output: string[][]
  ): void {
    if (current.length === size) {
      output.push([...current]);
      return;
    }

    for (let i = start; i < source.length; i++) {
      current.push(source[i]);
      this.combine(source, size, i + 1, current, output);
      current.pop();
    }
  }

  private average(values: number[], fallback: number): number {
    if (values.length === 0) return fallback;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private getSynergyKey(a: string, b: string): string {
    return [a, b].sort().join(':');
  }
}
