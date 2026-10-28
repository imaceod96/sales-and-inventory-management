export class DomainError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

export class DuplicateRecordError extends DomainError {
  constructor(entityName: string, fieldDescription: string) {
    super(
      'DUPLICATE_RECORD',
      `Ya existe un registro en ${entityName} con el mismo valor único (${fieldDescription}).`
    );
  }
}

export class EntityNotFoundError extends DomainError {
  constructor(entityName: string, id: string) {
    super('ENTITY_NOT_FOUND', `No se encontró el registro solicitado en ${entityName} (${id}).`);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message);
  }
}

export class ReferentialIntegrityError extends DomainError {
  constructor(message: string) {
    super('REFERENTIAL_INTEGRITY_VIOLATION', message);
  }
}

export class UnauthorizedOperationError extends DomainError {
  constructor(operationDescription: string) {
    super(
      'UNAUTHORIZED_OPERATION',
      `El rol actual no cuenta con autorización para ejecutar: ${operationDescription}.`
    );
  }
}

export class PersistenceError extends DomainError {
  constructor(message: string) {
    super('PERSISTENCE_ERROR', message);
  }
}

export class BackupValidationError extends DomainError {
  constructor(message: string) {
    super('BACKUP_VALIDATION_ERROR', message);
  }
}
