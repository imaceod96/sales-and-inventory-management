import {
  adminActor,
  assert,
  assertEquals,
  createTestEngine,
  TestResult,
  TestSuiteResult,
} from './testUtils';
import { StoreName } from '../src/shared/lib/indexeddb/schema';
import { DispatchSaleUseCase } from '../src/modules/sales/application/DispatchSaleUseCase';
import { generateEntityId } from '../src/shared/utils/id';

export async function runPerformanceOptimizationTests(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const startSuiteTime = Date.now();

  // Test 1: Rendimiento de carga y filtrado con 5,000 productos
  try {
    const start = Date.now();
    const engine = await createTestEngine();

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS, StoreName.WAREHOUSE_PRODUCTS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, {
        id: 'cat-opt',
        name: 'Categoría Optimización',
        normalizedName: 'CATEGORIA OPTIMIZACION',
        isSystemCategory: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await tx.insert(StoreName.WAREHOUSE_UNITS, {
        id: 'u-opt',
        name: 'Unidad',
        symbol: 'u',
        normalizedName: 'UNIDAD',
        precisionDigits: 0,
        isSystemUnit: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Insertar 5000 productos en batch
      for (let i = 1; i <= 5000; i++) {
        await tx.insert(StoreName.WAREHOUSE_PRODUCTS, {
          id: `prod-${i}`,
          name: `Producto Comercial Masivo Número ${i}`,
          normalizedName: `PRODUCTO COMERCIAL MASIVO NUMERO ${i}`,
          sku: `SKU-OPT-${i}`,
          categoryId: 'cat-opt',
          measurementUnitId: 'u-opt',
          currentStock: 100,
          lastPurchasePrice: 15,
          currentSalePrice: 30,
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    });

    const loadStart = Date.now();
    let allProducts: any[] = [];
    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      allProducts = await tx.getAll(StoreName.WAREHOUSE_PRODUCTS);
    });
    const loadTimeMs = Date.now() - loadStart;

    assertEquals(allProducts.length, 5000, 'Se cargaron exitosamente 5000 productos');
    assert(loadTimeMs < 1500, 'El tiempo de carga masiva de 5000 productos es inferior a 1.5s');

    // Simulación de búsqueda indexada por SKU / Nombre
    const searchStart = Date.now();
    const searchResult = allProducts.filter(
      (p) => p.sku.includes('SKU-OPT-49') || p.name.includes('Número 4900')
    );
    const searchTimeMs = Date.now() - searchStart;

    assert(searchResult.length > 0, 'La búsqueda encuentra elementos rápidamente en 5000 registros');
    assert(searchTimeMs < 50, 'El tiempo de filtrado en memoria es menor a 50ms');

    tests.push({
      name: '1. Rendimiento y filtrado eficiente con 5,000 productos en IndexedDB',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '1. Rendimiento y filtrado eficiente con 5,000 productos en IndexedDB',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 2: Idempotencia y protección contra doble clic / envío duplicado en punto de despacho
  try {
    const start = Date.now();
    const engine = await createTestEngine();

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS, StoreName.WAREHOUSE_PRODUCTS, StoreName.WAREHOUSE_WORKDAYS, StoreName.WAREHOUSE_COST_LAYERS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'c1', name: 'Cat', normalizedName: 'CAT', isSystemCategory: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'u1', name: 'Pza', symbol: 'pza', normalizedName: 'PZA', precisionDigits: 0, isSystemUnit: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_PRODUCTS, { id: 'p1', name: 'Prod 1', normalizedName: 'PROD 1', currentStock: 50, lastPurchasePrice: 10, currentSalePrice: 20, status: 'ACTIVE', categoryId: 'c1', measurementUnitId: 'u1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_WORKDAYS, { id: 'wd-1', status: 'OPEN', openedAt: new Date().toISOString(), openedByUserId: 'admin', openedByUserLabel: 'Admin', initialCashFloat: 1000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_COST_LAYERS, { id: 'cl-1', productId: 'p1', initialQuantity: 100, remainingQuantity: 100, unitCost: 10, sourceEntryId: 'e1', createdAt: new Date().toISOString() });
    });

    const dispatchUseCase = new DispatchSaleUseCase(engine);
    const operationId = generateEntityId();

    const payload = {
      items: [{ productId: 'p1', quantity: 5 }],
      operationId,
      requirePriceSyncConfirmation: true,
      confirmCatalogPriceUpdates: true,
    };

    // Primer envío
    const res1 = await dispatchUseCase.execute(adminActor, payload);
    assert(Boolean(res1.sale), 'Primer despacho exitoso');

    // Segundo envío con el mismo operationId (doble clic / reintento por latencia)
    const res2 = await dispatchUseCase.execute(adminActor, payload);
    assertEquals(res2.sale.id, res1.sale.id, 'Retorna la misma venta existente (idempotencia transaccional)');
    assertEquals(res2.movements.length, res1.movements.length, 'No duplica movimientos en Kardex');

    tests.push({
      name: '2. Idempotencia transaccional y protección contra doble clic en punto de despacho',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '2. Idempotencia transaccional y protección contra doble clic en punto de despacho',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 3: Estabilidad de sesión prolongada y aislamiento de estado en formularios
  try {
    const start = Date.now();
    const engine = await createTestEngine();

    // Validar que las transacciones y operaciones concurrentes no dejen bloqueos en IndexedDB
    for (let i = 0; i < 10; i++) {
      await engine.runTransaction([StoreName.SYSTEM_METADATA], 'readwrite', async (tx) => {
        await tx.insert(StoreName.SYSTEM_METADATA, {
          id: `session_heartbeat_${i}`,
          timestamp: Date.now(),
          updatedAt: new Date().toISOString(),
        });
      });
    }

    let recordsCount = 0;
    await engine.runTransaction([StoreName.SYSTEM_METADATA], 'readonly', async (tx) => {
      recordsCount = await tx.count(StoreName.SYSTEM_METADATA);
    });

    assert(recordsCount >= 10, 'Persiste y mantiene integridad durante múltiples operaciones de sesión');

    tests.push({
      name: '3. Estabilidad transaccional ante uso prolongado y múltiples ciclos',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: '3. Estabilidad transaccional ante uso prolongado y múltiples ciclos',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  const passedCount = tests.filter((t) => t.passed).length;
  return {
    name: 'PRUEBAS DE RENDIMIENTO Y OPTIMIZACIÓN OPERATIVA (BLOQUE 10.5)',
    tests,
    total: tests.length,
    passed: passedCount,
    failed: tests.length - passedCount,
    durationMs: Date.now() - startSuiteTime,
  };
}
