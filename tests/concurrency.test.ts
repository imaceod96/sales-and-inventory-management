import {
  adminActor,
  assertEquals,
  createTestEngine,
  TestResult,
  TestSuiteResult,
} from './testUtils';
import { OpenWorkdayUseCase } from '../src/modules/warehouse/application/OpenWorkdayUseCase';
import { RegisterProductWithInitialEntryUseCase } from '../src/modules/warehouse/application/RegisterProductWithInitialEntryUseCase';
import { DispatchSaleUseCase } from '../src/modules/sales/application/DispatchSaleUseCase';
import { StoreName } from '../src/shared/lib/indexeddb/schema';

export async function runConcurrencyTests(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const startSuiteTime = Date.now();

  // Test 1: Dos despachos consecutivos/simultáneos del mismo producto y reintento con mismo operationId
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const openWorkday = new OpenWorkdayUseCase(engine);
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const dispatchSale = new DispatchSaleUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'General', normalizedName: 'GENERAL', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    await openWorkday.execute(adminActor, {});

    const prod = await registerProduct.execute(adminActor, {
      name: 'Leche Entera 1L',
      sku: 'SKU-LECHE-1L',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 20,
      unitPurchasePrice: 18,
      declaredSalePrice: 28,
    });

    // Ejecutar dos despachos para el mismo producto
    const dispatch1Promise = dispatchSale.execute(adminActor, {
      items: [{ productId: prod.id, quantity: 3 }],
      operationId: 'op-uniq-001',
    });

    const dispatch2Promise = dispatchSale.execute(adminActor, {
      items: [{ productId: prod.id, quantity: 5 }],
      operationId: 'op-uniq-002',
    });

    await Promise.all([dispatch1Promise, dispatch2Promise]);

    // Verificar que el stock resultante es exactamente 12 (20 - 3 - 5 = 12)
    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS, StoreName.SALES_RECORDS], 'readonly', async (tx) => {
      const p = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, prod.id);
      assertEquals(p.currentStock, 12, 'Stock resultante exacto tras dos despachos');

      const sales = await tx.getAll<any>(StoreName.SALES_RECORDS);
      assertEquals(sales.length, 2, 'Dos registros de venta despachados');
    });

    // Reintento con el mismo operationId 'op-uniq-001' -> Debe retornar isDuplicate: true sin volver a descontar stock
    const retryRes = await dispatchSale.execute(adminActor, {
      items: [{ productId: prod.id, quantity: 3 }],
      operationId: 'op-uniq-001',
    });
    assertEquals(retryRes.isDuplicate, true, 'Re-ejecución idempotente marcada como duplicado');

    tests.push({ name: 'Consistencia en despachos concurrentes e idempotencia por operationId', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Consistencia en despachos concurrentes e idempotencia por operationId', passed: false, durationMs: 0, error: err.message });
  }

  // Test 2: Fallo de transacción y reversión atómica de datos
  try {
    const start = Date.now();
    const engine = await createTestEngine();

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-ok', name: 'Original', normalizedName: 'ORIGINAL', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    // Simular transacción que falla a mitad de camino
    try {
      await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES], 'readwrite', async (tx) => {
        await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-temp', name: 'Temporal', normalizedName: 'TEMPORAL', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        throw new Error('Error forzado para simular fallo atómico');
      });
    } catch {
      // Error esperado
    }

    // Comprobar que 'cat-temp' NO fue persistido
    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES], 'readonly', async (tx) => {
      const temp = await tx.get(StoreName.WAREHOUSE_CATEGORIES, 'cat-temp');
      assertEquals(temp, undefined, 'Registro temporal no fue persistido debido al aborto de la transacción');
      const count = await tx.count(StoreName.WAREHOUSE_CATEGORIES);
      assertEquals(count, 1, 'Solamente se conserva el registro original');
    });

    tests.push({ name: 'Atomisidad y reversión de transacciones fallidas', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Atomisidad y reversión de transacciones fallidas', passed: false, durationMs: 0, error: err.message });
  }

  const passedCount = tests.filter((t) => t.passed).length;
  return {
    name: 'PRUEBAS DE CONCURRENCIA E IDEMPOTENCIA',
    tests,
    total: tests.length,
    passed: passedCount,
    failed: tests.length - passedCount,
    durationMs: Date.now() - startSuiteTime,
  };
}
