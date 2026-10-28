import {
  assert,
  assertEquals,
  assertRejects,
  cashierActor,
  createTestEngine,
  TestResult,
  TestSuiteResult,
} from './testUtils';
import { ExportBackupUseCase } from '../src/modules/core/application/ExportBackupUseCase';
import { RestoreBackupUseCase } from '../src/modules/core/application/RestoreBackupUseCase';
import { SetupInitialAdminPinUseCase } from '../src/modules/core/application/SetupInitialAdminPinUseCase';
import { VerifyAdminPinUseCase } from '../src/modules/core/application/VerifyAdminPinUseCase';
import { ChangeAdminPinUseCase } from '../src/modules/core/application/ChangeAdminPinUseCase';
import { IndexedDbSystemBackupRepository } from '../src/modules/core/infrastructure/IndexedDbSystemBackupRepository';
import { CreateCategoryUseCase } from '../src/modules/warehouse/application/CreateCategoryUseCase';
import { OpenWorkdayUseCase } from '../src/modules/warehouse/application/OpenWorkdayUseCase';
import { StartWorkdayClosingUseCase } from '../src/modules/warehouse/application/StartWorkdayClosingUseCase';
import { ApproveWorkdayClosingUseCase } from '../src/modules/warehouse/application/ApproveWorkdayClosingUseCase';
import { RectifyWorkdayClosingUseCase } from '../src/modules/warehouse/application/RectifyWorkdayClosingUseCase';
import { sessionElevationService } from '../src/shared/lib/security/SessionElevationService';
import { StoreName } from '../src/shared/lib/indexeddb/schema';
import { SessionActor, UserRole } from '../src/shared/types/permissions';
import {
  UnauthorizedOperationError,
  ValidationError,
} from '../src/shared/types/errors';

import { IndexedDbCategoryRepository } from '../src/modules/warehouse/infrastructure/IndexedDbCategoryRepository';
import { IndexedDbOperationLogRepository } from '../src/modules/core/infrastructure/IndexedDbOperationLogRepository';

