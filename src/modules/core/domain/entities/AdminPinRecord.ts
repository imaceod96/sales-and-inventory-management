import { ISODateString } from '../../../../shared/types/entity';

export interface AdminPinCredentialsMetadata {
  readonly id: 'admin_pin_credentials';
  readonly hashHex: string;
  readonly saltHex: string;
  readonly iterations: number;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

export interface AdminPinLockoutMetadata {
  readonly id: 'admin_pin_lockout';
  readonly failedAttempts: number;
  readonly lockedUntilISO: ISODateString | null;
  readonly updatedAt: ISODateString;
}
