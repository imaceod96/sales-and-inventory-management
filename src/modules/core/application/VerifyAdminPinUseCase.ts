import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { CriticalActionScope, sessionElevationService } from '../../../shared/lib/security/SessionElevationService';
import { validatePinFormat, verifyPinPBKDF2 } from '../../../shared/lib/security/pinCrypto';
import { ValidationError } from '../../../shared/types/errors';
import { SessionActor, UserRole } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../domain/entities/OperationLog';
import { AdminPinCredentialsMetadata, AdminPinLockoutMetadata } from '../domain/entities/AdminPinRecord';


export interface VerifyAdminPinInput {
  readonly pin: string;
  readonly scope?: 'SESSION_ELEVATION' | CriticalActionScope;
}

export interface VerifyAdminPinResult {
  readonly success: boolean;
  readonly elevationToken?: string;
  readonly criticalToken?: string;
}

export class VerifyAdminPinUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: VerifyAdminPinInput
  ): Promise<VerifyAdminPinResult> {
    const cleanPin = validatePinFormat(input.pin);
    const timestamp = nowISO();

    // 1. Obtener credenciales y estado de bloqueo de IndexedDB
    let lockout: AdminPinLockoutMetadata | undefined;
    let creds: AdminPinCredentialsMetadata | undefined;

    await this.transactionManager.runTransaction(
      [StoreName.SYSTEM_METADATA],
      'readonly',
      async (tx) => {
        lockout = await tx.get<AdminPinLockoutMetadata>(
          StoreName.SYSTEM_METADATA,
          'admin_pin_lockout'
        );
        creds = await tx.get<AdminPinCredentialsMetadata>(
          StoreName.SYSTEM_METADATA,
          'admin_pin_credentials'
        );
      }
    );

    // 2. Verificar estado de bloqueo activo
    if (lockout && lockout.lockedUntilISO) {
      const lockedUntil = new Date(lockout.lockedUntilISO).getTime();
      const nowTime = new Date(timestamp).getTime();
      if (nowTime < lockedUntil) {
        const secondsRemaining = Math.ceil((lockedUntil - nowTime) / 1000);
        throw new ValidationError(
          `Acceso bloqueado temporalmente por demasiados intentos fallidos. Inténtalo de nuevo en ${secondsRemaining} segundo(s).`
        );
      }
    }

    if (!creds) {
      throw new ValidationError(
        'El PIN administrativo no ha sido configurado. Por favor, realiza la configuración inicial.'
      );
    }

    // 3. Ejecutar cálculo criptográfico PBKDF2 FUERA de la transacción para no expirar el contexto de IndexedDB
    const isValid = await verifyPinPBKDF2(
      cleanPin,
      creds.hashHex,
      creds.saltHex,
      creds.iterations
    );

    // 4. Persistir resultado y auditoría en una transacción readwrite atómica
    let errorMessageToThrow: string | null = null;

    await this.transactionManager.runTransaction(
      [StoreName.SYSTEM_METADATA, StoreName.OPERATION_HISTORY],
      'readwrite',
      async (tx) => {
        const currentLockout = await tx.get<AdminPinLockoutMetadata>(
          StoreName.SYSTEM_METADATA,
          'admin_pin_lockout'
        );

        if (!isValid) {
          const currentFailed = (currentLockout?.failedAttempts ?? 0) + 1;
          let newLockedUntilISO: string | null = null;

          if (currentFailed >= 5) {
            const lockDate = new Date(new Date(timestamp).getTime() + 5 * 60 * 1000);
            newLockedUntilISO = lockDate.toISOString();
          }

          const updatedLockout: AdminPinLockoutMetadata = {
            id: 'admin_pin_lockout',
            failedAttempts: currentFailed,
            lockedUntilISO: newLockedUntilISO,
            updatedAt: timestamp,
          };

          await tx.upsert(StoreName.SYSTEM_METADATA, updatedLockout);

          const auditEntry: OperationLogEntry = {
            id: generateEntityId(),
            module: OperationModule.CORE,
            action: 'ADMIN_PIN_ATTEMPT_FAILED',
            entityType: 'Security',
            entityId: 'admin_pin_credentials',
            actorRole: actor.role,
            description: `Intento fallido de elevación a Administrador (intento ${currentFailed}/5).${newLockedUntilISO ? ' Bloqueo temporal activado por 5 minutos.' : ''}`,
            createdAt: timestamp,
          };
          await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

          if (newLockedUntilISO) {
            errorMessageToThrow =
              'PIN incorrecto. Se ha alcanzado el límite máximo de 5 intentos fallidos. El acceso se ha bloqueado por 5 minutos.';
          } else {
            errorMessageToThrow = `PIN de administrador incorrecto. Llevas ${currentFailed} de 5 intentos permitidos.`;
          }
          return;
        }

        const resetLockout: AdminPinLockoutMetadata = {
          id: 'admin_pin_lockout',
          failedAttempts: 0,
          lockedUntilISO: null,
          updatedAt: timestamp,
        };
        await tx.upsert(StoreName.SYSTEM_METADATA, resetLockout);

        const successAudit: OperationLogEntry = {
          id: generateEntityId(),
          module: OperationModule.CORE,
          action: 'ADMIN_PIN_VERIFIED_SUCCESS',
          entityType: 'Security',
          entityId: 'admin_pin_credentials',
          actorRole: UserRole.ADMIN,
          description: 'Validación de PIN de 6 dígitos correcta. Elevación de sesión a Administrador concedida.',
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, successAudit);
      }
    );

    if (errorMessageToThrow) {
      throw new ValidationError(errorMessageToThrow);
    }

    if (input.scope === 'RESTORE_BACKUP' || input.scope === 'RECTIFY_WORKDAY') {
      const criticalToken = sessionElevationService.issueCriticalToken(actor, input.scope);
      return { success: true, criticalToken };
    }

    const elevationToken = sessionElevationService.registerElevatedSession(actor.label);
    return { success: true, elevationToken };
  }
}

