
/**
 * BudgetManager
 * 
 * Manages agent balances, tracks expenditures, and handles reward distributions.
 * Part of the economic autonomy module.
 */
export interface AgentBudget {
    agentId: string;
    balance: number;
    currency: string;
    allocated: number;
    totalEarned: number;
    totalSpent: number;
}

export interface EconomicTransaction {
    transactionId: string;
    agentId: string;
    amount: number;
    type: 'CREDIT' | 'DEBIT' | 'REWARD' | 'PENALTY' | 'ALLOCATION';
    referenceId: string; // e.g., contractId
    timestamp: string;
}

export class BudgetManager {
    private budgets: Map<string, AgentBudget> = new Map();
    private transactions: EconomicTransaction[] = [];

    public registerAgent(agentId: string, initialBalance: number, currency: string = 'STAKE'): void {
        if (!this.budgets.has(agentId)) {
            this.budgets.set(agentId, {
                agentId,
                balance: initialBalance,
                currency,
                allocated: 0,
                totalEarned: 0,
                totalSpent: 0
            });
        }
    }

    public getBudget(agentId: string): AgentBudget | undefined {
        return this.budgets.get(agentId);
    }

    public allocate(agentId: string, amount: number, referenceId: string): boolean {
        const budget = this.budgets.get(agentId);
        if (!budget || budget.balance < amount) return false;

        budget.balance -= amount;
        budget.allocated += amount;

        this.recordTransaction(agentId, -amount, 'ALLOCATION', referenceId);
        return true;
    }

    public releaseReward(agentId: string, amount: number, referenceId: string): void {
        const budget = this.budgets.get(agentId);
        if (!budget) return;

        budget.balance += amount;
        budget.totalEarned += amount;

        this.recordTransaction(agentId, amount, 'REWARD', referenceId);
    }

    public applyPenalty(agentId: string, amount: number, referenceId: string): void {
        const budget = this.budgets.get(agentId);
        if (!budget) return;

        // Penalty can lead to negative balance if allowed, or just deduct
        budget.balance -= amount;
        budget.totalSpent += amount; // Penalties count as "spent" or loss

        this.recordTransaction(agentId, -amount, 'PENALTY', referenceId);
    }

    public finalizeAllocation(agentId: string, amount: number, actualSpent: number, referenceId: string): void {
        const budget = this.budgets.get(agentId);
        if (!budget) return;

        budget.allocated -= amount;
        const refund = amount - actualSpent;

        if (refund > 0) {
            budget.balance += refund;
            this.recordTransaction(agentId, refund, 'CREDIT', referenceId);
        }

        budget.totalSpent += actualSpent;
    }

    private recordTransaction(agentId: string, amount: number, type: EconomicTransaction['type'], referenceId: string): void {
        this.transactions.push({
            transactionId: `tx_${Math.random().toString(36).substr(2, 9)}`,
            agentId,
            amount,
            type,
            referenceId,
            timestamp: new Date().toISOString()
        });
    }

    public getTransactionsForAgent(agentId: string): EconomicTransaction[] {
        return this.transactions.filter(tx => tx.agentId === agentId);
    }

    public getProjectPnL(contractId: string): number {
        return this.transactions
            .filter(tx => tx.referenceId === contractId)
            .reduce((sum, tx) => sum + tx.amount, 0);
    }
}
