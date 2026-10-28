import { EntityId, ISODateString } from '../../../../shared/types/entity';
import { UserRole } from '../../../../shared/types/permissions';

export enum OperationModule {
  CORE = 'CORE',
  WAREHOUSE = 'WAREHOUSE',
  SALES = 'SALES',
}

export interface OperationLogEntry {
  readonly id: EntityId;
  readonly module: OperationModule;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: EntityId | null;
  readonly actorRole: UserRole;
  readonly description: string;
  readonly createdAt: ISODateString;
}
