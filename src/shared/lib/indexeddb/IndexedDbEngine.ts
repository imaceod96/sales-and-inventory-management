import { EntityId } from '../../types/entity';
import {
  DuplicateRecordError,
  PersistenceError,
  ReferentialIntegrityError,
} from '../../types/errors';
import {
  ReferentialIntegrityRule,
  TransactionContext,
  TransactionManager,
  TransactionMode,
} from '../../types/repository';
import { nowISO } from '../../utils/date';
import {
  ALL_BUSINESS_STORES,
  DATABASE_MIGRATIONS,
  DATABASE_NAME,
  DATABASE_VERSION,
  REFERENTIAL_INTEGRITY_RULES,
  StoreName,
} from './schema';

export interface SystemMetadataRecord {
  readonly id: string;
  readonly schemaVersion: number;
  readonly initializedAt: string;
  readonly lastBackupAt: string | null;
  readonly updatedAt: string;
}

function wrapRequest<T>(request: IDBRequest<T>, errorContext: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      const domError = request.error;
      if (domError?.name === 'ConstraintError') {
        reject(new DuplicateRecordError(errorContext, domError.message || 'clave única'));
        return;
      }
      reject(
        new PersistenceError(
          `Error en almacenamiento local (${errorContext}): ${domError?.message ?? 'desconocido'}`
        )
      );
    };
  });
}

export class IndexedDbEngine implements TransactionManager {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private isDurableStorage = false;
  private readonly integrityRules: readonly ReferentialIntegrityRule[];

  constructor(integrityRules: readonly ReferentialIntegrityRule[] = REFERENTIAL_INTEGRITY_RULES) {
    this.integrityRules = integrityRules;
  }

  public async initialize(): Promise<void> {
    await this.getDatabase();
    await this.requestDurableStorage();
    await this.ensureMetadataInitialized();
  }

  public getDurabilityStatus(): boolean {
    return this.isDurableStorage;
  }

  public getSchemaVersion(): number {
    return DATABASE_VERSION;
  }

