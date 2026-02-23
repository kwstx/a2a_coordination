import { ConflictResolutionEngine } from '../engine/ConflictResolutionEngine';
import {
  AuthorityProvider,
  BudgetProvider,
  IdentityVerifier,
  NegotiationEngine,
  RenegotiationContext,
  RenegotiationHandler,
  ReputationProvider,
  TransitionPermission
} from '../engine/NegotiationEngine';
import { AgentCoordinationMessage, MessageType } from '../schema/MessageSchema';

const identityVerifier: IdentityVerifier = {
  verify(message: AgentCoordinationMessage): boolean {
    return Boolean(message.sender.signature);
  }
};

const reputationProvider: ReputationProvider = {
  getScore(): number {
    return 0.95;
  }
};

const budgetProvider: BudgetProvider = {
  getAvailableBudget(): number {
    return 10000;
  }
};

const authorityProvider: AuthorityProvider = {
  hasPermission(_agentId: string, _permission: TransitionPermission): boolean {
    return true;
  }
};

const renegotiationHandler: RenegotiationHandler = {
  trigger(context: RenegotiationContext): void {
    console.log(`RENEGOTIATION TRIGGERED FOR ${context.sessionId}`);
    context.conflicts.forEach(conflict => {
      console.log(` - ${conflict.type}: ${conflict.message}`);
    });
  }
};

const conflictEngine = new ConflictResolutionEngine({
  maxDeadlineSkewHours: 12,
  contradictoryTaskPairs: [
    { a: 'enable public api access', b: 'disable public api access' }
  ]
});

const engine = new NegotiationEngine({
  identityVerifier,
  reputationProvider,
  budgetProvider,
  authorityProvider,
  minimumReputationScore: 0.7,
  conflictResolutionEngine: conflictEngine,
  renegotiationHandler
});

const baseMessage: AgentCoordinationMessage = {
  version: '1.0.0',
  messageId: 'msg-base',
  timestamp: '2026-02-23T10:00:00Z',
  type: MessageType.OFFER,
  sender: { id: 'agent:alpha', publicKey: 'pk-alpha', algorithm: 'Ed25519', signature: 'sig-alpha' },
  recipient: { id: 'agent:beta', publicKey: 'pk-beta', algorithm: 'Ed25519' },
  content: {
    scope: {
      tasks: ['Enable public API access'],
      deliverables: ['Access policy update'],
      milestones: [{ description: 'Policy update', deadline: '2026-02-24T12:00:00Z' }],
      constraints: ['Audit log required']
    },
    resources: {
      budget: { amount: 500, currency: 'USD', limit: 700 },
      compute: { type: 'GPU Cluster', allocation: '2 node-hours' }
    },
    deadline: '2026-02-24T18:00:00Z',
    risks: { riskScore: 0.2, identifiedRisks: [] },
    impact: { predictedRoi: 1.8, estimatedCost: 400, netValue: 1000, synergyScore: 0.7 }
  }
};

const firstProposal: AgentCoordinationMessage = {
  ...baseMessage,
  messageId: 'msg-1',
  correlationId: 'session-1'
};

const conflictingProposal: AgentCoordinationMessage = {
  ...baseMessage,
  messageId: 'msg-2',
  correlationId: 'session-2',
  sender: { id: 'agent:gamma', publicKey: 'pk-gamma', algorithm: 'Ed25519', signature: 'sig-gamma' },
  content: {
    ...baseMessage.content,
    scope: {
      ...baseMessage.content.scope,
      tasks: ['Disable public API access']
    },
    deadline: '2026-02-26T20:00:00Z'
  }
};

const renegotiatedProposal: AgentCoordinationMessage = {
  ...conflictingProposal,
  messageId: 'msg-3',
  timestamp: '2026-02-23T11:00:00Z',
  content: {
    ...conflictingProposal.content,
    scope: {
      ...conflictingProposal.content.scope,
      tasks: ['Enable internal API access']
    },
    resources: {
      ...conflictingProposal.content.resources,
      compute: { type: 'CPU Pool', allocation: '8 node-hours' }
    },
    deadline: '2026-02-24T20:00:00Z'
  },
  metadata: {
    renegotiation: {
      resolutionAccepted: true
    }
  }
};

console.log('FIRST PROPOSAL =>', engine.process(firstProposal));
console.log('CONFLICTING PROPOSAL =>', engine.process(conflictingProposal));
console.log('RENEGOTIATED PROPOSAL =>', engine.process(renegotiatedProposal));
