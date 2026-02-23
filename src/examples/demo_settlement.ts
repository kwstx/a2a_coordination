
import { ContractFactory } from '../schema/ContractSchema';
import { AgentIdentity } from '../schema/MessageSchema';
import { ReputationAndSynergyModule } from '../engine/ReputationAndSynergyModule';
import { BudgetManager } from '../engine/BudgetManager';
import { SettlementEngine, ActualDeliverable } from '../engine/SettlementEngine';

/**
 * Demo: SettlementEngine Validation, Economic Rewards, and Reputation Updates
 */

async function runDemo() {
    console.log("=== SettlementEngine Governance Demo ===\n");

    // 1. Initialize core modules
    const reputationModule = new ReputationAndSynergyModule();
    const budgetManager = new BudgetManager();
    const settlementEngine = new SettlementEngine(reputationModule, budgetManager);

    // 2. Setup Agents and initial budgets
    const agentAlpha: AgentIdentity = {
        id: 'agent:alpha-prime',
        publicKey: 'pubkey-alpha',
        algorithm: 'Ed25519'
    };

    const agentBeta: AgentIdentity = {
        id: 'agent:beta-core',
        publicKey: 'pubkey-beta',
        algorithm: 'Ed25519'
    };

    budgetManager.registerAgent(agentAlpha.id, 5000, 'USDT');
    budgetManager.registerAgent(agentBeta.id, 5000, 'USDT');

    console.log(`Initial Budget - Alpha: ${budgetManager.getBudget(agentAlpha.id)?.balance} USDT`);
    console.log(`Initial Budget - Beta: ${budgetManager.getBudget(agentBeta.id)?.balance} USDT\n`);

    // 3. Create and Activate a Contract
    let contract = ContractFactory.createContract({
        contractId: 'cnt-settle-001',
        participatingAgents: [agentAlpha.id, agentBeta.id],
        deliverables: [
            {
                name: 'Data Analysis Pipeline',
                description: 'Build a high-throughput pipeline',
                metric: 'Throughput',
                targetValue: 1000, // 1000 records/sec
                verificationMethod: 'Load Test'
            },
            {
                name: 'Report Accuracy',
                description: 'Ensure report matches ground truth',
                metric: 'Accuracy',
                targetValue: 0.95,
                verificationMethod: 'Cross-validation'
            }
        ],
        compensation: {
            budget: { amount: 2000, currency: 'USDT', limit: 2500 }
        },
        penaltyClauses: [
            {
                violationType: 'QUALITY_FAILURE',
                threshold: 0.9,
                penaltyAmount: { amount: 500, currency: 'USDT' },
                escalationPath: 'Notify Audit Dept'
            }
        ]
    });

    // Fast-forward through signing and committing
    contract = ContractFactory.signContract(contract, agentAlpha, 'sig-a');
    contract = ContractFactory.signContract(contract, agentBeta, 'sig-b');
    contract = ContractFactory.commit(contract);

    console.log(`Contract Created: ${contract.contractId}`);
    console.log(`Status: ${contract.status}`);
    console.log(`Compensation: ${contract.compensation.budget.amount} ${contract.compensation.budget.currency}\n`);

    // 4. Simulate Task Outcomes (Partial success)
    const actualOutcomes: ActualDeliverable[] = [
        {
            name: 'Data Analysis Pipeline',
            actualValue: 1200, // Exceeded target!
            evidence: 'Load test logs attached'
        },
        {
            name: 'Report Accuracy',
            actualValue: 0.85, // Below target (0.95)!
            evidence: 'Validation summary attached'
        }
    ];

    // Mark contract as COMPLETED (but with partial results)
    contract = ContractFactory.complete(contract, 'system', {
        success: true,
        summary: 'Pipeline delivered, but accuracy slightly below target.',
        evidence: ['load_test.log', 'accuracy_report.csv']
    });

    console.log("--- Executing Settlement ---");
    const report = settlementEngine.processSettlement(contract, actualOutcomes);

    // 5. Inspect Results
    console.log(`Performance Score: ${(report.performanceScore * 100).toFixed(2)}%`);
    console.log(`Rewards Released: ${report.rewardsReleased} USDT`);

    if (report.penaltiesApplied.length > 0) {
        console.log("Penalties Applied:");
        report.penaltiesApplied.forEach(p => console.log(` - [${p.violationType}] ${p.amount} USDT: ${p.reason}`));
    }

    console.log("\n--- Updated State ---");
    const alphaBudget = budgetManager.getBudget(agentAlpha.id);
    const betaBudget = budgetManager.getBudget(agentBeta.id);
    console.log(`Final Budget - Alpha: ${alphaBudget?.balance} USDT (Earned: ${alphaBudget?.totalEarned})`);
    console.log(`Final Budget - Beta: ${betaBudget?.balance} USDT (Earned: ${betaBudget?.totalEarned})`);

    const alphaRep = reputationModule.getReputation(agentAlpha.id);
    console.log(`Alpha Reputation Score: ${alphaRep?.globalScore.toFixed(4)}`);
    console.log(`Alpha Reliability: ${alphaRep?.metrics.averageReliability.toFixed(4)}`);

    console.log("\n=== Settlement Complete ===");
}

runDemo().catch(console.error);
