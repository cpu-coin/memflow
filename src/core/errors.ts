export class MemFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidMemoryInputError extends MemFlowError {}

export class ConnectorNotReadyError extends MemFlowError {}

export class UnsupportedConnectorOperationError extends MemFlowError {}

export class SecuritySweepBlockError extends MemFlowError {}
