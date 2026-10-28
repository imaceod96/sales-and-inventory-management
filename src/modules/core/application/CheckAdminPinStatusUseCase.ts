import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { AdminPinCredentialsMetadata, AdminPinLockoutMetadata } from '../domain/entities/AdminPinRecord';

export interface CheckAdminPinStatusResult {
  readonly isConfigured: boolean;
  readonly isLockedOut: boolean;
  readonly remainingLockoutSeconds: number;
}

export class CheckAdminPinStatusUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(): Promise<CheckAdminPinStatusResult> {
    const timestamp = nowISO();

    return this.transactionManager.runTransaction(
      [StoreName.SYSTEM_METADATA],
      'readonly',
      async (tx) => {
        const creds = await tx.get<AdminPinCredentialsMetadata>(
          StoreName.SYSTEM_METADATA,
          'admin_pin_credentials'
        );

        const lockout = await tx.get<AdminPinLockoutMetadata>(
          StoreName.SYSTEM_METADATA,
          'admin_pin_lockout'
        );

        const isConfigured = Boolean(creds);
        let isLockedOut = false;
        let remainingLockoutSeconds = 0;

        if (lockout && lockout.lockedUntilISO) {
          const lockedUntil = new Date(lockout.lockedUntilISO).getTime();
          const nowTime = new Date(timestamp).getTime();
          if (nowTime < lockedUntil) {
            isLockedOut = true;
            remainingLockoutSeconds = Math.ceil((lockedUntil - nowTime) / 1000);
          }
        }

        return {
          isConfigured,
          isLockedOut,
          remainingLockoutSeconds,
        };
      }
    );
  }
}
