import { ContractFactory, SharedTaskContract } from '../schema/ContractSchema';
import { AgentIdentity } from '../schema/MessageSchema';

/**
 * Demo: Creating and Signing a SharedTaskContract
 */

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

// 1. Initialize a contract draft
const contractDraft = ContractFactory.createContract({
    contractId: 'cnt-99821-alpha-beta',
    correlationId: 'tx_550e8400',
    participatingAgents: [agentAlpha.id, agentBeta.id],
    scope: {
        tasks: ['Develop ML Pipeline', 'Validate Dataset'],
        deliverables: ['ML Model v1', 'Validation Report'],
        milestones: [
            { description: 'Data Ingestion', deadline: '2026-03-10T12:00:00Z' },
            { description: 'Model Training', deadline: '2026-03-15T18:00:00Z' }
        ],
        constraints: ['Max latency < 200ms']
    },
    deliverables: [
        {
            name: 'ML Model v1',
            description: 'The trained model for sentiment analysis',
            metric: 'Accuracy',
            targetValue: 0.92,
            verificationMethod: 'Automated Test Suite'
        }
    ],
    deadlines: {
        overallCompletion: '2026-03-20T23:59:59Z',
        milestones: [
            { description: 'Beta Release', deadline: '2026-03-16T00:00:00Z' }
        ]
    },
    compensation: {
        budget: { amount: 1200, currency: 'USDT', limit: 1300 }
    },
    penaltyClauses: [
        {
            violationType: 'DELAY',
            threshold: '24h',
            penaltyAmount: { amount: 100, currency: 'USDT' },
            escalationPath: 'Notify Governance Board'
        }
    ],
    rollbackConditions: [
        {
            trigger: 'ACCURACY_BELOW_THRESHOLD',
            scope: 'PARTIAL',
            procedure: 'Revert to last stable weights',
            retentionRequirements: 'Log all training parameters'
        }
    ],
    auditReferences: [
        {
            type: 'LOG_STREAM',
            uri: 's3://audit-logs/cnt-99821',
            checksum: 'sha256:abc123xyz',
            accessRequirements: ['admin', 'auditor']
        }
    ]
});

console.log('--- Initial Contract Draft ---');
console.log(JSON.stringify(contractDraft, null, 2));

// 2. Agent Alpha signs
const alphaSigned = ContractFactory.signContract(contractDraft, agentAlpha, 'sig:alpha:valid');
console.log('\n--- After Agent Alpha Signs ---');
console.log(`Status: ${alphaSigned.status}`);
console.log(`Signatures: ${alphaSigned.signatures.length}`);

// 3. Agent Beta signs
const fullySigned = ContractFactory.signContract(alphaSigned, agentBeta, 'sig:beta:valid');
console.log('\n--- After Agent Beta Signs ---');
console.log(`Status: ${fullySigned.status}`);
console.log(`Signatures: ${fullySigned.signatures.length}`);

// 4. Commit the contract
const committedContract = ContractFactory.commit(fullySigned);
console.log('\n--- Committed Contract ---');
console.log(`Status: ${committedContract.status}`);
console.log(`Final ID: ${committedContract.contractId}`);

// 5. Demonstrate Immutability (uncommenting this would throw error in JS/TS if enforced)
try {
    (committedContract as any).status = 'CANCELLED';
} catch (e: any) {
    console.log('\n--- Immutability Check ---');
    console.log(`Caught expected error: ${e.message}`);
}
