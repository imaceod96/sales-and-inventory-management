import { EntityId } from './entity';

export type TransactionMode = 'readonly' | 'readwrite';

export interface TransactionContext {
  get<T>(storeName: string, id: EntityId): Promise<T | undefined>;
  getAll<T>(storeName: string): Promise<T[]>;
  getAllByIndex<T>(storeName: string, indexName: string, value: IDBValidKey): Promise<T[]>;
  count(storeName: string): Promise<number>;
  countByIndex(storeName: string, indexName: string, value: IDBValidKey): Promise<number>;
  insert<T extends { id: EntityId }>(storeName: string, record: T): Promise<void>;
  upsert<T extends { id: EntityId }>(storeName: string, record: T): Promise<void>;
  remove(storeName: string, id: EntityId): Promise<void>;
  clear(storeName: string): Promise<void>;
}

export interface TransactionManager {
  runTransaction<TResult>(
    storeNames: readonly string[],
    mode: TransactionMode,
    work: (tx: TransactionContext) => Promise<TResult>
  ): Promise<TResult>;
}

export interface ReferentialIntegrityRule {
  readonly name: string;
  readonly sourceStore: string;
  readonly foreignKeyField: string;
  readonly targetStore: string;
  readonly preventTargetDeletion: boolean;
}

export interface Repository<TEntity, TId = EntityId> {
  findById(id: TId): Promise<TEntity | undefined>;
  findAll(): Promise<TEntity[]>;
  count(): Promise<number>;
}
