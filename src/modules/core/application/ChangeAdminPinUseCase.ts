import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { hashPinPBKDF2, validatePinFormat, verifyPinPBKDF2 } from '../../../shared/lib/security/pinCrypto';
import { ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../domain/entities/OperationLog';
import { AdminPinCredentialsMetadata } from '../domain/entities/AdminPinRecord';
import { sessionElevationService } from '../../../shared/lib/security/SessionElevationService';

export interface ChangeAdminPinInput {
  readonly currentPin: string;
  readonly newPin: string;
  readonly confirmNewPin: string;
}

export interface ChangeAdminPinResult {
  readonly success: boolean;
}

export class ChangeAdminPinUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: ChangeAdminPinInput
  ): Promise<ChangeAdminPinResult> {
    assertPermission(
      actor,
      Permission.VIEW_SETTINGS,
      'cambiar el PIN administrativo'
    );

    const cleanCurrent = validatePinFormat(input.currentPin);
    const cleanNew = validatePinFormat(input.newPin);
    const cleanConfirm = validatePinFormat(input.confirmNewPin);

    if (cleanNew !== cleanConfirm) {
      throw new ValidationError('La confirmación del nuevo PIN no coincide con el nuevo PIN ingresado.');
    }

    const timestamp = nowISO();

    // 1. Obtener credenciales actuales de IndexedDB
    let creds: AdminPinCredentialsMetadata | undefined;
    await this.transactionManager.runTransaction(
      [StoreName.SYSTEM_METADATA],
      'readonly',
      async (tx) => {
        creds = await tx.get<AdminPinCredentialsMetadata>(
          StoreName.SYSTEM_METADATA,
          'admin_pin_credentials'
        );
      }
    );

    if (!creds) {
      throw new ValidationError(
        'No existe un PIN de administrador configurado previamente.'
      );
    }

    // 2. Verificar PIN actual mediante PBKDF2 FUERA de la transacción
    const isValidCurrent = await verifyPinPBKDF2(
      cleanCurrent,
      creds.hashHex,
      creds.saltHex,
      creds.iterations
    );

    if (!isValidCurrent) {
      throw new ValidationError('El PIN actual de administrador es incorrecto.');
    }

    // 3. Generar nuevo salt y hash para el nuevo PIN FUERA de la transacción
    const hashedNew = await hashPinPBKDF2(cleanNew);

    // 4. Persistir cambios de forma atómica en IndexedDB
    return this.transactionManager.runTransaction(
      [StoreName.SYSTEM_METADATA, StoreName.OPERATION_HISTORY],
      'readwrite',
      async (tx) => {
        const updatedCreds: AdminPinCredentialsMetadata = {
          id: 'admin_pin_credentials',
          hashHex: hashedNew.hashHex,
          saltHex: hashedNew.saltHex,
          iterations: hashedNew.iterations,
          createdAt: creds?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };

        await tx.upsert(StoreName.SYSTEM_METADATA, updatedCreds);

        const auditEntry: OperationLogEntry = {
          id: generateEntityId(),
          module: OperationModule.CORE,
          action: 'UPDATE_ADMIN_PIN',
          entityType: 'Security',
          entityId: 'admin_pin_credentials',
          actorRole: actor.role,
          description: 'Modificación del PIN administrativo de 6 dígitos realizada con éxito desde Ajustes.',
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        // Revocar la elevación actual al cambiar el PIN
        sessionElevationService.revokeAll();

        return { success: true };
      }
    );
  }
}
