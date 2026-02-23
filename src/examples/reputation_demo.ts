
import { MessageType, AgentCoordinationMessage } from '../schema/MessageSchema';
import { NegotiationEngine, NegotiationState } from '../engine/NegotiationEngine';
import { ReputationAndSynergyModule } from '../engine/ReputationAndSynergyModule';

async function runComprehensiveDemo() {
    console.log('=== Reputation and Synergy Coordination System ===\n');

    const reputationModule = new ReputationAndSynergyModule();

    // Setup Negotiation Engine with Reputation Module as Provider
    const engine = new NegotiationEngine({
        identityVerifier: { verify: () => true },
        reputationProvider: reputationModule,
        budgetProvider: { getAvailableBudget: () => 1000000 },
        authorityProvider: { hasPermission: () => true },
        minimumReputationScore: 0.5,
        economicGuardrails: {
            minimumExpectedRoi: 15, // 15% ROI required by default
        }
    });

    const alice = 'agent-alice';
    const bob = 'agent-bob';
    const malory = 'agent-malory';

    // 1. Establish Alice as a high-performing agent
    console.log('--- Step 1: Building Reputation ---');
    reputationModule.recordOutcome({
        agentId: alice,
        correlationId: 'c1',
        timestamp: new Date().toISOString(),
        outcome: 'SUCCESS',
        reliability: 1.0,
        economicPerformance: 0.95,
        cooperativeImpact: 0.9
    });
    console.log(`Alice Score: ${reputationModule.getScore(alice).toFixed(2)}`);

    // 2. Demonstrate Negotiation Weighting (Synergy)
    // Bob and Alice have high synergy
    reputationModule.updateSynergy(alice, bob, 0.95);
    console.log(`\n--- Step 2: Negotiation Weighting (Synergy) ---`);
    console.log(`Synergy Multiplier (Alice-Bob): ${reputationModule.getSynergyMultiplier(alice, bob).toFixed(2)}`);

    const lowRoiOffer: AgentCoordinationMessage = {
        version: '1.0.0',
        messageId: 'm1',
        timestamp: new Date().toISOString(),
        type: MessageType.OFFER,
        sender: { id: alice, publicKey: 'pk', algorithm: 'ed25519' },
        recipient: { id: bob, publicKey: 'pk', algorithm: 'ed25519' },
        content: {
            scope: { tasks: ['Task A'], deliverables: ['Deliv A'], milestones: [], constraints: [] },
            resources: { budget: { amount: 1000, currency: 'USD', limit: 2000 } },
            deadline: new Date().toISOString(),
            risks: { riskScore: 0.1, identifiedRisks: [] },
            impact: { predictedRoi: 14, estimatedCost: 1000, netValue: 140, synergyScore: 0.95 } // 14% ROI < 15% req
        }
    };

    const negotiationResult = engine.process(lowRoiOffer);
    console.log(`Alice Offer with 14% ROI (15% req): ${negotiationResult.accepted ? 'ACCEPTED' : 'REJECTED'}`);
    if (negotiationResult.accepted) {
        console.log('Result: Accepted because synergy lowered the ROI threshold to ~13.7%.');
    }

    // 3. Demonstrate Trust Thresholds (Budget size)
    console.log(`\n--- Step 3: Trust Thresholds ---`);
    const moderateBudget = 400000;
    const largeBudgetOffer: AgentCoordinationMessage = {
        ...lowRoiOffer,
        messageId: 'm2',
        content: {
            ...lowRoiOffer.content,
            resources: { budget: { amount: moderateBudget, currency: 'USD', limit: 500000 } },
            impact: { ...lowRoiOffer.content.impact, predictedRoi: 20 } // High ROI to pass that check
        }
    };

    // Malory has poor history
    reputationModule.recordOutcome({
        agentId: malory,
        correlationId: 'c2',
        timestamp: new Date().toISOString(),
        outcome: 'FAILURE',
        reliability: 0.1,
        economicPerformance: 0.1,
        cooperativeImpact: 0.0
    });

    // Malory's score is ~0.05. Required threshold for 400k is 0.44.
    const maloryOffer = { ...largeBudgetOffer, sender: { id: malory, publicKey: 'pk', algorithm: 'ed25519' } };
    const maloryResult = engine.process(maloryOffer);
    console.log(`Malory ($400k offer) Result: ${maloryResult.accepted ? 'ACCEPTED' : 'REJECTED'}`);
    console.log(`Reason: ${maloryResult.reason}`);

    const aliceLargeOffer = { ...largeBudgetOffer, sender: { id: alice, publicKey: 'pk', algorithm: 'ed25519' } };
    const aliceResult = engine.process(aliceLargeOffer);
    console.log(`Alice ($400k offer) Result: ${aliceResult.accepted ? 'ACCEPTED' : 'REJECTED'}`);

    // 4. Demonstrate Commitment Validation (Escrow requirement)
    console.log(`\n--- Step 4: Commitment Validation ---`);

    // Give Malory a bit more reputation so she can pass the trust threshold for a small budget
    reputationModule.recordOutcome({
        agentId: malory,
        correlationId: 'c3',
        timestamp: new Date().toISOString(),
        outcome: 'PARTIAL',
        reliability: 0.5,
        economicPerformance: 0.4,
        cooperativeImpact: 0.3
    });
    // Malory's score is now roughly 0.25-0.3. Still < 0.4 (requires escrow)

    const smallBudget = 1000;
    const malorySmallOffer: AgentCoordinationMessage = {
        ...largeBudgetOffer,
        messageId: 'm3',
        content: {
            ...largeBudgetOffer.content,
            resources: { budget: { amount: smallBudget, currency: 'USD', limit: 2000 } }
        },
        sender: { id: malory, publicKey: 'pk', algorithm: 'ed25519' }
    };

    // Manual state setup for demo purposes
    (engine as any).sessions.set('m3', { id: 'm3', state: NegotiationState.TENTATIVE_AGREEMENT });

    const maloryCommitment: AgentCoordinationMessage = {
        ...malorySmallOffer,
        messageId: 'm4',
        correlationId: 'm3',
        type: MessageType.COMMITMENT,
        metadata: { commitment: { isFormal: true, verificationToken: 'tok-123' } }
    };

    const commitResult = engine.process(maloryCommitment);
    console.log(`Malory (Score: ${reputationModule.getScore(malory).toFixed(2)}) Commitment (No Escrow): ${commitResult.accepted ? 'ACCEPTED' : 'REJECTED'}`);
    if (!commitResult.accepted) {
        console.log(`Reason: ${commitResult.reason}`);
    }

    const maloryCommitmentWithEscrow: AgentCoordinationMessage = {
        ...maloryCommitment,
        metadata: { ...maloryCommitment.metadata, escrowId: 'ESCROW-999' }
    };
    const commitResult2 = engine.process(maloryCommitmentWithEscrow);
    console.log(`Malory Commitment (With Escrow): ${commitResult2.accepted ? 'ACCEPTED' : 'REJECTED'}`);
}

runComprehensiveDemo().catch(console.error);
