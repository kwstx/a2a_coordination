import { AgentCoordinationMessage, MessageType } from '../schema/MessageSchema';
import { ConflictDetail, ConflictResolutionEngine } from './ConflictResolutionEngine';
import { AuditSink } from '../audit/ImmutableAuditLog';

export enum NegotiationState {
  PROPOSAL = 'PROPOSAL',
  COUNTERPROPOSAL = 'COUNTERPROPOSAL',
  TENTATIVE_AGREEMENT = 'TENTATIVE_AGREEMENT',
  FINAL_COMMITMENT = 'FINAL_COMMITMENT'
}

export type TransitionPermission =
  | 'NEGOTIATE_PROPOSAL'
  | 'NEGOTIATE_COUNTERPROPOSAL'
  | 'NEGOTIATE_TENTATIVE_AGREEMENT'
  | 'NEGOTIATE_FINAL_COMMITMENT';

const STATE_FROM_MESSAGE_TYPE: Record<MessageType, NegotiationState | null> = {
  [MessageType.OFFER]: NegotiationState.PROPOSAL,
  [MessageType.COUNTEROFFER]: NegotiationState.COUNTERPROPOSAL,
  [MessageType.ACCEPTANCE]: NegotiationState.TENTATIVE_AGREEMENT,
  [MessageType.REJECTION]: null,
  [MessageType.COMMITMENT]: NegotiationState.FINAL_COMMITMENT
};

const REQUIRED_PREDECESSOR: Record<NegotiationState, NegotiationState | null> = {
  [NegotiationState.PROPOSAL]: null,
  [NegotiationState.COUNTERPROPOSAL]: NegotiationState.PROPOSAL,
  [NegotiationState.TENTATIVE_AGREEMENT]: NegotiationState.COUNTERPROPOSAL,
  [NegotiationState.FINAL_COMMITMENT]: NegotiationState.TENTATIVE_AGREEMENT
};

const REQUIRED_PERMISSION: Record<NegotiationState, TransitionPermission> = {
  [NegotiationState.PROPOSAL]: 'NEGOTIATE_PROPOSAL',
  [NegotiationState.COUNTERPROPOSAL]: 'NEGOTIATE_COUNTERPROPOSAL',
  [NegotiationState.TENTATIVE_AGREEMENT]: 'NEGOTIATE_TENTATIVE_AGREEMENT',
  [NegotiationState.FINAL_COMMITMENT]: 'NEGOTIATE_FINAL_COMMITMENT'
};

export interface IdentityVerifier {
  verify(message: AgentCoordinationMessage): boolean;
}

export interface ReputationProvider {
  getScore(agentId: string): number;
  getTrustThreshold?(agentId: string, budgetRequested: number): number;
  getSynergyMultiplier?(agentA: string, agentB: string): number;
  validateCommitmentPriority?(message: AgentCoordinationMessage): {
    priority: 'HIGH' | 'NORMAL' | 'LOW';
    requiresEscrow: boolean;
  };
}

export interface BudgetProvider {
  getAvailableBudget(agentId: string, currency: string): number;
}

export interface SharedTreasuryProvider {
  getAvailableTreasury(currency: string): number;
  getReservedTreasury?(currency: string): number;
}

export interface DownstreamCostProvider {
  getProjectedDownstreamCost(message: AgentCoordinationMessage): number;
}

export interface AuthorityProvider {
  hasPermission(agentId: string, permission: TransitionPermission): boolean;
}

export interface EconomicGuardrails {
  minimumExpectedRoi?: number;
  minimumNetValue?: number;
  sharedTreasuryUtilizationLimit?: number;
}

export interface NegotiationEngineConfig {
  identityVerifier: IdentityVerifier;
  reputationProvider: ReputationProvider;
  budgetProvider: BudgetProvider;
  authorityProvider: AuthorityProvider;
  minimumReputationScore: number;
  sharedTreasuryProvider?: SharedTreasuryProvider;
  downstreamCostProvider?: DownstreamCostProvider;
  economicGuardrails?: EconomicGuardrails;
  conflictResolutionEngine?: ConflictResolutionEngine;
  renegotiationHandler?: RenegotiationHandler;
  auditSink?: AuditSink;
}

