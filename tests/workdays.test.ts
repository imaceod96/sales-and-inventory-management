import {
  adminActor,
  assertEquals,
  assertRejects,
  createTestEngine,
  TestResult,
  TestSuiteResult,
} from './testUtils';
import { OpenWorkdayUseCase } from '../src/modules/warehouse/application/OpenWorkdayUseCase';
import { RegisterProductWithInitialEntryUseCase } from '../src/modules/warehouse/application/RegisterProductWithInitialEntryUseCase';
import { CreateOpenSaleAccountUseCase } from '../src/modules/sales/application/CreateOpenSaleAccountUseCase';
import { DispatchSaleUseCase } from '../src/modules/sales/application/DispatchSaleUseCase';
import { CancelOpenSaleAccountUseCase } from '../src/modules/sales/application/CancelOpenSaleAccountUseCase';
import { PrepareFinalInventorySelectionUseCase } from '../src/modules/warehouse/application/PrepareFinalInventorySelectionUseCase';
import { StartWorkdayClosingUseCase } from '../src/modules/warehouse/application/StartWorkdayClosingUseCase';
import { SuspendWorkdayClosingUseCase } from '../src/modules/warehouse/application/SuspendWorkdayClosingUseCase';
import { ResumeWorkdayClosingUseCase } from '../src/modules/warehouse/application/ResumeWorkdayClosingUseCase';
import { ApproveWorkdayClosingUseCase } from '../src/modules/warehouse/application/ApproveWorkdayClosingUseCase';
import { IndexedDbCommercialActivityAdapter } from '../src/modules/warehouse/infrastructure/IndexedDbCommercialActivityAdapter';
import { StoreName } from '../src/shared/lib/indexeddb/schema';
import { WorkdayStatus } from '../src/modules/warehouse/domain/entities/WorkdayRecord';
import { PendingOpenAccountsError } from '../src/modules/sales/domain/entities/SaleRecord';

export async function runWorkdayTests(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const startSuiteTime = Date.now();

  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const openWorkday = new OpenWorkdayUseCase(engine);
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const createAccount = new CreateOpenSaleAccountUseCase(engine);
    const cancelAccount = new CancelOpenSaleAccountUseCase(engine);
    const dispatchSale = new DispatchSaleUseCase(engine);

    const commercialAdapter = new IndexedDbCommercialActivityAdapter(engine);
    const prepareFinalInv = new PrepareFinalInventorySelectionUseCase(engine, commercialAdapter);

    const startClosing = new StartWorkdayClosingUseCase(engine, prepareFinalInv);
    const suspendClosing = new SuspendWorkdayClosingUseCase(engine);
    const resumeClosing = new ResumeWorkdayClosingUseCase(engine);
    const approveClosing = new ApproveWorkdayClosingUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'General', normalizedName: 'GENERAL', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    // 1. Apertura de jornada 1
    const w1 = await openWorkday.execute(adminActor, { notes: 'Apertura Jornada 1' });
    assertEquals(w1.workday.status, WorkdayStatus.OPEN);
    assertEquals(w1.workday.consecutiveNumber, 1);

    // 2. Bloqueo de apertura duplicada
    await assertRejects(
      () => openWorkday.execute(adminActor, { notes: 'Intento duplicado' }),
      'Ya existe una jornada',
      'Rechazar abrir jornada cuando ya existe una activa'
    );

    const prod = await registerProduct.execute(adminActor, {
      name: 'Refresco 500ml',
      sku: 'SKU-REF-500',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 50,
      unitPurchasePrice: 10,
      declaredSalePrice: 20,
    });

    // 3. Crear una cuenta OPEN
    const openAcc = await createAccount.execute(adminActor, {
      accountName: 'Mesa Pendiente',
      items: [{ productId: prod.id, quantity: 2 }],
    });

    // 4. Intento de inicio de cierre con cuenta OPEN -> Debe ser bloqueado por PendingOpenAccountsError
    await assertRejects(
      () => startClosing.execute(adminActor, { workdayId: w1.workday.id }),
      PendingOpenAccountsError,
      'Bloqueo de inicio de cierre por cuentas OPEN'
    );

    // Resolver cuenta OPEN cancelándola
    await cancelAccount.execute(adminActor, {
      saleId: openAcc.sale.id,
      reason: 'Resuelta para cerrar jornada',
    });

    // Realizar un despacho válido en la jornada
    await dispatchSale.execute(adminActor, {
      items: [{ productId: prod.id, quantity: 5 }],
    });

    // 5. Iniciar proceso de cierre
    const closingRes = await startClosing.execute(adminActor, { workdayId: w1.workday.id });
    assertEquals(closingRes.workday.status, WorkdayStatus.CLOSING);

    // 6. Suspender cierre (reason obligatorio)
    const suspendedRes = await suspendClosing.execute(adminActor, { workdayId: w1.workday.id, reason: 'Pausa para alimentos' });
    assertEquals(suspendedRes.workday.status, WorkdayStatus.CLOSING_SUSPENDED);

    // 7. Reanudar cierre
    const resumedRes = await resumeClosing.execute(adminActor, { workdayId: w1.workday.id });
    assertEquals(resumedRes.workday.status, WorkdayStatus.CLOSING);

    // 8. Aprobación final
    const approvedRes = await approveClosing.execute(adminActor, {
      workdayId: w1.workday.id,
      counts: { [prod.id]: 45 }, // 50 - 5 = 45 exacto
      differenceReasons: {},
      notes: 'Cierre conforme sin diferencias',
    });
    assertEquals(approvedRes.workday.status, WorkdayStatus.CLOSED);

    // 9. Apertura de una jornada posterior (Jornada 2)
    const w2 = await openWorkday.execute(adminActor, { notes: 'Apertura Jornada 2' });
    assertEquals(w2.workday.consecutiveNumber, 2);
    assertEquals(w2.workday.status, WorkdayStatus.OPEN);

    tests.push({
      name: 'Ciclo de vida completo de Jornada: Apertura, rechazo de duplicado, bloqueo por OPEN, Cierre, Suspensión, Reanudación, Aprobación y Apertura posterior',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: 'Ciclo de vida completo de Jornada',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  const passedCount = tests.filter((t) => t.passed).length;
  return {
    name: 'PRUEBAS DE JORNADAS OPERATIVAS',
    tests,
    total: tests.length,
    passed: passedCount,
    failed: tests.length - passedCount,
    durationMs: Date.now() - startSuiteTime,
  };
}
