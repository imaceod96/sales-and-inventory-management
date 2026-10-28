import {
  adminActor,
  cashierActor,
  assertEquals,
  assertRejects,
  createTestEngine,
  TestResult,
  TestSuiteResult,
} from './testUtils';
import { SetupInitialAdminPinUseCase } from '../src/modules/core/application/SetupInitialAdminPinUseCase';
import { VerifyAdminPinUseCase } from '../src/modules/core/application/VerifyAdminPinUseCase';
import { ChangeAdminPinUseCase } from '../src/modules/core/application/ChangeAdminPinUseCase';
import { CheckAdminPinStatusUseCase } from '../src/modules/core/application/CheckAdminPinStatusUseCase';
import { CreateCategoryUseCase } from '../src/modules/warehouse/application/CreateCategoryUseCase';
import { CreateOpenSaleAccountUseCase } from '../src/modules/sales/application/CreateOpenSaleAccountUseCase';
import { OpenWorkdayUseCase } from '../src/modules/warehouse/application/OpenWorkdayUseCase';
import { RegisterProductWithInitialEntryUseCase } from '../src/modules/warehouse/application/RegisterProductWithInitialEntryUseCase';
import { DispatchSaleUseCase } from '../src/modules/sales/application/DispatchSaleUseCase';
import { IndexedDbCategoryRepository } from '../src/modules/warehouse/infrastructure/IndexedDbCategoryRepository';
import { IndexedDbOperationLogRepository } from '../src/modules/core/infrastructure/IndexedDbOperationLogRepository';
import { StoreName } from '../src/shared/lib/indexeddb/schema';
import { UserRole } from '../src/shared/types/permissions';