  private async requestDurableStorage(): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
        const persisted = await navigator.storage.persist();
        this.isDurableStorage = persisted;
      }
    } catch {
      this.isDurableStorage = false;
    }
  }

  public getDatabase(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    if (typeof indexedDB === 'undefined') {
      return Promise.reject(
        new PersistenceError('IndexedDB no está disponible en este entorno de ejecución.')
      );
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const openRequest = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      openRequest.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = openRequest.result;
        const upgradeTx = openRequest.transaction;
        if (!upgradeTx) return;

        const oldVersion = event.oldVersion;
        const pendingMigrations = DATABASE_MIGRATIONS.filter((m) => m.version > oldVersion).sort(
          (a, b) => a.version - b.version
        );

        for (const migration of pendingMigrations) {
          migration.upgrade(db, upgradeTx);
        }
      };

      openRequest.onsuccess = () => {
        const db = openRequest.result;
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };

      openRequest.onerror = () => {
        this.dbPromise = null;
        reject(
          new PersistenceError(
            `No fue posible abrir la base de datos local: ${openRequest.error?.message ?? 'error desconocido'}`
          )
        );
      };

      openRequest.onblocked = () => {
        this.dbPromise = null;
        reject(
          new PersistenceError(
            'La actualización de la base de datos local está bloqueada por otra instancia abierta.'
          )
        );
      };
    });

    return this.dbPromise;
  }

  private async ensureMetadataInitialized(): Promise<void> {
    await this.runTransaction([StoreName.SYSTEM_METADATA], 'readwrite', async (tx) => {
      const existing = await tx.get<SystemMetadataRecord>(StoreName.SYSTEM_METADATA, 'installation');
      const timestamp = nowISO();
      if (!existing) {
        await tx.insert<SystemMetadataRecord>(StoreName.SYSTEM_METADATA, {
          id: 'installation',
          schemaVersion: DATABASE_VERSION,
          initializedAt: timestamp,
          lastBackupAt: null,
          updatedAt: timestamp,
        });
      } else if (existing.schemaVersion !== DATABASE_VERSION) {
        await tx.upsert<SystemMetadataRecord>(StoreName.SYSTEM_METADATA, {
          ...existing,
          schemaVersion: DATABASE_VERSION,
          updatedAt: timestamp,
        });
      }
    });
  }

  private expandRequiredStores(
    storeNames: readonly string[],
    mode: TransactionMode
  ): string[] {
    const expanded = new Set<string>(storeNames);
    if (mode === 'readwrite') {
      for (const rule of this.integrityRules) {
        if (expanded.has(rule.sourceStore)) {
          expanded.add(rule.targetStore);
        }
        if (rule.preventTargetDeletion && expanded.has(rule.targetStore)) {
          expanded.add(rule.sourceStore);
        }
      }
    }
    return Array.from(expanded);
  }

  private async validateForeignKeysOnWrite(
    idbTx: IDBTransaction,
    storeName: string,
    record: Record<string, unknown>
  ): Promise<void> {
    const applicableRules = this.integrityRules.filter((r) => r.sourceStore === storeName);
    for (const rule of applicableRules) {
      const fkValue = record[rule.foreignKeyField];
      if (fkValue === undefined || fkValue === null || fkValue === '') continue;
      if (typeof fkValue !== 'string' && typeof fkValue !== 'number') {
        throw new ReferentialIntegrityError(
          `Clave foránea inválida en ${storeName}.${rule.foreignKeyField}.`
        );
      }
      const targetStore = idbTx.objectStore(rule.targetStore);
      const targetRecord = await wrapRequest(
        targetStore.get(fkValue),
        `${rule.targetStore} (integridad referencial)`
      );
      if (!targetRecord) {
        throw new ReferentialIntegrityError(
          `Integridad referencial: el registro referenciado (${String(fkValue)}) no existe en ${rule.targetStore}.`
        );
      }
    }
  }

  private async validateDependentsBeforeDelete(
    idbTx: IDBTransaction,
    storeName: string,
    id: EntityId
  ): Promise<void> {
    const protectingRules = this.integrityRules.filter(
      (r) => r.targetStore === storeName && r.preventTargetDeletion
    );

    for (const rule of protectingRules) {
      const sourceStore = idbTx.objectStore(rule.sourceStore);
      const allRecords = await wrapRequest<Record<string, unknown>[]>(
        sourceStore.getAll(),
        `${rule.sourceStore} (verificación de dependencias)`
      );
      const hasDependent = allRecords.some((item) => item[rule.foreignKeyField] === id);
      if (hasDependent) {
        throw new ReferentialIntegrityError(
          `No es posible eliminar el registro (${id}) de ${storeName} porque existen registros asociados en ${rule.sourceStore}.`
        );
      }
    }
  }

  public async runTransaction<TResult>(
    storeNames: readonly string[],
    mode: TransactionMode,
    work: (tx: TransactionContext) => Promise<TResult>
  ): Promise<TResult> {
    const db = await this.getDatabase();
    const effectiveStores = this.expandRequiredStores(storeNames, mode);
    const idbTx = db.transaction(effectiveStores, mode);

    const completionPromise = new Promise<void>((resolve, reject) => {
      idbTx.oncomplete = () => resolve();
      idbTx.onerror = () => {
        const err = idbTx.error;
        if (err?.name === 'ConstraintError') {
          reject(new DuplicateRecordError(effectiveStores.join(', '), err.message || 'clave única'));
          return;
        }
        reject(
          new PersistenceError(
            `La transacción local falló: ${err?.message ?? 'operación cancelada'}`
          )
        );
      };
      idbTx.onabort = () => {
        const err = idbTx.error;
        if (err?.name === 'ConstraintError') {
          reject(new DuplicateRecordError(effectiveStores.join(', '), err.message || 'clave única'));
          return;
        }
        reject(
          new PersistenceError(
            `La transacción local fue revertida para proteger la consistencia de los datos.`
          )
        );
      };
    });

    const context: TransactionContext = {
      get: async <T>(storeName: string, id: EntityId): Promise<T | undefined> => {
        const store = idbTx.objectStore(storeName);
        return wrapRequest<T | undefined>(store.get(id), storeName);
      },
      getAll: async <T>(storeName: string): Promise<T[]> => {
        const store = idbTx.objectStore(storeName);
        return wrapRequest<T[]>(store.getAll(), storeName);
      },
      getAllByIndex: async <T>(
        storeName: string,
        indexName: string,
        value: IDBValidKey
      ): Promise<T[]> => {
        const store = idbTx.objectStore(storeName);
        const index = store.index(indexName);
        return wrapRequest<T[]>(index.getAll(value), `${storeName}.${indexName}`);
      },
      count: async (storeName: string): Promise<number> => {
        const store = idbTx.objectStore(storeName);
        return wrapRequest<number>(store.count(), storeName);
      },
      countByIndex: async (
        storeName: string,
        indexName: string,
        value: IDBValidKey
      ): Promise<number> => {
        const store = idbTx.objectStore(storeName);
        const index = store.index(indexName);
        return wrapRequest<number>(index.count(value), `${storeName}.${indexName}`);
      },
      insert: async <T extends { id: EntityId }>(storeName: string, record: T): Promise<void> => {
        await this.validateForeignKeysOnWrite(
          idbTx,
          storeName,
          record as unknown as Record<string, unknown>
        );
        const store = idbTx.objectStore(storeName);
        await wrapRequest(store.add(record), storeName);
      },
      upsert: async <T extends { id: EntityId }>(storeName: string, record: T): Promise<void> => {
        await this.validateForeignKeysOnWrite(
          idbTx,
          storeName,
          record as unknown as Record<string, unknown>
        );
        const store = idbTx.objectStore(storeName);
        await wrapRequest(store.put(record), storeName);
      },
      remove: async (storeName: string, id: EntityId): Promise<void> => {
        await this.validateDependentsBeforeDelete(idbTx, storeName, id);
        const store = idbTx.objectStore(storeName);
        await wrapRequest(store.delete(id), storeName);
      },
      clear: async (storeName: string): Promise<void> => {
        const store = idbTx.objectStore(storeName);
        await wrapRequest(store.clear(), storeName);
      },
    };

    try {
      const result = await work(context);
      if (typeof idbTx.commit === 'function') {
        idbTx.commit();
      }
      await completionPromise;
      return result;
    } catch (error) {
      try {
        idbTx.abort();
      } catch {
        // La transacción ya terminó o fue abortada.
      }
      await completionPromise.catch(() => undefined);
      throw error;
    }
  }

  public getManagedStores(): readonly StoreName[] {
    return ALL_BUSINESS_STORES;
  }

  public getIntegrityRules(): readonly ReferentialIntegrityRule[] {
    return this.integrityRules;
  }
}