export interface RenegotiationContext {
  sessionId: string;
  message: AgentCoordinationMessage;
  conflicts: ConflictDetail[];
}

export interface RenegotiationHandler {
  trigger(context: RenegotiationContext): void;
}

interface NegotiationSession {
  id: string;
  state: NegotiationState | null;
}

export interface TransitionResult {
  accepted: boolean;
  state?: NegotiationState;
  reason?: string;
  action?: 'ALLOW' | 'RENEGOTIATE' | 'BLOCK' | 'PAUSE_AND_RENEGOTIATE';
  economicViolations?: string[];
  paused?: boolean;
  conflicts?: ConflictDetail[];
}

export class NegotiationEngine {
  private readonly sessions = new Map<string, NegotiationSession>();
  private readonly pausedSessions = new Set<string>();

  public constructor(private readonly config: NegotiationEngineConfig) { }

  public process(message: AgentCoordinationMessage): TransitionResult {
    const nextState = STATE_FROM_MESSAGE_TYPE[message.type];
    const sessionId = message.correlationId ?? message.messageId;
    this.config.auditSink?.record({
      domain: 'NEGOTIATION',
      action: 'NEGOTIATION_STEP_RECEIVED',
      outcome: 'INFO',
      correlationId: message.correlationId,
      sessionId,
      messageId: message.messageId,
      actorId: message.sender.id,
      details: {
        type: message.type,
        targetState: nextState
      }
    });

    if (!nextState) {
      this.config.auditSink?.record({
        domain: 'REJECTION',
        action: 'NEGOTIATION_STEP_REJECTED',
        outcome: 'FAILURE',
        correlationId: message.correlationId,
        sessionId,
        messageId: message.messageId,
        actorId: message.sender.id,
        details: { reason: `Message type "${message.type}" is not a valid negotiation transition.` }
      });
      return {
        accepted: false,
        reason: `Message type "${message.type}" is not a valid negotiation transition.`
      };
    }

    const session = this.sessions.get(sessionId) ?? { id: sessionId, state: null };

    if (this.pausedSessions.has(sessionId) && !message.metadata?.renegotiation?.resolutionAccepted) {
      this.config.auditSink?.record({
        domain: 'REJECTION',
        action: 'NEGOTIATION_PAUSED_REJECTION',
        outcome: 'FAILURE',
        correlationId: message.correlationId,
        sessionId,
        messageId: message.messageId,
        actorId: message.sender.id,
        details: { reason: `Session "${sessionId}" is paused until renegotiation confirms conflict resolution.` }
      });
      return {
        accepted: false,
        reason: `Session "${sessionId}" is paused until renegotiation confirms conflict resolution.`,
        action: 'PAUSE_AND_RENEGOTIATE',
        paused: true
      };
    }

    const predecessor = REQUIRED_PREDECESSOR[nextState];
    if (session.state !== predecessor) {
      this.config.auditSink?.record({
        domain: 'REJECTION',
        action: 'NEGOTIATION_INVALID_TRANSITION',
        outcome: 'FAILURE',
        correlationId: message.correlationId,
        sessionId,
        messageId: message.messageId,
        actorId: message.sender.id,
        details: {
          expected: predecessor ?? 'NONE',
          found: session.state ?? 'NONE'
        }
      });
      return {
        accepted: false,
        reason: `Invalid transition. Expected "${predecessor ?? 'NONE'}" before "${nextState}", found "${session.state ?? 'NONE'}".`
      };
    }

    const gateResult = this.validateGates(message, nextState);
    if (!gateResult.accepted) {
      return gateResult;
    }

    const conflictResult = this.evaluateConflicts(message, sessionId);
    if (conflictResult) {
      return conflictResult;
    }

    session.state = nextState;
    this.sessions.set(sessionId, session);
    this.config.conflictResolutionEngine?.register(message, sessionId);
    if (message.metadata?.renegotiation?.resolutionAccepted) {
      this.pausedSessions.delete(sessionId);
    }
    this.config.auditSink?.record({
      domain: 'APPROVAL',
      action: 'NEGOTIATION_STEP_ACCEPTED',
      outcome: 'SUCCESS',
      correlationId: message.correlationId,
      sessionId,
      messageId: message.messageId,
      actorId: message.sender.id,
      details: { state: nextState }
    });
    return { accepted: true, state: nextState, action: 'ALLOW' };
  }