export async function runSecurityTests(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const startSuiteTime = Date.now();

  // Test 1: Rechazo de actor ADMIN construido artificialmente sin PIN / elevationToken
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const createCategory = new CreateCategoryUseCase(
      new IndexedDbCategoryRepository(engine),
      new IndexedDbOperationLogRepository(engine)
    );

    // Actor ADMIN construido sin token de elevación registrado
    const fakeAdminActor: SessionActor = {
      role: UserRole.ADMIN,
      label: 'Administrador Falso',
    };

    await assertRejects(
      () => createCategory.execute(fakeAdminActor, { name: 'Categoría No Autorizada' }),
      UnauthorizedOperationError,
      'Rechazar actor ADMIN sin elevación por PIN'
    );

    tests.push({
      name: '1. Rechazo de actor ADMIN construido artificialmente sin PIN',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '1. Rechazo de actor ADMIN construido artificialmente sin PIN',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 2: Autorización exitosa después de verificar correctamente el PIN de 6 dígitos
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const setupPin = new SetupInitialAdminPinUseCase(engine);
    const verifyPin = new VerifyAdminPinUseCase(engine);
    const createCategory = new CreateCategoryUseCase(
      new IndexedDbCategoryRepository(engine),
      new IndexedDbOperationLogRepository(engine)
    );

    // Configurar PIN inicial '123456'
    const unElevatedActor: SessionActor = { role: UserRole.CASHIER, label: 'Cajero' };
    const setupRes = await setupPin.execute(unElevatedActor, { pin: '123456', confirmPin: '123456' });

    // Construir actor elevado con el token devuelto
    const elevatedActor: SessionActor = {
      role: UserRole.ADMIN,
      label: 'Administrador Elevado',
      elevationToken: setupRes.elevationToken,
    };

    // Ejecutar operación restringida con éxito
    const cat = await createCategory.execute(elevatedActor, { name: 'Categoría Autorizada' });
    assertEquals(cat.name, 'Categoría Autorizada');

    tests.push({
      name: '2. Autorización exitosa tras verificar correctamente el PIN',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '2. Autorización exitosa tras verificar correctamente el PIN',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 3 & 4: Revocación de autorización al cambiar a CASHIER y rechazo posterior
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const setupPin = new SetupInitialAdminPinUseCase(engine);
    const createCategory = new CreateCategoryUseCase(
      new IndexedDbCategoryRepository(engine),
      new IndexedDbOperationLogRepository(engine)
    );

    const setupRes = await setupPin.execute(cashierActor, { pin: '123456', confirmPin: '123456' });
    const elevatedActor: SessionActor = {
      role: UserRole.ADMIN,
      label: 'Administrador',
      elevationToken: setupRes.elevationToken,
    };

    // Confirmar que funciona mientras está elevado
    await createCategory.execute(elevatedActor, { name: 'Cat 1' });

    // Revocar elevación (simular cambio a Cajero)
    sessionElevationService.revokeAll();

    // Intentar reusar el mismo objeto actor
    await assertRejects(
      () => createCategory.execute(elevatedActor, { name: 'Cat 2' }),
      UnauthorizedOperationError,
      'Rechazar operación tras revocar la elevación'
    );

    tests.push({
      name: '3 y 4. Revocación de autorización y rechazo inmediato tras volver a Cajero',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '3 y 4. Revocación de autorización y rechazo inmediato tras volver a Cajero',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 5: Reautenticación específica mediante PIN para restauración de respaldo
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const setupPin = new SetupInitialAdminPinUseCase(engine);
    const verifyPin = new VerifyAdminPinUseCase(engine);
    const backupRepo = new IndexedDbSystemBackupRepository(engine);
    const mockFilePort = { saveJsonBackup: async () => {}, readJsonFile: async (f: any) => f.text() };
    const restoreUseCase = new RestoreBackupUseCase(backupRepo, mockFilePort as any);

    const setupRes = await setupPin.execute(cashierActor, { pin: '123456', confirmPin: '123456' });
    const adminActor: SessionActor = {
      role: UserRole.ADMIN,
      label: 'Admin',
      elevationToken: setupRes.elevationToken,
    };

    // Intentar restaurar sin token crítico de reautenticación
    await assertRejects(
      () => restoreUseCase.execute(adminActor, { text: async () => '{}' } as any, 'TOKEN_INVALIDO'),
      Error,
      'Exigir reautenticación para restauración'
    );

    // Obtener token crítico legítimo mediante verifyAdminPin
    const verifyRes = await verifyPin.execute(adminActor, { pin: '123456', scope: 'RESTORE_BACKUP' });
    assert(Boolean(verifyRes.criticalToken), 'Emite criticalToken para restauración');

    tests.push({
      name: '5. Exigir reautenticación por PIN para restauración de respaldo',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '5. Exigir reautenticación por PIN para restauración de respaldo',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 6: Reautenticación específica para rectificación de jornada
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const setupPin = new SetupInitialAdminPinUseCase(engine);
    const verifyPin = new VerifyAdminPinUseCase(engine);
    const rectifyUseCase = new RectifyWorkdayClosingUseCase(engine);

    const setupRes = await setupPin.execute(cashierActor, { pin: '123456', confirmPin: '123456' });
    const adminActor: SessionActor = {
      role: UserRole.ADMIN,
      label: 'Admin',
      elevationToken: setupRes.elevationToken,
    };

    // Intentar rectificar con token crítico inventado
    await assertRejects(
      () =>
        rectifyUseCase.execute(adminActor, {
          workdayId: 'w1',
          counts: {},
          differenceReasons: {},
          reason: 'Ajuste',
          criticalToken: 'TOKEN_FALSO',
        }),
      Error,
      'Rechazar rectificación con token crítico inválido'
    );

    // Obtener token legítimo
    const verifyRes = await verifyPin.execute(adminActor, { pin: '123456', scope: 'RECTIFY_WORKDAY' });
    assert(Boolean(verifyRes.criticalToken), 'Emite criticalToken para rectificación');

    tests.push({
      name: '6. Exigir reautenticación por PIN para rectificación de jornada',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '6. Exigir reautenticación por PIN para rectificación de jornada',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 7 & 8: Rechazo de PIN incorrecto y bloqueo temporal por 5 intentos fallidos
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const setupPin = new SetupInitialAdminPinUseCase(engine);
    const verifyPin = new VerifyAdminPinUseCase(engine);

    await setupPin.execute(cashierActor, { pin: '123456', confirmPin: '123456' });
    const actor: SessionActor = { role: UserRole.CASHIER, label: 'Cajero' };

    // 4 intentos fallidos
    for (let i = 1; i <= 4; i++) {
      await assertRejects(
        () => verifyPin.execute(actor, { pin: '000000' }),
        ValidationError
      );
    }

    // 5to intento fallido activa el bloqueo temporal de 5 minutos
    await assertRejects(
      () => verifyPin.execute(actor, { pin: '000000' }),
      'bloqueado por 5 minutos'
    );

    // Un 6to intento (incluso con el PIN correcto) debe ser rechazado por bloqueo activo
    await assertRejects(
      () => verifyPin.execute(actor, { pin: '123456' }),
      'bloqueado temporalmente'
    );

    tests.push({
      name: '7 y 8. Rechazo de PIN incorrecto y activación del bloqueo temporal tras 5 intentos fallidos',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '7 y 8. Rechazo de PIN incorrecto y activación del bloqueo temporal tras 5 intentos fallidos',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 9: Consumo único de autorización crítica (no reutilizable)
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const setupPin = new SetupInitialAdminPinUseCase(engine);
    const verifyPin = new VerifyAdminPinUseCase(engine);

    await setupPin.execute(cashierActor, { pin: '123456', confirmPin: '123456' });
    const adminActor: SessionActor = { role: UserRole.ADMIN, label: 'Admin' };

    const verifyRes = await verifyPin.execute(adminActor, { pin: '123456', scope: 'RESTORE_BACKUP' });
    const critToken = verifyRes.criticalToken!;

    // Primer consumo explícito
    sessionElevationService.consumeCriticalToken(critToken, 'RESTORE_BACKUP');

    // Segundo consumo del mismo token debe fallar
    assertRejects(
      async () => sessionElevationService.consumeCriticalToken(critToken, 'RESTORE_BACKUP'),
      'ya fue utilizada'
    );

    tests.push({
      name: '9. Consumo único de autorización crítica (un solo uso e invalidación inmediata)',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '9. Consumo único de autorización crítica (un solo uso e invalidación inmediata)',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 10: Conservación del PIN local receptor tras restaurar respaldo
  try {
    const start = Date.now();
    const sourceEngine = await createTestEngine();
    const targetEngine = await createTestEngine();

    const backupRepoSource = new IndexedDbSystemBackupRepository(sourceEngine);
    const backupRepoTarget = new IndexedDbSystemBackupRepository(targetEngine);

    let savedBackup = '';
    const mockFilePort = {
      saveJsonBackup: async (_f: string, c: string) => { savedBackup = c; },
      readJsonFile: async (f: any) => f.text(),
    };

    const exportUseCase = new ExportBackupUseCase(backupRepoSource, mockFilePort as any);
    const restoreUseCase = new RestoreBackupUseCase(backupRepoTarget, mockFilePort as any);

    // Source con PIN emisor
    await sourceEngine.runTransaction([StoreName.SYSTEM_METADATA], 'readwrite', async (tx) => {
      await tx.insert(StoreName.SYSTEM_METADATA, {
        id: 'admin_pin_credentials',
        hashHex: 'HASH_EMISOR',
        saltHex: 'SALT_EMISOR',
        iterations: 100000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    const setupTarget = new SetupInitialAdminPinUseCase(targetEngine);
    const setupRes = await setupTarget.execute(cashierActor, { pin: '654321', confirmPin: '654321' });
    const targetAdmin: SessionActor = { role: UserRole.ADMIN, label: 'TargetAdmin', elevationToken: setupRes.elevationToken };

    await exportUseCase.execute(targetAdmin);

    const verifyRes = await new VerifyAdminPinUseCase(targetEngine).execute(targetAdmin, { pin: '654321', scope: 'RESTORE_BACKUP' });
    const mockFile = { name: 'b.json', text: async () => savedBackup } as unknown as File;

    await restoreUseCase.execute(targetAdmin, mockFile, verifyRes.criticalToken!);

    // Verificar que el PIN del receptor NO fue sobrescrito por HASH_EMISOR
    await targetEngine.runTransaction([StoreName.SYSTEM_METADATA], 'readonly', async (tx) => {
      const creds = await tx.get<any>(StoreName.SYSTEM_METADATA, 'admin_pin_credentials');
      assert(creds.hashHex !== 'HASH_EMISOR', 'Preserva las credenciales receptoras');
    });

    tests.push({
      name: '10. Conservación del PIN local receptor tras la restauración',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '10. Conservación del PIN local receptor tras la restauración',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 11: Exclusión de credenciales PIN en la exportación de respaldo JSON
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const setupPin = new SetupInitialAdminPinUseCase(engine);
    const backupRepo = new IndexedDbSystemBackupRepository(engine);

    let savedJson = '';
    const mockFilePort = {
      saveJsonBackup: async (_f: string, c: string) => { savedJson = c; },
      readJsonFile: async (f: any) => f.text(),
    };

    const setupRes = await setupPin.execute(cashierActor, { pin: '123456', confirmPin: '123456' });
    const adminActor: SessionActor = { role: UserRole.ADMIN, label: 'Admin', elevationToken: setupRes.elevationToken };

    const exportUseCase = new ExportBackupUseCase(backupRepo, mockFilePort as any);
    await exportUseCase.execute(adminActor);

    const parsed = JSON.parse(savedJson);
    const pinCredsInBackup = (parsed.stores[StoreName.SYSTEM_METADATA] || []).find(
      (m: any) => m.id === 'admin_pin_credentials'
    );
    assertEquals(pinCredsInBackup, undefined, 'Excluye credenciales de PIN del archivo de respaldo');

    tests.push({
      name: '11. Ausencia de credenciales PIN en exportación de respaldo JSON',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '11. Ausencia de credenciales PIN en exportación de respaldo JSON',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 12: Persistencia e integridad transaccional de datos
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const createCategory = new CreateCategoryUseCase(
      new IndexedDbCategoryRepository(engine),
      new IndexedDbOperationLogRepository(engine)
    );
    const elevationToken = sessionElevationService.registerElevatedSession('Admin Persistencia');
    const adminActor: SessionActor = { role: UserRole.ADMIN, label: 'Admin Persistencia', elevationToken };

    await createCategory.execute(adminActor, { name: 'Abarrotes' });

    // Simular reinicio / reconexión de instancia
    const catList = await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES], 'readonly', (tx) =>
      tx.getAll(StoreName.WAREHOUSE_CATEGORIES)
    );
    assertEquals(catList.length, 1, 'Conserva datos persistidos');

    tests.push({
      name: '12. Persistencia e integridad de datos en IndexedDB v10',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '12. Persistencia e integridad de datos en IndexedDB v10',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  const passedCount = tests.filter((t) => t.passed).length;
  return {
    name: 'PRUEBAS DE SEGURIDAD Y REAUTENTICACIÓN POR PIN (BLOQUE 10.3)',
    tests,
    total: tests.length,
    passed: passedCount,
    failed: tests.length - passedCount,
    durationMs: Date.now() - startSuiteTime,
  };
}
