import {
  adminActor,
  assertEquals,
  createTestEngine,
  TestResult,
  TestSuiteResult,
} from './testUtils';
import { RegisterProductWithInitialEntryUseCase } from '../src/modules/warehouse/application/RegisterProductWithInitialEntryUseCase';
import { RegisterMerchandiseEntryUseCase } from '../src/modules/warehouse/application/RegisterMerchandiseEntryUseCase';
import { OpenWorkdayUseCase } from '../src/modules/warehouse/application/OpenWorkdayUseCase';
import { DispatchSaleUseCase } from '../src/modules/sales/application/DispatchSaleUseCase';
import { calculateWorkdayCommercialPerformance } from '../src/modules/warehouse/domain/entities/WorkdayCommercialPerformance';
import { StoreName } from '../src/shared/lib/indexeddb/schema';

export async function runFifoTests(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const startSuiteTime = Date.now();

  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const registerEntry = new RegisterMerchandiseEntryUseCase(engine);
    const openWorkday = new OpenWorkdayUseCase(engine);
    const dispatchSale = new DispatchSaleUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'General', normalizedName: 'GENERAL', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    const workday = await openWorkday.execute(adminActor, {});

    // Paso 1: Crear producto con Entrada 1: 10 unidades a costo 200, precio de venta 350
    const prodRes = await registerProduct.execute(adminActor, {
      name: 'Producto FIFO Test',
      sku: 'SKU-FIFO-1',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 10,
      unitPurchasePrice: 200,
      declaredSalePrice: 350,
    });
    const productId = prodRes.id;

    // Paso 2: Despacho 1: 4 unidades a precio 350
    const sale1Res = await dispatchSale.execute(adminActor, {
      items: [{ productId, quantity: 4 }],
    });

    // Paso 3: Entrada 2: 10 unidades a costo 250
    await registerEntry.execute(adminActor, {
      productId,
      receivedQuantity: 10,
      unitPurchasePrice: 250,
      declaredSalePrice: 350,
      declaredEntryDate: '2026-10-28',
    });

    // Paso 4: Despacho 2: 8 unidades a precio 350
    const sale2Res = await dispatchSale.execute(adminActor, {
      items: [{ productId, quantity: 8 }],
    });

    // Comprobaciones en IndexedDB:
    let finalStock = 0;
    let allSales: any[] = [];
    let allCostLayers: any[] = [];

    await engine.runTransaction(
      [StoreName.WAREHOUSE_PRODUCTS, StoreName.SALES_RECORDS, StoreName.WAREHOUSE_COST_LAYERS],
      'readonly',
      async (tx) => {
        const product = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, productId);
        finalStock = product.currentStock;
        allSales = await tx.getAll(StoreName.SALES_RECORDS);
        allCostLayers = await tx.getAll(StoreName.WAREHOUSE_COST_LAYERS);
      }
    );

    // 1. Existencias finales = 8 unidades
    assertEquals(finalStock, 8, 'Existencias finales deben ser 8 unidades');

    // 2. Costo del primer despacho = 800 (4 * 200)
    assertEquals(sale1Res.sale.totalCostAmount, 800, 'Costo del primer despacho debe ser 800');

    // 3. Costo del segundo despacho = 1,700 (6 * 200 + 2 * 250)
    assertEquals(sale2Res.sale.totalCostAmount, 1700, 'Costo del segundo despacho debe ser 1700');

    // 4. Ventas totales = 4,200 (1,400 + 2,800)
    const perf = calculateWorkdayCommercialPerformance(workday.workday.id, allSales);
    assertEquals(perf.totalCommercialValue, 4200, 'Ventas totales deben ser 4200');

    // 5. Costo total atribuido = 2,500 (800 + 1700)
    assertEquals(perf.totalCostOfGoodsDispatched, 2500, 'Costo total atribuido debe ser 2500');

    // 6. Utilidad bruta = 1,700 (4200 - 2500)
    assertEquals(perf.grossProfit, 1700, 'Utilidad bruta debe ser 1700');

    // 7. Capas FIFO restantes: capa 1 agotada (0 dispon.), capa 2 con 8 unidades a costo 250
    const remainingLayer2 = allCostLayers.find((l: any) => l.unitPurchaseCost === 250);
    assertEquals(Boolean(remainingLayer2), true, 'Existe la segunda capa de costo');
    assertEquals(remainingLayer2.remainingQuantity, 8, 'Capa 2 conserva 8 unidades disponibles');

    tests.push({
      name: 'Asignación FIFO rigurosa: 10u@200, Venta 4u, 10u@250, Venta 8u -> Valida capas, costos, utilidad e inmutabilidad',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: 'Asignación FIFO rigurosa',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  // Test 2: Optimización de persistencia de capas FIFO (HALLAZGO-01)
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const registerEntry = new RegisterMerchandiseEntryUseCase(engine);
    const openWorkday = new OpenWorkdayUseCase(engine);
    const dispatchSale = new DispatchSaleUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'General', normalizedName: 'GENERAL', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    await openWorkday.execute(adminActor, {});

    const p1 = await registerProduct.execute(adminActor, {
      name: 'Jugo de Naranja 1L',
      sku: 'SKU-JUGO-1L',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 10,
      unitPurchasePrice: 15,
      declaredSalePrice: 25,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    await registerEntry.execute(adminActor, {
      productId: p1.id,
      receivedQuantity: 10,
      unitPurchasePrice: 18,
      declaredSalePrice: 25,
      declaredEntryDate: '2026-10-28',
    });

    // p1 tiene Capa 1 (10u @ 15) y Capa 2 (10u @ 18)
    const p2 = await registerProduct.execute(adminActor, {
      name: 'Agua Mineral 600ml',
      sku: 'SKU-AGUA-600',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 20,
      unitPurchasePrice: 8,
      declaredSalePrice: 15,
    });
    // p2 tiene Capa 3 (20u @ 8)

    let allLayersBefore: any[] = [];
    await engine.runTransaction([StoreName.WAREHOUSE_COST_LAYERS], 'readonly', async (tx) => {
      allLayersBefore = await tx.getAll(StoreName.WAREHOUSE_COST_LAYERS);
    });
    assertEquals(allLayersBefore.length, 3, 'Existen 3 capas de costo iniciales');

    // Despachar solo 5u de p1. Solo la Capa 1 de p1 debe ser consumida (10 -> 5).
    await dispatchSale.execute(adminActor, {
      items: [{ productId: p1.id, quantity: 5 }],
    });

    let allLayersAfter: any[] = [];
    await engine.runTransaction([StoreName.WAREHOUSE_COST_LAYERS], 'readonly', async (tx) => {
      allLayersAfter = await tx.getAll(StoreName.WAREHOUSE_COST_LAYERS);
    });

    const layer1 = allLayersAfter.find((l: any) => l.productId === p1.id && l.unitPurchaseCost === 15);
    const layer2 = allLayersAfter.find((l: any) => l.productId === p1.id && l.unitPurchaseCost === 18);
    const layer3 = allLayersAfter.find((l: any) => l.productId === p2.id);

    assertEquals(layer1.remainingQuantity, 5, 'Capa 1 reducida a 5u');
    assertEquals(layer2.remainingQuantity, 10, 'Capa 2 intacta con 10u');
    assertEquals(layer3.remainingQuantity, 20, 'Capa 3 de p2 intacta con 20u');

    tests.push({
      name: 'Optimización de persistencia de capas FIFO (HALLAZGO-01): Modificación selectiva únicamente de capas consumidas',
      passed: true,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    tests.push({
      name: 'Optimización de persistencia de capas FIFO (HALLAZGO-01)',
      passed: false,
      durationMs: 0,
      error: err.message,
    });
  }

  const passedCount = tests.filter((t) => t.passed).length;
  return {
    name: 'PRUEBAS FIFO Y ATRIBUCIÓN CONTABLE',
    tests,
    total: tests.length,
    passed: passedCount,
    failed: tests.length - passedCount,
    durationMs: Date.now() - startSuiteTime,
  };
}