  public getState(sessionId: string): NegotiationState | null {
    return this.sessions.get(sessionId)?.state ?? null;
  }

  public resumeSession(sessionId: string): void {
    this.pausedSessions.delete(sessionId);
  }

  private validateGates(
    message: AgentCoordinationMessage,
    nextState: NegotiationState
  ): TransitionResult {
    const sessionId = message.correlationId ?? message.messageId;
    const reject = (reason: string, action?: TransitionResult['action']): TransitionResult => {
      this.config.auditSink?.record({
        domain: 'REJECTION',
        action: 'NEGOTIATION_GATE_REJECTED',
        outcome: 'FAILURE',
        correlationId: message.correlationId,
        sessionId,
        messageId: message.messageId,
        actorId: message.sender.id,
        details: { state: nextState, reason, action: action ?? 'BLOCK' }
      });
      return { accepted: false, reason, action };
    };

    if (!this.config.identityVerifier.verify(message)) {
      return reject('Identity verification failed.');
    }

    const reputation = this.config.reputationProvider.getScore(message.sender.id);
    const budget = message.content.resources.budget;

    // Dynamic Trust Threshold
    const minRep = this.config.reputationProvider.getTrustThreshold
      ? this.config.reputationProvider.getTrustThreshold(message.sender.id, budget.amount)
      : this.config.minimumReputationScore;

    if (reputation < minRep) {
      return reject(
        `Reputation score ${reputation.toFixed(2)} is below required threshold ${minRep.toFixed(2)} for this transaction.`
      );
    }

    if (budget.amount > budget.limit) {
      return reject(
        `Requested budget amount ${budget.amount} exceeds declared limit ${budget.limit}.`,
        nextState === NegotiationState.FINAL_COMMITMENT ? 'BLOCK' : 'RENEGOTIATE'
      );
    }

    const availableBudget = this.config.budgetProvider.getAvailableBudget(
      message.sender.id,
      budget.currency
    );
    if (budget.amount > availableBudget) {
      return reject(
        `Requested budget amount ${budget.amount} exceeds available budget ${availableBudget}.`,
        nextState === NegotiationState.FINAL_COMMITMENT ? 'BLOCK' : 'RENEGOTIATE'
      );
    }

    const economicResult = this.validateEconomicViability(message, nextState);
    if (economicResult) {
      this.config.auditSink?.record({
        domain: 'REJECTION',
        action: 'ECONOMIC_GUARDRAIL_REJECTED',
        outcome: 'FAILURE',
        correlationId: message.correlationId,
        sessionId,
        messageId: message.messageId,
        actorId: message.sender.id,
        details: {
          state: nextState,
          action: economicResult.action,
          reason: economicResult.reason,
          violations: economicResult.economicViolations
        }
      });
      return economicResult;
    }

    const requiredPermission = REQUIRED_PERMISSION[nextState];
    if (!this.config.authorityProvider.hasPermission(message.sender.id, requiredPermission)) {
      return reject(`Sender "${message.sender.id}" lacks authority "${requiredPermission}".`);
    }

    if (nextState === NegotiationState.FINAL_COMMITMENT) {
      const commitmentMetadata = message.metadata?.commitment as
        | { isFormal?: boolean; verificationToken?: string }
        | undefined;

      if (!commitmentMetadata?.isFormal || !commitmentMetadata?.verificationToken) {
        return reject('Final commitment must be formal and include a verification token.');
      }

      // Commitment Priority and Validation
      if (this.config.reputationProvider.validateCommitmentPriority) {
        const priorityInfo = this.config.reputationProvider.validateCommitmentPriority(message);
        if (priorityInfo.requiresEscrow && !message.metadata?.escrowId) {
          return reject(
            `Low reputation agent "${message.sender.id}" requires an Escrow ID for final commitment.`
          );
        }
      }
    }

    this.config.auditSink?.record({
      domain: 'NEGOTIATION',
      action: 'NEGOTIATION_GATES_PASSED',
      outcome: 'SUCCESS',
      correlationId: message.correlationId,
      sessionId,
      messageId: message.messageId,
      actorId: message.sender.id,
      details: { state: nextState }
    });
    return { accepted: true, state: nextState, action: 'ALLOW' };
  }