export async function runPinSecurityTests(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const startSuiteTime = Date.now();

  // Test 1: Configuración inicial, hashing seguro PBKDF2 y ausencia de texto plano
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const setupPin = new SetupInitialAdminPinUseCase(engine);
    const checkStatus = new CheckAdminPinStatusUseCase(engine);

    // Estado inicial: no configurado
    const initialStatus = await checkStatus.execute();
    assertEquals(initialStatus.isConfigured, false, 'PIN no configurado inicialmente');

    // Rechazo de PIN incompleto (< 6 dígitos)
    await assertRejects(
      () => setupPin.execute(cashierActor, { pin: '12345', confirmPin: '12345' }),
      'exactamente de 6 dígitos',
      'Rechazar PIN con menos de 6 dígitos'
    );

    // Rechazo de caracteres no numéricos
    await assertRejects(
      () => setupPin.execute(cashierActor, { pin: '12345A', confirmPin: '12345A' }),
      'exactamente de 6 dígitos',
      'Rechazar PIN con caracteres alfabéticos'
    );

    // Configurar PIN válido '123456'
    const setupRes = await setupPin.execute(cashierActor, { pin: '123456', confirmPin: '123456' });
    assertEquals(setupRes.success, true);

    const postSetupStatus = await checkStatus.execute();
    assertEquals(postSetupStatus.isConfigured, true, 'PIN configurado tras setup');

    // Rechazo de segunda configuración inicial
    await assertRejects(
      () => setupPin.execute(cashierActor, { pin: '654321', confirmPin: '654321' }),
      'ya se encuentra configurado',
      'Bloqueo de re-configuración inicial sin autenticación'
    );

    // Verificar que el PIN NO se guarda en texto plano en IndexedDB
    await engine.runTransaction([StoreName.SYSTEM_METADATA], 'readonly', async (tx) => {
      const creds = await tx.get<any>(StoreName.SYSTEM_METADATA, 'admin_pin_credentials');
      assertEquals(Boolean(creds), true);
      assertEquals(creds.id, 'admin_pin_credentials');
      assertEquals(creds.hashHex.length, 64, 'Hash es una cadena hexadecimal SHA-256 de 64 caracteres');
      assertEquals(Boolean(creds.saltHex), true, 'Salt Hex único generado');
      assertEquals(creds.iterations, 100000, 'PBKDF2 configurado con 100,000 iteraciones');
      // Asegurar que no hay ningún campo que guarde el PIN crudo
      assertEquals(creds.pin, undefined, 'Sin campo pin en texto plano');
      assertEquals(creds.password, undefined, 'Sin campo password');
    });

    tests.push({
      name: 'Configuración inicial de PIN, hashing PBKDF2 SHA-256 y ausencia de texto plano',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: 'Configuración inicial de PIN y hashing seguro',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 2: Verificación de PIN, rechazo de PIN incorrecto y control de intentos fallidos
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const setupPin = new SetupInitialAdminPinUseCase(engine);
    const verifyPin = new VerifyAdminPinUseCase(engine);

    await setupPin.execute(cashierActor, { pin: '654321', confirmPin: '654321' });

    // Verificación exitosa con PIN correcto '654321'
    const verifySuccess = await verifyPin.execute(cashierActor, { pin: '654321' });
    assertEquals(verifySuccess.success, true);

    // Rechazo de PIN incorrecto '111111'
    await assertRejects(
      () => verifyPin.execute(cashierActor, { pin: '111111' }),
      'PIN de administrador incorrecto',
      'Rechazar PIN incorrecto'
    );

    tests.push({
      name: 'Verificación de PIN correcto y rechazo de PIN incorrecto',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: 'Verificación de PIN y rechazo de PIN incorrecto',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 3: Bloqueo progresivo por intentos fallidos y persistencia del bloqueo tras reinicio
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const setupPin = new SetupInitialAdminPinUseCase(engine);
    const verifyPin = new VerifyAdminPinUseCase(engine);
    const checkStatus = new CheckAdminPinStatusUseCase(engine);

    await setupPin.execute(cashierActor, { pin: '987654', confirmPin: '987654' });

    // Acumular 4 intentos fallidos
    for (let i = 1; i <= 4; i++) {
      await assertRejects(
        () => verifyPin.execute(cashierActor, { pin: '000000' }),
        'incorrecto',
        `Intento fallido ${i}`
      );
    }

    // El 5to intento fallido activa el bloqueo temporal de 5 minutos
    await assertRejects(
      () => verifyPin.execute(cashierActor, { pin: '000000' }),
      'bloqueado',
      'Bloqueo temporal activado al alcanzarse 5 intentos fallidos'
    );

    // Verificar que un intento con el PIN CORRECTO dentro del período de bloqueo ES RECHAZADO
    await assertRejects(
      () => verifyPin.execute(cashierActor, { pin: '987654' }),
      'bloqueado',
      'Bloqueo impide elevación incluso con PIN correcto mientras persista el temporizador'
    );

    const statusLocked = await checkStatus.execute();
    assertEquals(statusLocked.isLockedOut, true, 'Estado reporta bloqueo activo');

    // Persistencia del bloqueo: Reutilizar el mismo motor de almacenamiento
    const verifyPin2 = new VerifyAdminPinUseCase(engine);
    await assertRejects(
      () => verifyPin2.execute(cashierActor, { pin: '987654' }),
      'bloqueado',
      'El bloqueo persiste tras instanciar nuevos casos de uso'
    );

    tests.push({
      name: 'Bloqueo temporal por 5 intentos fallidos y persistencia del estado de bloqueo',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: 'Bloqueo temporal por 5 intentos fallidos',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 4: Cambio de PIN administrativo (ADMIN) y revocación del PIN anterior
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const setupPin = new SetupInitialAdminPinUseCase(engine);
    const verifyPin = new VerifyAdminPinUseCase(engine);
    const changePin = new ChangeAdminPinUseCase(engine);

    await setupPin.execute(cashierActor, { pin: '112233', confirmPin: '112233' });

    // Intento de cambio de PIN por CASHIER -> Debe ser rechazado por falta de permiso
    await assertRejects(
      () => changePin.execute(cashierActor, { currentPin: '112233', newPin: '445566', confirmNewPin: '445566' }),
      'autorización',
      'CASHIER no puede cambiar el PIN administrativo'
    );

    // Cambio de PIN por ADMIN con PIN actual válido '112233' -> '445566'
    const changeRes = await changePin.execute(adminActor, {
      currentPin: '112233',
      newPin: '445566',
      confirmNewPin: '445566',
    });
    assertEquals(changeRes.success, true);

    // PIN antiguo '112233' ya NO funciona
    await assertRejects(
      () => verifyPin.execute(cashierActor, { pin: '112233' }),
      'incorrecto',
      'PIN antiguo revocado'
    );

    // Nuevo PIN '445566' SÍ funciona
    const verifyNew = await verifyPin.execute(cashierActor, { pin: '445566' });
    assertEquals(verifyNew.success, true);

    tests.push({
      name: 'Cambio de PIN por ADMIN con validación de PIN anterior y revocación exitosa',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: 'Cambio de PIN por ADMIN',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 5: Operaciones comerciales permitidas para CASHIER vs operaciones administrativas rechazadas
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const categoryRepo = new IndexedDbCategoryRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);
    const createCategory = new CreateCategoryUseCase(categoryRepo, opRepo);

    const openWorkday = new OpenWorkdayUseCase(engine);
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const createAccount = new CreateOpenSaleAccountUseCase(engine);
    const dispatchSale = new DispatchSaleUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'General', normalizedName: 'GENERAL', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    // 1. CASHIER intenta crear una categoría (operación ADMIN) -> Debe ser RECHAZADO
    await assertRejects(
      () => createCategory.execute(cashierActor, { name: 'Nueva Cat' }),
      'autorización',
      'CASHIER no puede ejecutar operaciones administrativas'
    );

    // 2. Operaciones comerciales habituales por CASHIER -> DEBEN FUNCIONAR NORMALMENTE
    await openWorkday.execute(adminActor, {}); // apertura previa

    const p1 = await registerProduct.execute(adminActor, {
      name: 'Galletas de Choc',
      sku: 'SKU-GAL-CHOC',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 30,
      unitPurchasePrice: 10,
      declaredSalePrice: 18,
    });

    // CASHIER crea cuenta abierta
    const openRes = await createAccount.execute(cashierActor, {
      accountName: 'Cliente Cajero',
      items: [{ productId: p1.id, quantity: 2 }],
    });
    assertEquals(openRes.sale.openedByUserId, UserRole.CASHIER);

    // CASHIER confirma despacho
    const dispatchRes = await dispatchSale.execute(cashierActor, {
      saleId: openRes.sale.id,
      items: [{ productId: p1.id, quantity: 2 }],
    });
    assertEquals(dispatchRes.sale.dispatchedByUserId, UserRole.CASHIER);

    tests.push({
      name: 'Separación estricta de permisos: Operaciones administrativas rechazadas para CASHIER y operaciones comerciales permitidas',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: 'Separación estricta de permisos para CASHIER',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  const passedCount = tests.filter((t) => t.passed).length;
  return {
    name: 'PRUEBAS DE SEGURIDAD Y PIN ADMINISTRATIVO (BLOQUE 9.4)',
    tests,
    total: tests.length,
    passed: passedCount,
    failed: tests.length - passedCount,
    durationMs: Date.now() - startSuiteTime,
  };
}
