import { EntityId, ISODateString } from '../../../../shared/types/entity';

export interface CategoryRecord {
  readonly id: EntityId;
  readonly name: string;
  readonly normalizedName: string;
  readonly createdAt: ISODateString;
}
