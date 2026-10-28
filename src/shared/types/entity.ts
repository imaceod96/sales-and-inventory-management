export type EntityId = string;

export type ISODateString = string;

export interface BaseEntity {
  readonly id: EntityId;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}
