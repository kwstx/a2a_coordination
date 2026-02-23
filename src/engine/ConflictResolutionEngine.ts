import { AgentCoordinationMessage } from '../schema/MessageSchema';

export enum ConflictType {
  OVERLAPPING_RESOURCE_ALLOCATION = 'OVERLAPPING_RESOURCE_ALLOCATION',
  CONTRADICTORY_TASK_SCOPE = 'CONTRADICTORY_TASK_SCOPE',
  INCOMPATIBLE_DEADLINE = 'INCOMPATIBLE_DEADLINE'
}

export interface ConflictDetail {
  type: ConflictType;
  message: string;
  relatedSessionId: string;
  relatedMessageId: string;
  conflictingAgentIds: string[];
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflicts: ConflictDetail[];
}

export interface ActiveAgreement {
  sessionId: string;
  message: AgentCoordinationMessage;
}

export interface ConflictResolutionConfig {
  maxDeadlineSkewHours?: number;
  contradictoryTaskPairs?: Array<{ a: string; b: string }>;
}

export class ConflictResolutionEngine {
  private readonly agreements = new Map<string, ActiveAgreement>();
  private readonly maxDeadlineSkewMs: number;
  private readonly contradictoryTaskPairs: Array<{ a: string; b: string }>;

  public constructor(config?: ConflictResolutionConfig) {
    this.maxDeadlineSkewMs = (config?.maxDeadlineSkewHours ?? 24) * 60 * 60 * 1000;
    this.contradictoryTaskPairs = config?.contradictoryTaskPairs ?? [];
  }

  public evaluate(message: AgentCoordinationMessage, sessionId: string): ConflictCheckResult {
    const conflicts: ConflictDetail[] = [];
    const candidateWindow = this.getWindow(message);

    for (const agreement of this.agreements.values()) {
      if (agreement.sessionId === sessionId) {
        continue;
      }

      const current = agreement.message;
      const currentWindow = this.getWindow(current);
      const overlappingWindows = candidateWindow.start < currentWindow.end
        && currentWindow.start < candidateWindow.end;

      if (!overlappingWindows) {
        continue;
      }

      if (this.hasResourceOverlap(message, current)) {
        conflicts.push({
          type: ConflictType.OVERLAPPING_RESOURCE_ALLOCATION,
          message: 'Resource allocations overlap for the same active time window.',
          relatedSessionId: agreement.sessionId,
          relatedMessageId: current.messageId,
          conflictingAgentIds: [message.sender.id, current.sender.id]
        });
      }

      if (this.hasContradictoryScope(message, current)) {
        conflicts.push({
          type: ConflictType.CONTRADICTORY_TASK_SCOPE,
          message: 'Task scopes contain contradictory directives.',
          relatedSessionId: agreement.sessionId,
          relatedMessageId: current.messageId,
          conflictingAgentIds: [message.sender.id, current.sender.id]
        });
      }

      if (this.hasIncompatibleDeadlines(message, current)) {
        conflicts.push({
          type: ConflictType.INCOMPATIBLE_DEADLINE,
          message: 'Deadlines are incompatible for overlapping scope.',
          relatedSessionId: agreement.sessionId,
          relatedMessageId: current.messageId,
          conflictingAgentIds: [message.sender.id, current.sender.id]
        });
      }
    }

    return { hasConflict: conflicts.length > 0, conflicts };
  }

  public register(message: AgentCoordinationMessage, sessionId: string): void {
    this.agreements.set(sessionId, { sessionId, message });
  }

  public unregister(sessionId: string): void {
    this.agreements.delete(sessionId);
  }

  private hasResourceOverlap(a: AgentCoordinationMessage, b: AgentCoordinationMessage): boolean {
    const aResourceKeys = this.resourceKeys(a);
    const bResourceKeys = this.resourceKeys(b);

    for (const key of aResourceKeys) {
      if (bResourceKeys.has(key)) {
        return true;
      }
    }

    return false;
  }

