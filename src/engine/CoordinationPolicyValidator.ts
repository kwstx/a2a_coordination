
import { AgentCoordinationMessage } from '../schema/MessageSchema';
import { AuditSink } from '../audit/ImmutableAuditLog';
import {
    CoordinationPolicy,
    ValidationResponse,
    PolicyViolation,
    ViolationSeverity,
    EconomicRules,
    ComplianceRules,
    GovernanceRules
} from '../schema/PolicySchema';

/**
 * CoordinationPolicyValidator evaluates negotiation messages against 
 * business rules, legal constraints, and compliance standards.
 */
export class CoordinationPolicyValidator {
    public constructor(private readonly auditSink?: AuditSink) { }

    /**
     * Evaluates a message against a specific policy.
     * @param message The message to validate
     * @param policy The policy to check against
     * @returns Detailed validation response including any violations
     */
    public evaluate(
        message: AgentCoordinationMessage,
        policy: CoordinationPolicy
    ): ValidationResponse {
        const violations: PolicyViolation[] = [];
        const sessionId = message.correlationId ?? message.messageId;

        // Create a clone for potential modifications
        const modifiedMessage: AgentCoordinationMessage = JSON.parse(JSON.stringify(message));
        let wasModified = false;

        this.auditSink?.record({
            domain: 'VALIDATION',
            action: 'VALIDATION_STARTED',
            outcome: 'INFO',
            correlationId: message.correlationId,
            sessionId,
            messageId: message.messageId,
            actorId: message.sender.id,
            details: { policyId: policy.id }
        });

        // Validate different policy domains
        if (policy.economic) {
            if (this.checkEconomic(message, modifiedMessage, policy.economic, policy.id, violations)) {
                wasModified = true;
            }
        }

        if (policy.compliance) {
            if (this.checkCompliance(message, modifiedMessage, policy.compliance, policy.id, violations)) {
                wasModified = true;
            }
        }

        if (policy.governance) {
            if (this.checkGovernance(message, modifiedMessage, policy.governance, policy.id, violations)) {
                wasModified = true;
            }
        }

        const hasReject = violations.some(v => v.severity === ViolationSeverity.REJECT);
        for (const violation of violations) {
            this.auditSink?.record({
                domain: violation.severity === ViolationSeverity.REJECT ? 'REJECTION' : 'VALIDATION',
                action: 'VALIDATION_VIOLATION',
                outcome: violation.severity === ViolationSeverity.REJECT ? 'FAILURE' : 'WARNING',
                correlationId: message.correlationId,
                sessionId,
                messageId: message.messageId,
                actorId: message.sender.id,
                details: {
                    policyId: violation.policyId,
                    ruleId: violation.ruleId,
                    severity: violation.severity,
                    path: violation.path,
                    message: violation.message
                }
            });
        }

        this.auditSink?.record({
            domain: 'VALIDATION',
            action: 'VALIDATION_COMPLETED',
            outcome: hasReject ? 'FAILURE' : (violations.length > 0 ? 'WARNING' : 'SUCCESS'),
            correlationId: message.correlationId,
            sessionId,
            messageId: message.messageId,
            actorId: message.sender.id,
            details: {
                policyId: policy.id,
                isValid: !hasReject,
                violationCount: violations.length,
                modified: wasModified
            }
        });

        return {
            isValid: !hasReject,
            violations,
            modifiedMessage: wasModified ? modifiedMessage : undefined,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Checks economic constraints like ROI and Budget.
     */
    private checkEconomic(
        original: AgentCoordinationMessage,
        modified: AgentCoordinationMessage,
        rules: EconomicRules,
        policyId: string,
        violations: PolicyViolation[]
    ): boolean {
        let changed = false;
        const impact = original.content.impact;
        const resources = original.content.resources;

        // ROI Check
        if (rules.minRoi !== undefined && impact.predictedRoi < rules.minRoi) {
            violations.push({
                policyId,
                ruleId: 'ECON_MIN_ROI',
                severity: ViolationSeverity.REJECT,
                message: `Predicted ROI ${impact.predictedRoi} is below minimum required ${rules.minRoi}.`,
                path: 'content.impact.predictedRoi'
            });
        }

        // Budget Cap Check
        if (rules.maxBudget !== undefined && resources.budget.amount > rules.maxBudget) {
            violations.push({
                policyId,
                ruleId: 'ECON_MAX_BUDGET',
                severity: ViolationSeverity.MODIFY,
                message: `Budget ${resources.budget.amount} exceeds policy cap of ${rules.maxBudget}. Clipping to limit.`,
                suggestedValue: rules.maxBudget,
                path: 'content.resources.budget.amount'
            });
            modified.content.resources.budget.amount = rules.maxBudget;
            changed = true;
        }

        // Currency Check
        if (rules.allowedCurrencies && !rules.allowedCurrencies.includes(resources.budget.currency)) {
            violations.push({
                policyId,
                ruleId: 'ECON_CURRENCY_RESTRICTION',
                severity: ViolationSeverity.REJECT,
                message: `Currency ${resources.budget.currency} is not in the allowed list: ${rules.allowedCurrencies.join(', ')}.`,
                path: 'content.resources.budget.currency'
            });
        }

        return changed;
    }

    /**
     * Checks compliance constraints like Risk and Task types.
     */
    private checkCompliance(
        original: AgentCoordinationMessage,
        modified: AgentCoordinationMessage,
        rules: ComplianceRules,
        policyId: string,
        violations: PolicyViolation[]
    ): boolean {
        const risks = original.content.risks;
        const tasks = original.content.scope.tasks;

        // Risk Score Check
        if (rules.maxRiskScore !== undefined && risks.riskScore > rules.maxRiskScore) {
            violations.push({
                policyId,
                ruleId: 'COMP_MAX_RISK',
                severity: ViolationSeverity.REJECT,
                message: `Risk score ${risks.riskScore} exceeds maximum allowed ${rules.maxRiskScore}.`,
                path: 'content.risks.riskScore'
            });
        }

        // Prohibited Keywords Check (Legal/Compliance)
        if (rules.prohibitedTaskKeywords) {
            for (const task of tasks) {
                for (const keyword of rules.prohibitedTaskKeywords) {
                    if (task.toLowerCase().includes(keyword.toLowerCase())) {
                        violations.push({
                            policyId,
                            ruleId: 'COMP_PROHIBITED_TASK',
                            severity: ViolationSeverity.REJECT,
                            message: `Task "${task}" contains prohibited keyword "${keyword}".`,
                            path: 'content.scope.tasks'
                        });
                    }
                }
            }
        }

        return false;
    }

    /**
     * Checks governance constraints like Approved Agents and Metadata.
     */
    private checkGovernance(
        original: AgentCoordinationMessage,
        modified: AgentCoordinationMessage,
        rules: GovernanceRules,
        policyId: string,
        violations: PolicyViolation[]
    ): boolean {
        // Approved Agents Check
        if (rules.approvedAgents && !rules.approvedAgents.includes(original.sender.id)) {
            violations.push({
                policyId,
                ruleId: 'GOV_UNAUTHORIZED_AGENT',
                severity: ViolationSeverity.REJECT,
                message: `Agent ${original.sender.id} is not on the approved list.`,
                path: 'sender.id'
            });
        }

        // Required Metadata Check
        if (rules.requiredMetadataFields) {
            const metadata = original.metadata || {};
            for (const field of rules.requiredMetadataFields) {
                if (!(field in metadata)) {
                    violations.push({
                        policyId,
                        ruleId: 'GOV_MISSING_METADATA',
                        severity: ViolationSeverity.REJECT,
                        message: `Missing required metadata field: ${field}.`,
                        path: 'metadata'
                    });
                }
            }
        }

        // Scope Complexity Check
        if (rules.maxScopeTasks !== undefined && original.content.scope.tasks.length > rules.maxScopeTasks) {
            violations.push({
                policyId,
                ruleId: 'GOV_SCOPE_COMPLEXITY',
                severity: ViolationSeverity.ADVISE,
                message: `Task count (${original.content.scope.tasks.length}) is high. Policy prefers fewer than ${rules.maxScopeTasks} tasks per agreement.`,
                path: 'content.scope.tasks'
            });
        }

        return false;
    }
}
