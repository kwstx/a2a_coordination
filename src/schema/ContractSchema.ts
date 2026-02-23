import { ScopeOfWork, ResourceAllocation, AgentIdentity } from './MessageSchema';

/**
 * Defines a specific outcome with measurable success criteria.
 */
export interface MeasurableDeliverable {
    name: string;
    description: string;
    metric: string;               // e.g., 'Accuracy', 'Completion Percentage', 'Response Time'
    targetValue: string | number; // Expected value for the metric
    verificationMethod: string;   // How the deliverable is validated (e.g., 'Unit Test', 'Human Review')
}

/**
 * Consequences for failing to meet contract terms.
 */
export interface PenaltyClause {
    violationType: string;        // e.g., 'DELAY', 'QUALITY_FAILURE', 'UNAUTHORIZED_SUBDELEGATION'
    threshold: string | number;   // When the penalty triggers
    penaltyAmount: {
        amount: number;
        currency: string;
    };
    escalationPath: string;       // Action taken if penalty is not settled
}

/**
 * Conditions under which the task or agent state must be reverted.
 */
export interface RollbackCondition {
    trigger: string;              // e.g., 'CRITICAL_FAILURE', 'REVENUE_DROP', 'SECURITY_BREACH'
    scope: 'PARTIAL' | 'FULL';    // How much of the work is rolled back
    procedure: string;            // Reference to the rollback script or manual process
    retentionRequirements: string; // What data must be kept for auditing post-rollback
}

/**
 * External or internal references for auditing contract execution.
 */
export interface AuditReference {
    type: 'LOG_STREAM' | 'LEDGER_ENTRY' | 'CERTIFICATE' | 'SNAPSHOT';
    uri: string;                  // Location of the audit data
    checksum: string;             // Integrity hash for the audit record
    accessRequirements: string[]; // Permissions needed to view
}

/**
 * Cryptographic signature from a participating agent.
 */
export interface ContractSignature {
    agentId: string;
    publicKey: string;
    signature: string;
    timestamp: string;            // ISO 8601
    algorithm: string;
}

/**
 * SharedTaskContract formalizes a collaborative agreement between agents.
 * It is designed to be immutable once transitioned to 'SIGNED' or 'COMMITTED'.
 */
export interface SharedTaskContract {
    contractId: string;           // Unique contract identifier
    version: string;              // Schema version
    correlationId: string;        // Links back to the negotiation chain

    // Core Agreement Details
    scope: ScopeOfWork;
    deliverables: MeasurableDeliverable[];
    deadlines: {
        overallCompletion: string;  // ISO 8601
        milestones: {
            description: string;
            deadline: string;         // ISO 8601
        }[];
    };

    // Economic & Resource Terms
    compensation: ResourceAllocation;
    penaltyClauses: PenaltyClause[];

    // Governance & Safety
    rollbackConditions: RollbackCondition[];
    auditReferences: AuditReference[];

    // Participation
    participatingAgents: string[]; // List of Agent IDs
    signatures: ContractSignature[];

    status: 'DRAFT' | 'SIGNED' | 'ACTIVE' | 'COMPLETED' | 'TERMINATED' | 'ROLLED_BACK';
    createdAt: string;
    updatedAt: string;
}

/**
 * Factory for creating immutable SharedTaskContract objects.
 */
export class ContractFactory {
    /**
     * Creates a new contract and freezes it to prevent modifications.
     */
    public static createContract(data: Partial<SharedTaskContract>): Readonly<SharedTaskContract> {
        const contract: SharedTaskContract = {
            contractId: data.contractId || `cnt-${Math.random().toString(36).substr(2, 9)}`,
            version: '1.0.0',
            correlationId: data.correlationId || '',
            scope: data.scope || { tasks: [], deliverables: [], milestones: [], constraints: [] },
            deliverables: data.deliverables || [],
            deadlines: data.deadlines || { overallCompletion: '', milestones: [] },
            compensation: data.compensation || { budget: { amount: 0, currency: 'USD', limit: 0 } },
            penaltyClauses: data.penaltyClauses || [],
            rollbackConditions: data.rollbackConditions || [],
            auditReferences: data.auditReferences || [],
            participatingAgents: data.participatingAgents || [],
            signatures: data.signatures || [],
            status: data.status || 'DRAFT',
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: data.updatedAt || new Date().toISOString(),
        };

        return Object.freeze(contract);
    }

    /**
     * Signs a contract. Since the contract is immutable, this returns a new signed instance.
     */
    public static signContract(
        contract: SharedTaskContract,
        agent: AgentIdentity,
        signature: string
    ): Readonly<SharedTaskContract> {
        if (contract.status !== 'DRAFT' && contract.status !== 'SIGNED') {
            throw new Error(`Cannot sign contract in status: ${contract.status}`);
        }

        const newSignature: ContractSignature = {
            agentId: agent.id,
            publicKey: agent.publicKey,
            signature: signature,
            timestamp: new Date().toISOString(),
            algorithm: agent.algorithm
        };

        const updatedSignatures = [...contract.signatures, newSignature];
        const allSigned = contract.participatingAgents.every(id =>
            updatedSignatures.some(s => s.agentId === id)
        );

        const newContract: SharedTaskContract = {
            ...contract,
            signatures: updatedSignatures,
            status: allSigned ? 'SIGNED' : 'SIGNED', // Transitioning through signing process
            updatedAt: new Date().toISOString()
        };

        // If all agents have signed, we could move to ACTIVE, but usually that's an execution step.
        return Object.freeze(newContract);
    }

    /**
     * Commits the contract, making it final and ready for execution.
     */
    public static commit(contract: SharedTaskContract): Readonly<SharedTaskContract> {
        if (contract.signatures.length < contract.participatingAgents.length) {
            throw new Error('All participating agents must sign before commitment.');
        }

        const commitedContract: SharedTaskContract = {
            ...contract,
            status: 'ACTIVE',
            updatedAt: new Date().toISOString()
        };

        return Object.freeze(commitedContract);
    }
}
