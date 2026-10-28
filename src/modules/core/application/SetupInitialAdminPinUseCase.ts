import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { hashPinPBKDF2, validatePinFormat } from '../../../shared/lib/security/pinCrypto';
import { ValidationError } from '../../../shared/types/errors';
import { SessionActor, UserRole } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../domain/entities/OperationLog';
import { AdminPinCredentialsMetadata } from '../domain/entities/AdminPinRecord';

import { sessionElevationService } from '../../../shared/lib/security/SessionElevationService';

export interface SetupInitialAdminPinInput {
  readonly pin: string;
  readonly confirmPin: string;
}

export interface SetupInitialAdminPinResult {
  readonly success: boolean;
  readonly elevationToken?: string;
}

export class SetupInitialAdminPinUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: SetupInitialAdminPinInput
  ): Promise<SetupInitialAdminPinResult> {
    const cleanPin = validatePinFormat(input.pin);
    const cleanConfirm = validatePinFormat(input.confirmPin);

    if (cleanPin !== cleanConfirm) {
      throw new ValidationError('La confirmación del PIN no coincide con el PIN ingresado.');
    }

    const timestamp = nowISO();

    // 1. Verificar previamente si ya existe un PIN
    let existingCreds: AdminPinCredentialsMetadata | undefined;
    await this.transactionManager.runTransaction(
      [StoreName.SYSTEM_METADATA],
      'readonly',
      async (tx) => {
        existingCreds = await tx.get<AdminPinCredentialsMetadata>(
          StoreName.SYSTEM_METADATA,
          'admin_pin_credentials'
        );
      }
    );

    if (existingCreds) {
      throw new ValidationError(
        'El PIN administrativo ya se encuentra configurado. No se permite sobrescribirlo sin autenticación.'
      );
    }

    // 2. Derivar hash seguro mediante PBKDF2 FUERA de la transacción IndexedDB
    const hashed = await hashPinPBKDF2(cleanPin);

    // 3. Persistir registro de credenciales y auditoría
    return this.transactionManager.runTransaction(
      [StoreName.SYSTEM_METADATA, StoreName.OPERATION_HISTORY],
      'readwrite',
      async (tx) => {
        const doubleCheck = await tx.get<AdminPinCredentialsMetadata>(
          StoreName.SYSTEM_METADATA,
          'admin_pin_credentials'
        );
        if (doubleCheck) {
          throw new ValidationError(
            'El PIN administrativo ya se encuentra configurado. No se permite sobrescribirlo sin autenticación.'
          );
        }

        const newCreds: AdminPinCredentialsMetadata = {
          id: 'admin_pin_credentials',
          hashHex: hashed.hashHex,
          saltHex: hashed.saltHex,
          iterations: hashed.iterations,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        await tx.insert(StoreName.SYSTEM_METADATA, newCreds);

        const auditEntry: OperationLogEntry = {
          id: generateEntityId(),
          module: OperationModule.CORE,
          action: 'SETUP_INITIAL_ADMIN_PIN',
          entityType: 'Security',
          entityId: 'admin_pin_credentials',
          actorRole: UserRole.ADMIN,
          description: 'Configuración inicial del PIN administrativo de 6 dígitos realizada correctamente con derivación PBKDF2 SHA-256.',
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        const elevationToken = sessionElevationService.registerElevatedSession(actor.label);
        return { success: true, elevationToken };
      }
    );
  }
}
