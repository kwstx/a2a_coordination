# A2A Coordination Layer - API Service

This service provides a standalone, API-driven interface for Agent-to-Agent (A2A) coordination. It allows autonomous agents to negotiate, formalize contracts, validate policies, and settle outcomes without being tied to a specific agent framework or cloud provider.

## Key Features

- **Negotiation Engine**: State-machine based negotiation (Offer -> Counteroffer -> Acceptance -> Commitment).
- **Contract Management**: Immutable contract creation and lifecycle tracking.
- **Policy Validation**: Real-time checking of messages against economic, compliance, and governance rules.
- **Conflict Resolution**: Detection and resolution of resource overlaps or contradictory task scopes.
- **Settlement & Reputation**: Automated reward release, penalty application, and reputation updates.

## API Endpoints

### Negotiation
- `POST /api/v1/negotiate`: Advance a negotiation session.
- `GET /api/v1/negotiate/:sessionId`: Retrieve current negotiation state and history.

### Contracts
- `POST /api/v1/contracts`: Convert a finalized negotiation into an active contract.
- `GET /api/v1/contracts/:contractId`: Retrieve contract details.

### Validation
- `POST /api/v1/validate`: Validate a message against active coordination policies.

### Execution & Settlement
- `POST /api/v1/execute/confirm`: Confirm task completion and trigger settlement (budget/reputation).

### Dispute Resolution
- `POST /api/v1/disputes`: Resolve conflicts between agents or sessions.

## Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start the Service**:
   ```bash
   npm start
   ```
   The service will be available at `http://localhost:3000`.

3. **API Documentation**:
   Refer to `docs/openapi_spec.yaml` for the full OpenAPI 3.0 specification.

## Compatibility

The API uses standard JSON payloads and is compatible with any agent framework (OpenAI Swarm, LangChain, Autogen, PydanticAI) as long as they can perform HTTP requests and wrap their communication in the `AgentCoordinationMessage` schema.
