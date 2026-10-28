import {
  adminActor,
  assert,
  assertEquals,
  assertRejects,
  createTestEngine,
  TestResult,
  TestSuiteResult,
} from './testUtils';
import { ExportBackupUseCase } from '../src/modules/core/application/ExportBackupUseCase';
import { RestoreBackupUseCase } from '../src/modules/core/application/RestoreBackupUseCase';
import { IndexedDbSystemBackupRepository } from '../src/modules/core/infrastructure/IndexedDbSystemBackupRepository';
import { ALL_BUSINESS_STORES, StoreName } from '../src/shared/lib/indexeddb/schema';
import { SystemBackupEnvelope } from '../src/modules/core/domain/entities/SystemBackup';
import { BackupValidationError, ReferentialIntegrityError } from '../src/shared/types/errors';
import { sessionElevationService } from '../src/shared/lib/security/SessionElevationService';

export async function runBackupTests(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const startSuiteTime = Date.now();

  // Test 1: Exportación de respaldo, verificación de los 14 almacenes y exclusión de credenciales de PIN
  try {
    const start = Date.now();
    const sourceEngine = await createTestEngine();
    const backupRepoSource = new IndexedDbSystemBackupRepository(sourceEngine);

    let savedBackupContent = '';
    const mockFilePort = {
      saveJsonBackup: async (_fileName: string, content: string) => {
        savedBackupContent = content;
      },
      readJsonFile: async (file: File) => file.text(),
    };

    const exportUseCase = new ExportBackupUseCase(backupRepoSource, mockFilePort as any);

    // Insertar PIN de prueba y datos iniciales en sourceEngine
    await sourceEngine.runTransaction([StoreName.SYSTEM_METADATA, StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS, StoreName.WAREHOUSE_PRODUCTS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.SYSTEM_METADATA, { id: 'admin_pin_credentials', hashHex: 'secret_source_hash', saltHex: 'source_salt', iterations: 100000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-bkp', name: 'Categoría Backup', normalizedName: 'CATEGORIA BACKUP', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'u1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_PRODUCTS, { id: 'prod-bkp', name: 'Producto Backup', normalizedName: 'PRODUCTO BACKUP', sku: 'SKU-BKP', categoryId: 'cat-bkp', measurementUnitId: 'u1', currentStock: 42, lastPurchasePrice: 10, currentSalePrice: 20, status: 'ACTIVE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    // Exportar respaldo
    const fileName = await exportUseCase.execute(adminActor);
    assert(Boolean(fileName), 'Genera nombre de archivo para respaldo');
    assert(Boolean(savedBackupContent), 'Guardó contenido de respaldo en filePort');

    const backupPkg: SystemBackupEnvelope = JSON.parse(savedBackupContent);
    assert(Boolean(backupPkg.checksum), 'El respaldo incluye checksum SHA-256');
    assertEquals(backupPkg.format, 'ESTABLECIMIENTO_BACKUP_V1');

    // Verificar cobertura total de los 14 almacenes
    for (const store of ALL_BUSINESS_STORES) {
      assert(Array.isArray(backupPkg.stores[store]), `El paquete de respaldo contiene la tabla ${store}`);
    }

    // Verificar que las credenciales de PIN fueron excluidas de la exportación
    const sysMetaInBackup = backupPkg.stores[StoreName.SYSTEM_METADATA] as any[];
    const hasPinInBackup = sysMetaInBackup.some((r) => r.id === 'admin_pin_credentials' || r.id === 'admin_pin_lockout');
    assertEquals(hasPinInBackup, false, 'El archivo exportado NO contiene credenciales de PIN ni bloqueos');

    tests.push({ name: 'Exportación de respaldo, cobertura de 14 almacenes y exclusión de PIN', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Exportación de respaldo, cobertura de 14 almacenes y exclusión de PIN', passed: false, durationMs: 0, error: err.message });
  }

  // Test 2: Exigir PIN administrativo inicial en dispositivo receptor antes de restaurar
  try {
    const start = Date.now();
    const sourceEngine = await createTestEngine();
    const backupRepoSource = new IndexedDbSystemBackupRepository(sourceEngine);

    let savedBackupContent = '';
    const mockFilePort = {
      saveJsonBackup: async (_fileName: string, content: string) => { savedBackupContent = content; },
      readJsonFile: async (file: File) => file.text(),
    };
    const exportUseCase = new ExportBackupUseCase(backupRepoSource, mockFilePort as any);
    await exportUseCase.execute(adminActor);

    // Target Engine totalmente limpio (sin PIN configurado)
    const cleanTargetEngine = await createTestEngine();
    const backupRepoTarget = new IndexedDbSystemBackupRepository(cleanTargetEngine);
    const restoreUseCase = new RestoreBackupUseCase(backupRepoTarget, mockFilePort as any);

    const mockFile = { name: 'test.json', text: async () => savedBackupContent } as unknown as File;

    await assertRejects(
      () => restoreUseCase.execute(adminActor, mockFile, sessionElevationService.issueCriticalToken(adminActor, 'RESTORE_BACKUP')),
      BackupValidationError,
      'Exigir PIN inicial en dispositivo receptor antes de restaurar'
    );

    tests.push({ name: 'Exigir PIN inicial antes de restaurar en terminal limpia', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Exigir PIN inicial antes de restaurar en terminal limpia', passed: false, durationMs: 0, error: err.message });
  }

  // Test 3: Restauración exitosa preservando obligatoriamente el PIN local del dispositivo receptor
  try {
    const start = Date.now();
    const sourceEngine = await createTestEngine();
    const backupRepoSource = new IndexedDbSystemBackupRepository(sourceEngine);

    let savedBackupContent = '';
    const mockFilePort = {
      saveJsonBackup: async (_fileName: string, content: string) => { savedBackupContent = content; },
      readJsonFile: async (file: File) => file.text(),
    };

    const exportUseCase = new ExportBackupUseCase(backupRepoSource, mockFilePort as any);

    await sourceEngine.runTransaction([StoreName.WAREHOUSE_CATEGORIES], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-restored', name: 'Categoría Importada', normalizedName: 'CATEGORIA IMPORTADA', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });
    await exportUseCase.execute(adminActor);

    // Configurar Target Engine con PIN propio del receptor
    const targetEngine = await createTestEngine();
    await targetEngine.runTransaction([StoreName.SYSTEM_METADATA], 'readwrite', async (tx) => {
      await tx.insert(StoreName.SYSTEM_METADATA, { id: 'admin_pin_credentials', hashHex: 'target_local_pin_hash', saltHex: 'target_salt', iterations: 100000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    const backupRepoTarget = new IndexedDbSystemBackupRepository(targetEngine);
    const restoreUseCase = new RestoreBackupUseCase(backupRepoTarget, mockFilePort as any);
    const mockFile = { name: 'backup.json', text: async () => savedBackupContent } as unknown as File;

    await restoreUseCase.execute(adminActor, mockFile, sessionElevationService.issueCriticalToken(adminActor, 'RESTORE_BACKUP'));

    // Verificar que los datos se restauraron Y que el PIN local receptor sigue intacto
    await targetEngine.runTransaction([StoreName.SYSTEM_METADATA, StoreName.WAREHOUSE_CATEGORIES], 'readonly', async (tx) => {
      const cat = await tx.get<any>(StoreName.WAREHOUSE_CATEGORIES, 'cat-restored');
      assertEquals(cat.name, 'Categoría Importada');

      const pinCreds = await tx.get<any>(StoreName.SYSTEM_METADATA, 'admin_pin_credentials');
      assert(Boolean(pinCreds), 'El PIN local receptor se preserva');
      assertEquals(pinCreds.hashHex, 'target_local_pin_hash', 'Conserva la clave de acceso local del dispositivo');
    });

    tests.push({ name: 'Restauración con preservación del PIN local receptor', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Restauración con preservación del PIN local receptor', passed: false, durationMs: 0, error: err.message });
  }

  // Test 4: Rechazo por alteración (tampering) y reversión atómica limpia
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    await engine.runTransaction([StoreName.SYSTEM_METADATA, StoreName.WAREHOUSE_CATEGORIES], 'readwrite', async (tx) => {
      await tx.insert(StoreName.SYSTEM_METADATA, { id: 'admin_pin_credentials', hashHex: 'pin_hash', saltHex: 'salt', iterations: 100000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-original', name: 'Original Pre-Restore', normalizedName: 'ORIGINAL PRE-RESTORE', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    const backupRepo = new IndexedDbSystemBackupRepository(engine);
    let savedContent = '';
    const mockFilePort = {
      saveJsonBackup: async (_fileName: string, content: string) => { savedContent = content; },
      readJsonFile: async (file: File) => file.text(),
    };

    const exportUseCase = new ExportBackupUseCase(backupRepo, mockFilePort as any);
    const restoreUseCase = new RestoreBackupUseCase(backupRepo, mockFilePort as any);

    await exportUseCase.execute(adminActor);
    const validPkg: SystemBackupEnvelope = JSON.parse(savedContent);

    // Modificar registro sin actualizar el checksum
    const tamperedPkg = JSON.parse(JSON.stringify(validPkg));
    tamperedPkg.stores[StoreName.WAREHOUSE_CATEGORIES].push({
      id: 'cat-tampered',
      name: 'Categoría Maliciosa',
      normalizedName: 'CATEGORIA MALICIOSA',
    });

    const tamperedFile = { name: 'tampered.json', text: async () => JSON.stringify(tamperedPkg) } as unknown as File;

    await assertRejects(
      () => restoreUseCase.execute(adminActor, tamperedFile, sessionElevationService.issueCriticalToken(adminActor, 'RESTORE_BACKUP')),
      BackupValidationError,
      'Rechazar respaldo con firma checksum alterada'
    );

    // Verificar que la base se conserva intacta
    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES], 'readonly', async (tx) => {
      const orig = await tx.get<any>(StoreName.WAREHOUSE_CATEGORIES, 'cat-original');
      assertEquals(orig.name, 'Original Pre-Restore', 'Conserva los datos anteriores');
      const fake = await tx.get<any>(StoreName.WAREHOUSE_CATEGORIES, 'cat-tampered');
      assertEquals(fake, undefined, 'No inyectó datos alterados');
    });

    tests.push({ name: 'Rechazo de respaldo alterado por suma de verificación y reversión atómica', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Rechazo de respaldo alterado por suma de verificación y reversión atómica', passed: false, durationMs: 0, error: err.message });
  }

  // Test 5: Rechazo por incumplimiento de integridad referencial
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    await engine.runTransaction([StoreName.SYSTEM_METADATA], 'readwrite', async (tx) => {
      await tx.insert(StoreName.SYSTEM_METADATA, { id: 'admin_pin_credentials', hashHex: 'pin', saltHex: 's', iterations: 100000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    const backupRepo = new IndexedDbSystemBackupRepository(engine);
    const mockFilePort = {
      saveJsonBackup: async () => {},
      readJsonFile: async (file: File) => file.text(),
    };
    const restoreUseCase = new RestoreBackupUseCase(backupRepo, mockFilePort as any);

    // Crear paquete con un producto huérfano (categoría inexistente)
    const stores: Record<string, unknown[]> = {};
    for (const store of ALL_BUSINESS_STORES) { stores[store] = []; }
    stores[StoreName.WAREHOUSE_PRODUCTS] = [{
      id: 'p-orphan',
      name: 'Producto Huérfano',
      normalizedName: 'PRODUCTO HUERFANO',
      categoryId: 'cat-non-existent',
      measurementUnitId: 'u-1',
    }];

    const rawText = JSON.stringify(stores);
    const cryptoSubtle = typeof crypto !== 'undefined' && crypto.subtle;
    let checksum = '';
    if (cryptoSubtle) {
      const buffer = await cryptoSubtle.digest('SHA-256', new TextEncoder().encode(rawText));
      checksum = Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    const pkg: SystemBackupEnvelope = {
      format: 'ESTABLECIMIENTO_BACKUP_V1',
      schemaVersion: 10,
      exportedAt: new Date().toISOString(),
      checksum,
      stores,
    };

    const orphanFile = { name: 'orphan.json', text: async () => JSON.stringify(pkg) } as unknown as File;

    await assertRejects(
      () => restoreUseCase.execute(adminActor, orphanFile, sessionElevationService.issueCriticalToken(adminActor, 'RESTORE_BACKUP')),
      ReferentialIntegrityError,
      'Rechazar respaldo con clave foránea huérfana'
    );

    tests.push({ name: 'Rechazo de respaldo con violaciones de integridad referencial', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Rechazo de respaldo con violaciones de integridad referencial', passed: false, durationMs: 0, error: err.message });
  }

  // Test 6: Prueba de volumen y estrés de datos (exportación y restauración de 100+ registros)
  try {
    const start = Date.now();
    const sourceEngine = await createTestEngine();
    const backupRepoSource = new IndexedDbSystemBackupRepository(sourceEngine);

    let savedBackupContent = '';
    const mockFilePort = {
      saveJsonBackup: async (_fileName: string, content: string) => { savedBackupContent = content; },
      readJsonFile: async (file: File) => file.text(),
    };
    const exportUseCase = new ExportBackupUseCase(backupRepoSource, mockFilePort as any);

    // Poblar 100 productos en sourceEngine
    await sourceEngine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS, StoreName.WAREHOUSE_PRODUCTS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-vol', name: 'Volumen Cat', normalizedName: 'VOLUMEN CAT', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'u-vol', name: 'Unidad Vol', symbol: 'uv', normalizedName: 'UNIDAD VOL', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

      for (let i = 1; i <= 100; i++) {
        await tx.insert(StoreName.WAREHOUSE_PRODUCTS, {
          id: `prod-vol-${i}`,
          name: `Producto Volumen ${i}`,
          normalizedName: `PRODUCTO VOLUMEN ${i}`,
          sku: `SKU-VOL-${i}`,
          categoryId: 'cat-vol',
          measurementUnitId: 'u-vol',
          currentStock: i * 10,
          lastPurchasePrice: i,
          currentSalePrice: i * 2,
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    });

    await exportUseCase.execute(adminActor);
    const exportedPkg = JSON.parse(savedBackupContent);
    assertEquals(exportedPkg.stores[StoreName.WAREHOUSE_PRODUCTS].length, 100, 'Exportó los 100 productos correctamente');

    // Restaurar en Target Engine con PIN local
    const targetEngine = await createTestEngine();
    await targetEngine.runTransaction([StoreName.SYSTEM_METADATA], 'readwrite', async (tx) => {
      await tx.insert(StoreName.SYSTEM_METADATA, { id: 'admin_pin_credentials', hashHex: 'target_pin_hash', saltHex: 's', iterations: 100000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    const backupRepoTarget = new IndexedDbSystemBackupRepository(targetEngine);
    const restoreUseCase = new RestoreBackupUseCase(backupRepoTarget, mockFilePort as any);
    const volFile = { name: 'volume.json', text: async () => savedBackupContent } as unknown as File;

    await restoreUseCase.execute(adminActor, volFile, sessionElevationService.issueCriticalToken(adminActor, 'RESTORE_BACKUP'));

    // Verificar restauración integra de los 100 productos
    await targetEngine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      const restoredCount = await tx.count(StoreName.WAREHOUSE_PRODUCTS);
      assertEquals(restoredCount, 100, 'Restauró exactamente los 100 productos en el destino');
      const p50 = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, 'prod-vol-50');
      assertEquals(p50.currentStock, 500);
    });

    tests.push({ name: 'Rendimiento y volumen: exportación y restauración de 100+ registros masivos', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Rendimiento y volumen: exportación y restauración de 100+ registros masivos', passed: false, durationMs: 0, error: err.message });
  }

  const passedCount = tests.filter((t) => t.passed).length;
  return {
    name: 'PRUEBAS DE BACKUP Y RESTAURACIÓN (BLOQUE 9.5)',
    tests,
    total: tests.length,
    passed: passedCount,
    failed: tests.length - passedCount,
    durationMs: Date.now() - startSuiteTime,
  };
}