  private hasContradictoryScope(a: AgentCoordinationMessage, b: AgentCoordinationMessage): boolean {
    const aTasks = a.content.scope.tasks;
    const bTasks = b.content.scope.tasks;

    for (const taskA of aTasks) {
      for (const taskB of bTasks) {
        if (this.isContradictoryPair(taskA, taskB)) {
          return true;
        }
      }
    }

    return false;
  }

  private hasIncompatibleDeadlines(a: AgentCoordinationMessage, b: AgentCoordinationMessage): boolean {
    if (!this.hasPotentialScopeOverlap(a, b)) {
      return false;
    }

    const deadlineA = Date.parse(a.content.deadline);
    const deadlineB = Date.parse(b.content.deadline);
    if (!Number.isFinite(deadlineA) || !Number.isFinite(deadlineB)) {
      return false;
    }

    return Math.abs(deadlineA - deadlineB) > this.maxDeadlineSkewMs;
  }

  private hasPotentialScopeOverlap(a: AgentCoordinationMessage, b: AgentCoordinationMessage): boolean {
    const normalizedA = new Set(a.content.scope.tasks.map(task => this.normalize(task)));
    for (const task of b.content.scope.tasks) {
      if (normalizedA.has(this.normalize(task))) {
        return true;
      }
    }
    return false;
  }

  private resourceKeys(message: AgentCoordinationMessage): Set<string> {
    const keys = new Set<string>();
    const { budget, compute, storage } = message.content.resources;

    keys.add(`budget:${budget.currency.toUpperCase()}`);

    if (compute?.type) {
      keys.add(`compute:${this.normalize(compute.type)}`);
    }

    if (storage?.durability) {
      keys.add(`storage:${this.normalize(storage.durability)}`);
    }

    return keys;
  }

  private isContradictoryPair(taskA: string, taskB: string): boolean {
    const normalizedA = this.normalize(taskA);
    const normalizedB = this.normalize(taskB);

    for (const pair of this.contradictoryTaskPairs) {
      const left = this.normalize(pair.a);
      const right = this.normalize(pair.b);
      if ((normalizedA.includes(left) && normalizedB.includes(right))
        || (normalizedA.includes(right) && normalizedB.includes(left))) {
        return true;
      }
    }

    const aNegative = this.hasNegativeAction(normalizedA);
    const bNegative = this.hasNegativeAction(normalizedB);
    if (aNegative === bNegative) {
      return false;
    }

    const tokensA = this.contentTokens(normalizedA);
    const tokensB = this.contentTokens(normalizedB);

    for (const token of tokensA) {
      if (tokensB.has(token)) {
        return true;
      }
    }

    return false;
  }

  private hasNegativeAction(text: string): boolean {
    const negatives = ['disable', 'deny', 'decrease', 'reduce', 'remove', 'block', 'reject', 'cancel'];
    for (const token of negatives) {
      if (text.includes(token)) {
        return true;
      }
    }
    return false;
  }

  private contentTokens(text: string): Set<string> {
    const actionWords = new Set([
      'enable', 'disable', 'allow', 'deny', 'increase', 'decrease', 'reduce', 'remove', 'block',
      'reject', 'cancel', 'build', 'update', 'migrate', 'create', 'delete', 'expand'
    ]);

    const words = text.split(/\s+/).filter(word => word.length > 3 && !actionWords.has(word));
    return new Set(words);
  }

  private normalize(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private getWindow(message: AgentCoordinationMessage): { start: number; end: number } {
    const start = Date.parse(message.timestamp);
    const end = Date.parse(message.content.deadline);
    const safeStart = Number.isFinite(start) ? start : 0;
    const safeEnd = Number.isFinite(end) ? end : Number.MAX_SAFE_INTEGER;
    return { start: safeStart, end: safeEnd };
  }
}
