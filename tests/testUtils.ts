import 'fake-indexeddb/auto';
import { IndexedDbEngine } from '../src/shared/lib/indexeddb/IndexedDbEngine';
import { SessionActor, UserRole } from '../src/shared/types/permissions';
import { DATABASE_MIGRATIONS, DATABASE_VERSION, StoreName } from '../src/shared/lib/indexeddb/schema';

import { sessionElevationService } from '../src/shared/lib/security/SessionElevationService';

export const adminActor: SessionActor = {
  role: UserRole.ADMIN,
  label: 'Administrador de Pruebas',
  get elevationToken() {
    return sessionElevationService.registerElevatedSession('Administrador de Pruebas');
  },
};

export const cashierActor: SessionActor = {
  role: UserRole.CASHIER,
  label: 'Cajero de Pruebas',
};

let testDbCounter = 0;

/**
 * Crea e inicializa una instancia limpia e aislada de IndexedDbEngine utilizando fake-indexeddb.
 * Cada llamada genera un nombre de base de datos único.
 */
export async function createTestEngine(): Promise<IndexedDbEngine> {
  testDbCounter++;
  const testDbName = `test_db_${Date.now()}_${testDbCounter}_${Math.random().toString(36).substring(2, 7)}`;
  
  // Reemplazar temporalmente DATABASE_NAME abriendo la DB directamente
  const engine = new (class extends IndexedDbEngine {
    public override getDatabase(): Promise<IDBDatabase> {
      if ((this as any)._customDbPromise) {
        return (this as any)._customDbPromise;
      }

      (this as any)._customDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const openRequest = indexedDB.open(testDbName, DATABASE_VERSION);

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

        openRequest.onsuccess = () => resolve(openRequest.result);
        openRequest.onerror = () => reject(openRequest.error);
      });

      return (this as any)._customDbPromise;
    }
  })();

  await engine.initialize();
  return engine;
}

export interface TestResult {
  readonly name: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly error?: string;
}

export interface TestSuiteResult {
  readonly name: string;
  readonly tests: readonly TestResult[];
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly durationMs: number;
}

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message ? message + ': ' : ''}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

export async function assertRejects(
  fn: () => Promise<unknown>,
  expectedErrorClassOrMsg?: any,
  message?: string
): Promise<Error> {
  try {
    await fn();
  } catch (err: any) {
    if (expectedErrorClassOrMsg) {
      if (typeof expectedErrorClassOrMsg === 'string') {
        if (!err.message.includes(expectedErrorClassOrMsg)) {
          throw new Error(
            `${message ? message + ': ' : ''}Se esperaba error con mensaje que incluyera "${expectedErrorClassOrMsg}", pero fue "${err.message}"`
          );
        }
      } else if (typeof expectedErrorClassOrMsg === 'function') {
        if (!(err instanceof expectedErrorClassOrMsg)) {
          throw new Error(
            `${message ? message + ': ' : ''}Se esperaba error tipo ${expectedErrorClassOrMsg.name}, pero fue ${err?.constructor?.name}: ${err.message}`
          );
        }
      }
    }
    return err;
  }
  throw new Error(`${message ? message + ': ' : ''}Se esperaba que la promesa fuera rechazada, pero se resolvió exitosamente.`);
}
