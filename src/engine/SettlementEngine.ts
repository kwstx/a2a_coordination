
import { SharedTaskContract, MeasurableDeliverable, PenaltyClause } from '../schema/ContractSchema';
import { ReputationAndSynergyModule } from './ReputationAndSynergyModule';
import { BudgetManager } from './BudgetManager';
import { CollaborationRecord } from '../schema/ReputationSchema';

export interface ActualDeliverable {
    name: string;
    actualValue: string | number;
    evidence: string;
}

export interface SettlementReport {
    contractId: string;
    performanceScore: number; // 0.0 to 1.0
    deliverableResults: {
        name: string;
        target: string | number;
        actual: string | number;
        status: 'MET' | 'PARTIAL' | 'FAILED';
        fulfillmentRate: number;
    }[];
    penaltiesApplied: {
        violationType: string;
        amount: number;
        reason: string;
    }[];
    rewardsReleased: number;
    finalReputationUpdate: CollaborationRecord;
    timestamp: string;
}

/**
 * SettlementEngine
 * 
 * Validates task outcomes against contract terms.
 * Automatically releases rewards, applies penalties, adjusts budgets,
 * and updates reputation scores based on performance metrics.
 */
export class SettlementEngine {
    constructor(
        private reputationModule: ReputationAndSynergyModule,
        private budgetManager: BudgetManager
    ) { }

    /**
     * Processes the settlement for a completed contract.
     */
    public processSettlement(
        contract: SharedTaskContract,
        outcomes: ActualDeliverable[]
    ): SettlementReport {
        if (contract.status !== 'COMPLETED' && contract.status !== 'ROLLED_BACK') {
            throw new Error(`Cannot settle contract in status: ${contract.status}`);
        }

        const deliverableResults = this.validateDeliverables(contract.deliverables, outcomes);
        const averageFulfillment = deliverableResults.reduce((acc, r) => acc + r.fulfillmentRate, 0) / deliverableResults.length;

        const penalties = this.calculatePenalties(contract.penaltyClauses, deliverableResults);
        const totalPenalty = penalties.reduce((acc, p) => acc + p.amount, 0);

        const baseCompensation = contract.compensation.budget.amount;
        // Release rewards: compensation minus penalties
        // Adjust budget logic: release the remaining balance to the agent
        const rewardsReleased = Math.max(0, baseCompensation - totalPenalty);

        // Update economic tracking
        contract.participatingAgents.forEach(agentId => {
            // Apply rewards to each agent if they share the pot? 
            // In this simple model, we'll assume rewards go to all participants or split them.
            // Let's assume rewardsReleased is the total pot to be distributed.
            // For simplicity, we'll credit the lead agent or split among all.
            const share = rewardsReleased / contract.participatingAgents.length;
            const penaltyShare = totalPenalty / contract.participatingAgents.length;

            if (totalPenalty > 0) {
                this.budgetManager.applyPenalty(agentId, penaltyShare, contract.contractId);
            }
            if (rewardsReleased > 0) {
                this.budgetManager.releaseReward(agentId, share, contract.contractId);
            }

            // Finalize any pre-allocated budget
            this.budgetManager.finalizeAllocation(agentId, baseCompensation / contract.participatingAgents.length, baseCompensation / contract.participatingAgents.length, contract.contractId);
        });

        // Calculate metrics for Reputation
        const reliability = averageFulfillment;
        const economicPerformance = rewardsReleased / (baseCompensation || 1);
        const cooperativeImpact = contract.status === 'COMPLETED' ? 1.0 : 0.0;

        const timestamp = new Date().toISOString();

        // We pick the first agent as representative or record for each
        const reputationUpdates: CollaborationRecord[] = contract.participatingAgents.map(agentId => ({
            agentId,
            correlationId: contract.correlationId,
            timestamp,
            outcome: contract.status === 'COMPLETED' ? (averageFulfillment > 0.8 ? 'SUCCESS' : 'PARTIAL') : 'FAILURE',
            reliability,
            economicPerformance,
            cooperativeImpact
        }));

        reputationUpdates.forEach(update => this.reputationModule.recordOutcome(update));

        return {
            contractId: contract.contractId,
            performanceScore: averageFulfillment,
            deliverableResults,
            penaltiesApplied: penalties,
            rewardsReleased,
            finalReputationUpdate: reputationUpdates[0], // Return the first one for the report
            timestamp
        };
    }

    private validateDeliverables(
        targets: MeasurableDeliverable[],
        actuals: ActualDeliverable[]
    ): SettlementReport['deliverableResults'] {
        return targets.map(target => {
            const actual = actuals.find(a => a.name === target.name);
            if (!actual) {
                return {
                    name: target.name,
                    target: target.targetValue,
                    actual: 'N/A',
                    status: 'FAILED',
                    fulfillmentRate: 0
                };
            }

            let fulfillmentRate = 0;
            if (typeof target.targetValue === 'number' && typeof actual.actualValue === 'number') {
                fulfillmentRate = Math.min(1, actual.actualValue / target.targetValue);
            } else if (target.targetValue === actual.actualValue) {
                fulfillmentRate = 1.0;
            }

            return {
                name: target.name,
                target: target.targetValue,
                actual: actual.actualValue,
                status: fulfillmentRate >= 1 ? 'MET' : (fulfillmentRate > 0 ? 'PARTIAL' : 'FAILED'),
                fulfillmentRate
            };
        });
    }

    private calculatePenalties(
        clauses: PenaltyClause[],
        results: SettlementReport['deliverableResults']
    ): SettlementReport['penaltiesApplied'][] {
        const penalties: SettlementReport['penaltiesApplied'][] = [];

        results.forEach(res => {
            if (res.status !== 'MET') {
                // Check for applicable penalty clauses
                // This is a simplified matching; a real engine would match violationType to metric
                const applicableClause = clauses.find(c => c.violationType.toLowerCase().includes(res.name.toLowerCase()) ||
                    c.violationType === 'QUALITY_FAILURE');

                if (applicableClause) {
                    const penaltyImpact = (1 - res.fulfillmentRate) * applicableClause.penaltyAmount.amount;
                    if (penaltyImpact > 0) {
                        penalties.push({
                            violationType: applicableClause.violationType,
                            amount: penaltyImpact,
                            reason: `Fulfillment rate for ${res.name} was only ${Math.round(res.fulfillmentRate * 100)}%`
                        });
                    }
                }
            }
        });

        return penalties;
    }
}
