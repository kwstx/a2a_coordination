
import { AgentCoordinationMessage, MessageType } from '../../schema/MessageSchema';
import { NegotiationEngine, NegotiationState, TransitionResult } from '../../engine/NegotiationEngine';
import { SettlementEngine, ActualDeliverable, SettlementReport } from '../../engine/SettlementEngine';
import { ConflictResolutionEngine, ConflictCheckResult } from '../../engine/ConflictResolutionEngine';
import { CoordinationPolicyValidator } from '../../engine/CoordinationPolicyValidator';
import { SharedTaskContract, ContractFactory } from '../../schema/ContractSchema';
import { ReputationAndSynergyModule } from '../../engine/ReputationAndSynergyModule';
import { BudgetManager } from '../../engine/BudgetManager';
import { CoordinationPolicy, ValidationResponse } from '../../schema/PolicySchema';
import { v4 as uuidv4 } from 'uuid';

export interface CoordinationSession {
    sessionId: string;
    state: NegotiationState | null;
    history: AgentCoordinationMessage[];
    contract?: SharedTaskContract;
}

export class CoordinationService {
    private sessions = new Map<string, CoordinationSession>();
    private contracts = new Map<string, SharedTaskContract>();

    private negotiationEngine: NegotiationEngine;
    private settlementEngine: SettlementEngine;
    private conflictEngine: ConflictResolutionEngine;
    private policyValidator: CoordinationPolicyValidator;
    private reputationModule: ReputationAndSynergyModule;
    private budgetManager: BudgetManager;

    private defaultPolicy: CoordinationPolicy = {
        id: 'default-policy',
        name: 'Standard Coordination Policy',
        economic: {
            minRoi: 0.1,
            maxBudget: 1000000
        },
        compliance: {
            maxRiskScore: 0.5
        }
    };

    constructor() {
        this.reputationModule = new ReputationAndSynergyModule();
        this.budgetManager = new BudgetManager();
        this.conflictEngine = new ConflictResolutionEngine();
        this.policyValidator = new CoordinationPolicyValidator();
        this.settlementEngine = new SettlementEngine(this.reputationModule, this.budgetManager);

        const mockProviders = this.createMockProviders();
        this.negotiationEngine = new NegotiationEngine({
            ...mockProviders,
            minimumReputationScore: 0.5,
            conflictResolutionEngine: this.conflictEngine,
            auditSink: {
                record: (event) => {
                    console.log('[Audit]', JSON.stringify(event));
                    return {} as any;
                }
            }
        });
    }

    private createMockProviders() {
        return {
            identityVerifier: { verify: () => true },
            reputationProvider: {
                getScore: () => 0.8,
                getTrustThreshold: () => 0.5,
                getSynergyMultiplier: () => 1.1,
                validateCommitmentPriority: () => ({ priority: 'NORMAL' as const, requiresEscrow: false })
            },
            budgetProvider: { getAvailableBudget: () => 1000000 },
            authorityProvider: { hasPermission: () => true }
        };
    }

    public async negotiate(message: AgentCoordinationMessage, sessionId?: string): Promise<{ sessionId: string, result: TransitionResult }> {
        const result = this.negotiationEngine.process(message);
        const id = sessionId || message.correlationId || message.messageId;

        let session = this.sessions.get(id);
        if (!session) {
            session = { sessionId: id, state: result.state || null, history: [] };
            this.sessions.set(id, session);
        }

        if (result.accepted) {
            session.state = result.state || session.state;
            session.history.push(message);
        }

        return { sessionId: id, result };
    }

    public async validateMessage(message: AgentCoordinationMessage, policy?: CoordinationPolicy): Promise<ValidationResponse> {
        return this.policyValidator.evaluate(message, policy || this.defaultPolicy);
    }

    public async createContract(sessionId: string): Promise<SharedTaskContract> {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('Session not found');
        if (session.state !== NegotiationState.FINAL_COMMITMENT) {
            throw new Error(`Negotiation not finalized. Current state: ${session.state}`);
        }

        const lastMessage = session.history[session.history.length - 1];

        const contract = ContractFactory.createContract({
            correlationId: lastMessage.correlationId || lastMessage.messageId,
            participatingAgents: [lastMessage.sender.id, lastMessage.recipient.id],
            scope: lastMessage.content.scope,
            deliverables: lastMessage.content.scope.tasks.map(task => ({
                name: task,
                description: `Automated deliverable for task: ${task}`,
                metric: 'Completion',
                targetValue: 1,
                verificationMethod: 'Agent Confirmation'
            })),
            compensation: lastMessage.content.resources,
            deadlines: {
                overallCompletion: lastMessage.content.deadline,
                milestones: []
            },
            status: 'ACTIVE'
        });

        this.contracts.set(contract.contractId, contract);
        session.contract = contract;

        return contract;
    }

    public async confirmExecution(contractId: string, outcomes: ActualDeliverable[]): Promise<SettlementReport> {
        const contract = this.contracts.get(contractId);
        if (!contract) throw new Error('Contract not found');

        // Note: SettlementEngine.processSettlement handles status validation internally
        // But we need to make sure the contract status is set to something it expects
        // Here we update it via factory-like logic or just cast if needed, 
        // but SharedTaskContract in memory can be modified if not frozen, 
        // yet Factory returns a frozen object. 
        // For the sake of this service, we'll assume we can pass a "completed" version.

        const completedContract = { ...contract, status: 'COMPLETED' as const };
        const report = this.settlementEngine.processSettlement(completedContract, outcomes);

        this.contracts.set(contractId, completedContract);
        return report;
    }

    public async resolveDispute(sessionId: string, message: AgentCoordinationMessage): Promise<ConflictCheckResult> {
        return this.conflictEngine.evaluate(message, sessionId);
    }

    public getSession(sessionId: string): CoordinationSession | undefined {
        return this.sessions.get(sessionId);
    }

    public getContract(contractId: string): SharedTaskContract | undefined {
        return this.contracts.get(contractId);
    }
}