  private validateEconomicViability(
    message: AgentCoordinationMessage,
    nextState: NegotiationState
  ): TransitionResult | null {
    const violations: string[] = [];
    const impact = message.content.impact;
    const budget = message.content.resources.budget;
    const guardrails = this.config.economicGuardrails;

    let minRoi = guardrails?.minimumExpectedRoi;

    // Synergy Influence on Weighting
    if (minRoi !== undefined && this.config.reputationProvider.getSynergyMultiplier) {
      const multiplier = this.config.reputationProvider.getSynergyMultiplier(
        message.sender.id,
        message.recipient.id
      );
      // High synergy can lower the required ROI threshold (more tolerant of lower ROI if synergy is high)
      if (multiplier > 1.0) {
        minRoi = minRoi / multiplier;
      }
    }

    if (minRoi !== undefined && impact.predictedRoi < minRoi) {
      violations.push(
        `Predicted ROI ${impact.predictedRoi} is below minimum required ${minRoi.toFixed(2)} (adjusted for synergy).`
      );
    }

    if (guardrails?.minimumNetValue !== undefined && impact.netValue < guardrails.minimumNetValue) {
      violations.push(
        `Projected net value ${impact.netValue} is below minimum required ${guardrails.minimumNetValue}.`
      );
    }

    if (this.config.sharedTreasuryProvider) {
      const availableTreasury = this.config.sharedTreasuryProvider.getAvailableTreasury(budget.currency);
      const reservedTreasury = this.config.sharedTreasuryProvider.getReservedTreasury?.(budget.currency) ?? 0;
      const utilizationLimit = guardrails?.sharedTreasuryUtilizationLimit ?? 1;
      const usableTreasury = Math.max(0, availableTreasury * utilizationLimit - reservedTreasury);

      if (budget.amount > usableTreasury) {
        violations.push(
          `Requested amount ${budget.amount} exceeds shared treasury capacity ${usableTreasury} (${budget.currency}).`
        );
      }
    }

    if (this.config.downstreamCostProvider) {
      const downstreamCost = this.config.downstreamCostProvider.getProjectedDownstreamCost(message);
      const totalProjectedCost = impact.estimatedCost + downstreamCost;

      if (totalProjectedCost > budget.limit) {
        violations.push(
          `Total projected cost ${totalProjectedCost} exceeds budget limit ${budget.limit} after downstream costs.`
        );
      }
    }

    if (violations.length === 0) {
      return null;
    }

    const shouldBlock = nextState === NegotiationState.FINAL_COMMITMENT;
    return {
      accepted: false,
      reason: shouldBlock
        ? `Execution blocked due to economic limits: ${violations.join(' ')}`
        : `Renegotiation required due to economic limits: ${violations.join(' ')}`,
      action: shouldBlock ? 'BLOCK' : 'RENEGOTIATE',
      economicViolations: violations
    };
  }

  private evaluateConflicts(message: AgentCoordinationMessage, sessionId: string): TransitionResult | null {
    if (!this.config.conflictResolutionEngine) {
      return null;
    }

    const conflictCheck = this.config.conflictResolutionEngine.evaluate(message, sessionId);
    if (!conflictCheck.hasConflict) {
      this.config.auditSink?.record({
        domain: 'NEGOTIATION',
        action: 'CONFLICT_CHECK_CLEARED',
        outcome: 'SUCCESS',
        correlationId: message.correlationId,
        sessionId,
        messageId: message.messageId,
        actorId: message.sender.id
      });
      return null;
    }

    this.pausedSessions.add(sessionId);
    this.config.auditSink?.record({
      domain: 'REJECTION',
      action: 'CONFLICT_DETECTED',
      outcome: 'FAILURE',
      correlationId: message.correlationId,
      sessionId,
      messageId: message.messageId,
      actorId: message.sender.id,
      details: { conflicts: conflictCheck.conflicts }
    });
    this.config.renegotiationHandler?.trigger({
      sessionId,
      message,
      conflicts: conflictCheck.conflicts
    });

    return {
      accepted: false,
      reason: `Execution paused due to detected conflicts. Renegotiation required before proceeding.`,
      action: 'PAUSE_AND_RENEGOTIATE',
      paused: true,
      conflicts: conflictCheck.conflicts
    };
  }
}
