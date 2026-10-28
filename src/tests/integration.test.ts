import 'fake-indexeddb/auto';
import { IndexedDbEngine } from '../shared/lib/indexeddb/IndexedDbEngine';
import { StoreName, DATABASE_NAME } from '../shared/lib/indexeddb/schema';
import { UserRole, SessionActor } from '../shared/types/permissions';
import {
  ValidationError,
  UnauthorizedOperationError,
  DuplicateRecordError,
  BackupValidationError,
} from '../shared/types/errors';

// Módulo Core
import { ExportBackupUseCase } from '../modules/core/application/ExportBackupUseCase';
import { RestoreBackupUseCase } from '../modules/core/application/RestoreBackupUseCase';
import { IndexedDbSystemBackupRepository } from '../modules/core/infrastructure/IndexedDbSystemBackupRepository';
import { IndexedDbOperationLogRepository } from '../modules/core/infrastructure/IndexedDbOperationLogRepository';
import { SystemBackupEnvelope } from '../modules/core/domain/entities/SystemBackup';
import { sessionElevationService } from '../shared/lib/security/SessionElevationService';

// Módulo Almacén
import { CreateCategoryUseCase } from '../modules/warehouse/application/CreateCategoryUseCase';
import { CreateMeasurementUnitUseCase } from '../modules/warehouse/application/CreateMeasurementUnitUseCase';
import { RegisterProductWithInitialEntryUseCase } from '../modules/warehouse/application/RegisterProductWithInitialEntryUseCase';
import { RegisterMerchandiseEntryUseCase } from '../modules/warehouse/application/RegisterMerchandiseEntryUseCase';
import { UpdateProductSalePriceUseCase } from '../modules/warehouse/application/UpdateProductSalePriceUseCase';
import { CorrectProductStockUseCase } from '../modules/warehouse/application/CorrectProductStockUseCase';
import { ActivateProductUseCase } from '../modules/warehouse/application/ActivateProductUseCase';
import { DeactivateProductUseCase } from '../modules/warehouse/application/DeactivateProductUseCase';
import { OpenWorkdayUseCase } from '../modules/warehouse/application/OpenWorkdayUseCase';
import { StartWorkdayClosingUseCase } from '../modules/warehouse/application/StartWorkdayClosingUseCase';
import { SuspendWorkdayClosingUseCase } from '../modules/warehouse/application/SuspendWorkdayClosingUseCase';
import { ResumeWorkdayClosingUseCase } from '../modules/warehouse/application/ResumeWorkdayClosingUseCase';
import { ApproveWorkdayClosingUseCase } from '../modules/warehouse/application/ApproveWorkdayClosingUseCase';
import { RectifyWorkdayClosingUseCase } from '../modules/warehouse/application/RectifyWorkdayClosingUseCase';
import { CreatePartialCutUseCase } from '../modules/warehouse/application/CreatePartialCutUseCase';
import { RecordPartialCutCountUseCase } from '../modules/warehouse/application/RecordPartialCutCountUseCase';
import { ProceedToPartialCutReviewUseCase } from '../modules/warehouse/application/ProceedToPartialCutReviewUseCase';
import { ApprovePartialCutUseCase } from '../modules/warehouse/application/ApprovePartialCutUseCase';
import { PrepareFinalInventorySelectionUseCase } from '../modules/warehouse/application/PrepareFinalInventorySelectionUseCase';

import { IndexedDbProductRepository } from '../modules/warehouse/infrastructure/IndexedDbProductRepository';
import { IndexedDbCategoryRepository } from '../modules/warehouse/infrastructure/IndexedDbCategoryRepository';
import { IndexedDbMeasurementUnitRepository } from '../modules/warehouse/infrastructure/IndexedDbMeasurementUnitRepository';
import { IndexedDbCommercialActivityAdapter } from '../modules/warehouse/infrastructure/IndexedDbCommercialActivityAdapter';
import { ProductRecord, ProductStatus } from '../modules/warehouse/domain/entities/ProductRecord';
import { ProductCostLayer } from '../modules/warehouse/domain/entities/ProductCostLayer';
import { WorkdayStatus } from '../modules/warehouse/domain/entities/WorkdayRecord';
import { calculateWorkdayCommercialPerformance } from '../modules/warehouse/domain/entities/WorkdayCommercialPerformance';

// Módulo Ventas
import { CreateOpenSaleAccountUseCase } from '../modules/sales/application/CreateOpenSaleAccountUseCase';
import { UpdateOpenSaleAccountUseCase } from '../modules/sales/application/UpdateOpenSaleAccountUseCase';
import { CancelOpenSaleAccountUseCase } from '../modules/sales/application/CancelOpenSaleAccountUseCase';
import { DispatchSaleUseCase } from '../modules/sales/application/DispatchSaleUseCase';
import { GetSalesDashboardSummaryUseCase } from '../modules/sales/application/GetSalesDashboardSummaryUseCase';
import { IndexedDbSaleRepository } from '../modules/sales/infrastructure/IndexedDbSaleRepository';
import { SaleRecord, SaleStatus } from '../modules/sales/domain/entities/SaleRecord';

interface TestResult {
  readonly id: string;
  readonly module: string;
  readonly name: string;
  readonly status: 'PASS' | 'FAIL';
  readonly message: string;
  readonly durationMs: number;
}

const testResults: TestResult[] = [];

async function runTest(
  id: string,
  module: string,
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    testResults.push({ id, module, name, status: 'PASS', message: 'OK', durationMs });
    console.log(`[PASS] ${id}: ${name} (${durationMs}ms)`);
  } catch (error: any) {
    const durationMs = Date.now() - start;
    const msg = error instanceof Error ? error.message : String(error);
    testResults.push({ id, module, name, status: 'FAIL', message: msg, durationMs });
    console.error(`[FAIL] ${id}: ${name} (${durationMs}ms) -> ${msg}`);
  }
}

function assert(condition: boolean, msg: string): asserts condition {
  if (!condition) {
    throw new Error(`Aserción fallida: ${msg}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: esperado [${expected}], obtenido [${actual}]`);
  }
}

async function resetDatabase(): Promise<IndexedDbEngine> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DATABASE_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  const engine = new IndexedDbEngine();
  await engine.initialize();
  return engine;
}

const adminActor: SessionActor = {
  role: UserRole.ADMIN,
  label: 'Administrador Pruebas',
};

const cashierActor: SessionActor = {
  role: UserRole.CASHIER,
  label: 'Cajero Pruebas',
};

class MemoryBackupFileAdapter {
  public savedFiles = new Map<string, string>();
  public async saveJsonBackup(filename: string, content: string): Promise<void> {
    this.savedFiles.set(filename, content);
  }
  public async readJsonFile(file: File): Promise<string> {
    return file.text();
  }
}

async function createTestProduct(
  engine: IndexedDbEngine,
  opts: {
    name: string;
    sku?: string;
    categoryId: string;
    measurementUnitId: string;
    initialQuantity: number;
    unitCost: number;
    salePrice: number;
  }
): Promise<ProductRecord> {
  const registerProd = new RegisterProductWithInitialEntryUseCase(engine);
  return registerProd.execute(adminActor, {
    name: opts.name,
    sku: opts.sku,
    categoryId: opts.categoryId,
    measurementUnitId: opts.measurementUnitId,
    initialQuantity: opts.initialQuantity,
    unitPurchasePrice: opts.unitCost,
    declaredSalePrice: opts.salePrice,
  });
}

async function main() {
  console.log('===============================================================');
  console.log('FASE 9 — BLOQUE 9.2B: SUITE DE INTEGRACIÓN AUTOMATIZADA');
  console.log('Base de datos: fake-indexeddb aislada en memoria');
  console.log('===============================================================\n');

  // =========================================================================
  // 1. PRUEBAS DE INVENTARIO
  // =========================================================================
  console.log('\n--- 1. PRUEBAS DE INVENTARIO ---');

  await runTest('INV-01', 'Inventario', 'Creación de categorías y unidades requeridas', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);

    const createCat = new CreateCategoryUseCase(catRepo, opRepo);
    const createUnit = new CreateMeasurementUnitUseCase(unitRepo, opRepo);

    const cat = await createCat.execute(adminActor, { name: 'Bebidas' });
    const unit = await createUnit.execute(adminActor, { name: 'Pieza' });

    assert(Boolean(cat.id), 'La categoría debe tener un ID válido');
    assertEqual(cat.name, 'Bebidas', 'Nombre de categoría');
    assert(Boolean(unit.id), 'La unidad debe tener un ID válido');
    assertEqual(unit.name, 'Pieza', 'Nombre de unidad');
  });

  await runTest('INV-02', 'Inventario', 'Creación de producto con existencia inicial y validación de unicidad', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);
    const cat = await new CreateCategoryUseCase(catRepo, opRepo).execute(adminActor, { name: 'Snacks' });
    const unit = await new CreateMeasurementUnitUseCase(unitRepo, opRepo).execute(adminActor, { name: 'Unidad' });

    const prod = await createTestProduct(engine, {
      name: 'Papas Fritas',
      sku: 'PAP-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 50,
      unitCost: 15,
      salePrice: 25,
    });

    assertEqual(prod.name, 'Papas Fritas', 'Nombre de producto');
    assertEqual(prod.currentStock, 50, 'Stock inicial debe ser 50');
    assertEqual(prod.lastPurchasePrice, 15, 'Costo de compra debe ser 15');
    assertEqual(prod.currentSalePrice, 25, 'Precio de venta debe ser 25');

    // Intentar crear producto duplicado por SKU
    let duplicateRejected = false;
    try {
      await createTestProduct(engine, {
        name: 'Papas Fritas Diferente Nombre',
        sku: 'PAP-001',
        categoryId: cat.id,
        measurementUnitId: unit.id,
        initialQuantity: 10,
        unitCost: 15,
        salePrice: 25,
      });
    } catch (err: any) {
      duplicateRejected = true;
      assert(err instanceof DuplicateRecordError || err instanceof ValidationError, 'Debe rechazar SKU duplicado');
    }
    assert(duplicateRejected, 'Debe rechazar la creación de producto con SKU duplicado');
  });

  await runTest('INV-03', 'Inventario', 'Entradas adicionales de mercancía y conservación de capas FIFO', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);
    const cat = await new CreateCategoryUseCase(catRepo, opRepo).execute(adminActor, { name: 'Lácteos' });
    const unit = await new CreateMeasurementUnitUseCase(unitRepo, opRepo).execute(adminActor, { name: 'Litro' });

    const prod = await createTestProduct(engine, {
      name: 'Leche Entera',
      sku: 'LEC-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 20,
      unitCost: 18,
      salePrice: 28,
    });

    const addEntry = new RegisterMerchandiseEntryUseCase(engine);
    const entryRes = await addEntry.execute(adminActor, {
      productId: prod.id,
      receivedQuantity: 30,
      unitPurchasePrice: 20,
      declaredSalePrice: 30,
      declaredEntryDate: '2026-10-28',
    });

    assertEqual(entryRes.product.currentStock, 50, 'Stock acumulado debe ser 50 (20 + 30)');
    assertEqual(entryRes.product.lastPurchasePrice, 20, 'Último precio de compra actualizado a 20');
    assertEqual(entryRes.product.currentSalePrice, 30, 'Precio de venta actualizado a 30');

    // Verificar capas FIFO en almacén
    const layers = await engine.runTransaction([StoreName.WAREHOUSE_COST_LAYERS], 'readonly', (tx) =>
      tx.getAllByIndex<ProductCostLayer>(StoreName.WAREHOUSE_COST_LAYERS, 'by_product_id', prod.id)
    );
    assertEqual(layers.length, 2, 'Debe haber exactamente 2 capas de costo FIFO');
    assertEqual(layers[0].remainingQuantity, 20, 'Capa 1 restante debe ser 20');
    assertEqual(layers[0].unitPurchaseCost, 18, 'Capa 1 costo unitario debe ser 18');
    assertEqual(layers[1].remainingQuantity, 30, 'Capa 2 restante debe ser 30');
    assertEqual(layers[1].unitPurchaseCost, 20, 'Capa 2 costo unitario debe ser 20');
  });

  await runTest('INV-04', 'Inventario', 'Corrección manual de existencias y registro de Kardex', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);
    const cat = await new CreateCategoryUseCase(catRepo, opRepo).execute(adminActor, { name: 'Varios' });
    const unit = await new CreateMeasurementUnitUseCase(unitRepo, opRepo).execute(adminActor, { name: 'Pieza' });
    const prod = await createTestProduct(engine, {
      name: 'Cuaderno',
      sku: 'CUA-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 10,
      unitCost: 10,
      salePrice: 20,
    });

    const correctStock = new CorrectProductStockUseCase(engine);
    const corrected = await correctStock.execute(adminActor, {
      productId: prod.id,
      realPhysicalStock: 8,
      reason: 'Avería de 2 piezas por humedad',
    });

    assertEqual(corrected.product.currentStock, 8, 'Stock debe quedar en 8');
    assertEqual(corrected.movement.signedQuantity, -2, 'Diferencia firmada debe ser -2');
  });

  await runTest('INV-05', 'Inventario', 'Activación y desactivación de productos con auditoría', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);
    const cat = await new CreateCategoryUseCase(catRepo, opRepo).execute(adminActor, { name: 'Temporada' });
    const unit = await new CreateMeasurementUnitUseCase(unitRepo, opRepo).execute(adminActor, { name: 'Pieza' });
    const prod = await createTestProduct(engine, {
      name: 'Artículo Navideño',
      sku: 'NAV-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 5,
      unitCost: 50,
      salePrice: 100,
    });

    const deactivate = new DeactivateProductUseCase(engine);
    const deactRes = await deactivate.execute(adminActor, {
      productId: prod.id,
      reason: 'Fin de temporada',
    });
    assertEqual(deactRes.product.status, ProductStatus.INACTIVE, 'Debe estar INACTIVE');

    const activate = new ActivateProductUseCase(engine);
    const actRes = await activate.execute(adminActor, {
      productId: prod.id,
      reason: 'Reanudación de ventas',
    });
    assertEqual(actRes.product.status, ProductStatus.ACTIVE, 'Debe regresar a ACTIVE');
  });

  // =========================================================================
  // 2. PRUEBAS DE CUENTAS Y DESPACHOS
  // =========================================================================
  console.log('\n--- 2. PRUEBAS DE CUENTAS Y DESPACHOS ---');

  await runTest('VEN-01', 'Ventas', 'Creación, modificación y cancelación de cuenta OPEN sin tocar stock', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);
    const cat = await new CreateCategoryUseCase(catRepo, opRepo).execute(adminActor, { name: 'Comida' });
    const unit = await new CreateMeasurementUnitUseCase(unitRepo, opRepo).execute(adminActor, { name: 'Plato' });

    const prod = await createTestProduct(engine, {
      name: 'Hamburguesa',
      sku: 'HAM-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 15,
      unitCost: 40,
      salePrice: 90,
    });

    // Abrir jornada necesaria para operar ventas
    await new OpenWorkdayUseCase(engine).execute(adminActor, { notes: 'Jornada ventas' });

    const createAccount = new CreateOpenSaleAccountUseCase(engine);
    const openRes = await createAccount.execute(adminActor, {
      accountName: 'Mesa 4',
      items: [{ productId: prod.id, quantity: 2, unitSalePrice: 90 }],
    });

    assertEqual(openRes.sale.status, SaleStatus.OPEN, 'Estado de cuenta debe ser OPEN');
    assertEqual(openRes.sale.totalAmount, 180, 'Total cuenta: 2 x 90 = 180');

    // Verificar que stock permanece intacto en 15
    const prodAfterOpen = await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', (tx) =>
      tx.get<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, prod.id)
    );
    assertEqual(prodAfterOpen!.currentStock, 15, 'Stock no debe cambiar con cuenta OPEN');

    // Modificar cantidad en la cuenta a 3
    const updateAccount = new UpdateOpenSaleAccountUseCase(engine);
    const updRes = await updateAccount.execute(adminActor, {
      saleId: openRes.sale.id,
      accountName: 'Mesa 4 Terraza',
      items: [{ productId: prod.id, quantity: 3, unitSalePrice: 90 }],
      expectedUpdatedAt: openRes.sale.updatedAt,
    });
    assertEqual(updRes.sale.totalAmount, 270, 'Nuevo total debe ser 270');

    // Cancelar cuenta abierta con motivo obligatorio
    const cancelAccount = new CancelOpenSaleAccountUseCase(engine);
    const cancelRes = await cancelAccount.execute(adminActor, {
      saleId: openRes.sale.id,
      reason: 'Cliente canceló el pedido',
      expectedUpdatedAt: updRes.sale.updatedAt,
    });
    assertEqual(cancelRes.sale.status, SaleStatus.CANCELLED, 'Debe quedar CANCELLED');
    assertEqual(cancelRes.sale.cancellationReason, 'Cliente canceló el pedido', 'Motivo guardado');

    // Stock sigue intacto
    const prodAfterCancel = await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', (tx) =>
      tx.get<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, prod.id)
    );
    assertEqual(prodAfterCancel!.currentStock, 15, 'Stock debe seguir en 15 tras cancelación');
  });

  await runTest('VEN-02', 'Ventas', 'Despacho directo y descuento exacto de existencias', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);
    const cat = await new CreateCategoryUseCase(catRepo, opRepo).execute(adminActor, { name: 'Bebidas' });
    const unit = await new CreateMeasurementUnitUseCase(unitRepo, opRepo).execute(adminActor, { name: 'Botella' });
    const prod = await createTestProduct(engine, {
      name: 'Jugo Naranja',
      sku: 'JUG-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 20,
      unitCost: 12,
      salePrice: 25,
    });

    const workday = await new OpenWorkdayUseCase(engine).execute(adminActor, { notes: 'Jornada despacho directo' });

    const dispatchSale = new DispatchSaleUseCase(engine);
    const dispatchRes = await dispatchSale.execute(adminActor, {
      items: [{ productId: prod.id, quantity: 5 }],
    });

    assertEqual(dispatchRes.sale.status, SaleStatus.DISPATCHED, 'Debe estar DISPATCHED');
    assertEqual(dispatchRes.sale.totalAmount, 125, '5 x 25 = 125');
    assertEqual(dispatchRes.sale.dispatchedWorkdayId, workday.workday.id, 'Debe asociarse a la jornada activa');

    const prodAfter = await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', (tx) =>
      tx.get<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, prod.id)
    );
    assertEqual(prodAfter!.currentStock, 15, 'Stock debe ser 15 (20 - 5)');
  });

  await runTest('VEN-03', 'Ventas', 'Rechazo de despacho por stock insuficiente', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);
    const cat = await new CreateCategoryUseCase(catRepo, opRepo).execute(adminActor, { name: 'Varios' });
    const unit = await new CreateMeasurementUnitUseCase(unitRepo, opRepo).execute(adminActor, { name: 'Pieza' });
    const prod = await createTestProduct(engine, {
      name: 'Memoria USB',
      sku: 'USB-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 3,
      unitCost: 60,
      salePrice: 120,
    });

    await new OpenWorkdayUseCase(engine).execute(adminActor, { notes: 'Jornada stock insuficiente' });

    const dispatchSale = new DispatchSaleUseCase(engine);
    let rejected = false;
    try {
      await dispatchSale.execute(adminActor, {
        items: [{ productId: prod.id, quantity: 5 }], // Pide 5 habiendo sólo 3
      });
    } catch (err: any) {
      rejected = true;
      assert(err instanceof ValidationError, 'Debe ser ValidationError');
      assert(err.message.includes('insuficientes'), 'Mensaje debe indicar existencias insuficientes');
    }
    assert(rejected, 'Debe rechazar el despacho por stock insuficiente');
  });

  await runTest('VEN-04', 'Ventas', 'REGLA ESPECIAL DE PRECIOS: Bloqueo de cambio de precio si producto está en cuenta OPEN', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);
    const cat = await new CreateCategoryUseCase(catRepo, opRepo).execute(adminActor, { name: 'Comida' });
    const unit = await new CreateMeasurementUnitUseCase(unitRepo, opRepo).execute(adminActor, { name: 'Porción' });

    const p1 = await createTestProduct(engine, {
      name: 'Pizza Especial',
      sku: 'PIZ-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 10,
      unitCost: 80,
      salePrice: 160,
    });

    const p2 = await createTestProduct(engine, {
      name: 'Ensalada César',
      sku: 'ENS-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 10,
      unitCost: 30,
      salePrice: 70,
    });

    await new OpenWorkdayUseCase(engine).execute(adminActor, { notes: 'Jornada regla de precios' });

    // Crear cuenta OPEN con p1
    const openAcc = await new CreateOpenSaleAccountUseCase(engine).execute(adminActor, {
      accountName: 'Mesa 10',
      items: [{ productId: p1.id, quantity: 1, unitSalePrice: 160 }],
    });

    const updatePrice = new UpdateProductSalePriceUseCase(engine);

    // 1. Intentar cambiar precio de p1 (en cuenta OPEN): DEBE FALLAR
    let p1Blocked = false;
    try {
      await updatePrice.execute(adminActor, {
        productId: p1.id,
        newSalePrice: 180,
        reason: 'Aumento de costo de ingredientes',
      });
    } catch (err: any) {
      p1Blocked = true;
      assert(err instanceof ValidationError, 'Debe lanzar ValidationError');
      assert(err.message.includes('está incluido en las cuentas abiertas'), 'Mensaje debe citar cuentas abiertas');
    }
    assert(p1Blocked, 'P1 debe estar bloqueado para cambio de precio mientras esté en cuenta OPEN');

    // 2. Cambiar precio de p2 (NO está en ninguna cuenta OPEN): DEBE FUNCIONAR
    const p2Updated = await updatePrice.execute(adminActor, {
      productId: p2.id,
      newSalePrice: 85,
      reason: 'Ajuste general',
    });
    assertEqual(p2Updated.product.currentSalePrice, 85, 'P2 debe poder cambiar de precio normalmente');

    // 3. Despachar la cuenta de p1
    await new DispatchSaleUseCase(engine).execute(adminActor, {
      saleId: openAcc.sale.id,
    });

    // 4. Ahora p1 ya no está en ninguna cuenta OPEN: precio debe poder cambiarse
    const p1Updated = await updatePrice.execute(adminActor, {
      productId: p1.id,
      newSalePrice: 180,
      reason: 'Aumento de costo de ingredientes',
    });
    assertEqual(p1Updated.product.currentSalePrice, 180, 'P1 debe poder cambiar de precio tras despachar la cuenta');
  });

  // =========================================================================
  // 3. PRUEBAS FIFO Y RENTABILIDAD
  // =========================================================================
  console.log('\n--- 3. PRUEBAS FIFO Y RENTABILIDAD ---');

  await runTest('FIFO-01', 'FIFO', 'Validación exacta del flujo FIFO del enunciado ($1.700 utilidad bruta)', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);
    const cat = await new CreateCategoryUseCase(catRepo, opRepo).execute(adminActor, { name: 'Electrónica' });
    const unit = await new CreateMeasurementUnitUseCase(unitRepo, opRepo).execute(adminActor, { name: 'Pieza' });

    // Paso 1: Entrada de 10 unidades a costo 200. Precio de venta 350.
    const p = await createTestProduct(engine, {
      name: 'Audífonos Pro',
      sku: 'AUD-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 10,
      unitCost: 200,
      salePrice: 350,
    });

    const workday = await new OpenWorkdayUseCase(engine).execute(adminActor, { notes: 'Jornada prueba FIFO' });
    const dispatchSale = new DispatchSaleUseCase(engine);

    // Paso 2: Despacho de 4 unidades a precio 350.
    const disp1 = await dispatchSale.execute(adminActor, {
      items: [{ productId: p.id, quantity: 4 }],
    });

    assertEqual(disp1.sale.totalAmount, 1400, 'Despacho 1 ventas: 4 x 350 = 1.400');
    assertEqual(disp1.sale.totalCostAmount, 800, 'Despacho 1 costo: 4 x 200 = 800');

    // Paso 3: Entrada adicional de 10 unidades a costo 250.
    await new RegisterMerchandiseEntryUseCase(engine).execute(adminActor, {
      productId: p.id,
      receivedQuantity: 10,
      unitPurchasePrice: 250,
      declaredSalePrice: 350,
      declaredEntryDate: '2026-10-28',
    });

    // Paso 4: Despacho de 8 unidades a precio 350.
    const disp2 = await dispatchSale.execute(adminActor, {
      items: [{ productId: p.id, quantity: 8 }],
    });

    assertEqual(disp2.sale.totalAmount, 2800, 'Despacho 2 ventas: 8 x 350 = 2.800');
    // FIFO: consume 6 restantes de Capa 1 @ 200 ($1.200) + 2 de Capa 2 @ 250 ($500) = $1.700
    assertEqual(disp2.sale.totalCostAmount, 1700, 'Despacho 2 costo FIFO: (6 x 200) + (2 x 250) = 1.700');

    // Comprobaciones en base de datos:
    // 1. Existencias finales: 10 + 10 - 4 - 8 = 8 unidades.
    const finalProd = await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', (tx) =>
      tx.get<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, p.id)
    );
    assertEqual(finalProd!.currentStock, 8, 'Existencias finales deben ser exactamente 8 unidades');

    // 2. Capas de costo restantes: Capa 1 agotada (0), Capa 2 con 8 restantes a costo 250.
    const layers = await engine.runTransaction([StoreName.WAREHOUSE_COST_LAYERS], 'readonly', (tx) =>
      tx.getAllByIndex<ProductCostLayer>(StoreName.WAREHOUSE_COST_LAYERS, 'by_product_id', p.id)
    );
    assertEqual(layers[0].remainingQuantity, 0, 'Capa 1 debe estar totalmente agotada (0)');
    assertEqual(layers[1].remainingQuantity, 8, 'Capa 2 debe conservar exactamente 8 unidades restantes');
    assertEqual(layers[1].unitPurchaseCost, 250, 'Capa 2 costo unitario debe ser 250');

    // 3. Rendimiento acumulado de la jornada:
    const allSales = await engine.runTransaction([StoreName.SALES_RECORDS], 'readonly', (tx) =>
      tx.getAll<SaleRecord>(StoreName.SALES_RECORDS)
    );
    const perf = calculateWorkdayCommercialPerformance(workday.workday.id, allSales);

    assertEqual(perf.totalCommercialValue, 4200, 'Ventas totales acumuladas: 1.400 + 2.800 = 4.200');
    assertEqual(perf.totalCostOfGoodsDispatched, 2500, 'Costo total atribuido: 800 + 1.700 = 2.500');
    assertEqual(perf.grossProfit, 1700, 'Utilidad bruta acumulada: 4.200 - 2.500 = 1.700');
    assertEqual(perf.hasUnknownCosts, false, 'No debe tener costos desconocidos');
  });

  // =========================================================================
  // 4. PRUEBAS DE JORNADAS OPERATIVAS
  // =========================================================================
  console.log('\n--- 4. PRUEBAS DE JORNADAS OPERATIVAS ---');

  await runTest('JOR-01', 'Jornadas', 'Ciclo completo de jornada: Apertura, suspensión, reanudación y cierre', async () => {
    const engine = await resetDatabase();
    const openWorkday = new OpenWorkdayUseCase(engine);

    // 1. Apertura manual
    const w1 = await openWorkday.execute(adminActor, { notes: 'Jornada 1' });
    assertEqual(w1.workday.status, WorkdayStatus.OPEN, 'Estado debe ser OPEN');

    // 2. Bloqueo de apertura duplicada
    let dupBlocked = false;
    try {
      await openWorkday.execute(adminActor, { notes: 'Intento duplicado' });
    } catch (err: any) {
      dupBlocked = true;
      assert(err instanceof ValidationError, 'Debe rechazar apertura simultánea');
    }
    assert(dupBlocked, 'Debe impedir abrir dos jornadas simultáneas');

    // 3. Iniciar cierre -> CLOSING
    const startClosing = new StartWorkdayClosingUseCase(
      engine,
      new PrepareFinalInventorySelectionUseCase(engine, new IndexedDbCommercialActivityAdapter(engine))
    );
    const closingRes = await startClosing.execute(adminActor, { workdayId: w1.workday.id });
    assertEqual(closingRes.workday.status, WorkdayStatus.CLOSING, 'Estado debe ser CLOSING');

    // 4. Suspender cierre -> CLOSING_SUSPENDED
    const suspendClosing = new SuspendWorkdayClosingUseCase(engine);
    const suspendedRes = await suspendClosing.execute(adminActor, {
      workdayId: w1.workday.id,
      reason: 'Llegó un cliente de último minuto',
    });
    assertEqual(suspendedRes.workday.status, WorkdayStatus.CLOSING_SUSPENDED, 'Estado debe ser CLOSING_SUSPENDED');

    // 5. Reanudar cierre -> CLOSING
    const resumeClosing = new ResumeWorkdayClosingUseCase(engine);
    const resumedRes = await resumeClosing.execute(adminActor, { workdayId: w1.workday.id });
    assertEqual(resumedRes.workday.status, WorkdayStatus.CLOSING, 'Estado debe volver a CLOSING');

    // 6. Aprobar cierre definitivo -> CLOSED
    const approveClosing = new ApproveWorkdayClosingUseCase(engine);
    const closedRes = await approveClosing.execute(adminActor, {
      workdayId: w1.workday.id,
      notes: 'Cierre completado sin novedades',
      counts: {},
      differenceReasons: {},
    });
    assertEqual(closedRes.workday.status, WorkdayStatus.CLOSED, 'Estado final debe ser CLOSED');

    // 7. Apertura de una jornada posterior
    const w2 = await openWorkday.execute(adminActor, { notes: 'Jornada 2 siguiente' });
    assertEqual(w2.workday.status, WorkdayStatus.OPEN, 'Nueva jornada debe ser OPEN');
    assertEqual(w2.workday.consecutiveNumber, 2, 'Consecutivo de nueva jornada debe ser 2');
  });

  await runTest('JOR-02', 'Jornadas', 'Bloqueo de cierre de jornada si existen cuentas abiertas', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);
    const cat = await new CreateCategoryUseCase(catRepo, opRepo).execute(adminActor, { name: 'Comida' });
    const unit = await new CreateMeasurementUnitUseCase(unitRepo, opRepo).execute(adminActor, { name: 'Orden' });
    const prod = await createTestProduct(engine, {
      name: 'Tacos',
      sku: 'TAC-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 50,
      unitCost: 10,
      salePrice: 20,
    });

    const w = await new OpenWorkdayUseCase(engine).execute(adminActor, { notes: 'Jornada con cuentas pendientes' });

    // Dejar cuenta abierta
    await new CreateOpenSaleAccountUseCase(engine).execute(adminActor, {
      accountName: 'Mesa 1 Pendiente',
      items: [{ productId: prod.id, quantity: 2, unitSalePrice: 20 }],
    });

    // Intentar iniciar cierre de jornada
    const startClosing = new StartWorkdayClosingUseCase(
      engine,
      new PrepareFinalInventorySelectionUseCase(engine, new IndexedDbCommercialActivityAdapter(engine))
    );

    let blocked = false;
    try {
      await startClosing.execute(adminActor, { workdayId: w.workday.id });
    } catch (err: any) {
      blocked = true;
      assert(err.name === 'PendingOpenAccountsError', 'Debe ser PendingOpenAccountsError');
      assert(err.pendingAccounts.length === 1, 'Debe identificar 1 cuenta pendiente');
    }
    assert(blocked, 'El inicio de cierre debe quedar bloqueado por cuentas abiertas pendientes');
  });

  // =========================================================================
  // 5. PRUEBAS DE CORTES E INVENTARIOS Y RECTIFICACIÓN
  // =========================================================================
  console.log('\n--- 5. PRUEBAS DE CORTES E INVENTARIOS Y RECTIFICACIÓN ---');

  await runTest('COR-01', 'Cortes', 'Flujo completo de corte parcial con conteo ciego y ajuste en Kardex', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);
    const cat = await new CreateCategoryUseCase(catRepo, opRepo).execute(adminActor, { name: 'Bebidas' });
    const unit = await new CreateMeasurementUnitUseCase(unitRepo, opRepo).execute(adminActor, { name: 'Lata' });
    const prod = await createTestProduct(engine, {
      name: 'Refresco Cola',
      sku: 'REF-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 40,
      unitCost: 8,
      salePrice: 15,
    });

    const w = await new OpenWorkdayUseCase(engine).execute(adminActor, { notes: 'Jornada corte parcial' });

    // Despachar 10 unidades
    await new DispatchSaleUseCase(engine).execute(adminActor, {
      items: [{ productId: prod.id, quantity: 10 }],
    });
    // Stock teórico: 30

    // Iniciar corte parcial (selección automática de productos despachados)
    const commAdapter = new IndexedDbCommercialActivityAdapter(engine);
    const createCut = new CreatePartialCutUseCase(engine, commAdapter);
    const cut = await createCut.execute(adminActor, {
      workdayId: w.workday.id,
      notes: 'Corte turno vespertino',
    });

    assertEqual(cut.items.length, 1, 'Debe incluir automáticamente el producto con ventas');
    assertEqual(cut.items[0].productId, prod.id, 'Debe ser el producto despachado');

    // Registrar conteo físico ciego: encontramos 29 unidades (faltante de 1)
    const recordCount = new RecordPartialCutCountUseCase(engine);
    await recordCount.execute(adminActor, {
      cutId: cut.id,
      productId: prod.id,
      countedQuantity: 29,
      differenceReason: 'Faltante de 1 lata por merma',
    });

    // Pasar a revisión
    const proceedToReview = new ProceedToPartialCutReviewUseCase(engine);
    await proceedToReview.execute(adminActor, cut.id);

    // Aprobar corte parcial -> ajusta existencias en almacén
    const approveCut = new ApprovePartialCutUseCase(engine);
    const approvedCut = await approveCut.execute(adminActor, {
      cutId: cut.id,
      notes: 'Aprobado con faltante menor de 1 unidad',
      differenceReasons: {
        [prod.id]: 'Faltante de 1 lata por merma',
      },
    });

    assertEqual(approvedCut.status, 'APPROVED', 'Estado del corte debe ser APPROVED');

    // Existencias resultantes en almacén deben ser 29
    const prodAfterCut = await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', (tx) =>
      tx.get<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, prod.id)
    );
    assertEqual(prodAfterCut!.currentStock, 29, 'Existencia en almacén debe ser 29 tras ajuste del corte');
  });

  await runTest('REC-01', 'Rectificación', 'Rectificación de jornada cerrada con ajustes compensatorios', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);
    const cat = await new CreateCategoryUseCase(catRepo, opRepo).execute(adminActor, { name: 'Varios' });
    const unit = await new CreateMeasurementUnitUseCase(unitRepo, opRepo).execute(adminActor, { name: 'Pieza' });
    const prod = await createTestProduct(engine, {
      name: 'Libreta',
      sku: 'LIB-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 20,
      unitCost: 10,
      salePrice: 20,
    });

    const w = await new OpenWorkdayUseCase(engine).execute(adminActor, { notes: 'Jornada para rectificar' });

    // Iniciar proceso de cierre para transicionar a CLOSING
    const startClosing = new StartWorkdayClosingUseCase(
      engine,
      new PrepareFinalInventorySelectionUseCase(engine, new IndexedDbCommercialActivityAdapter(engine))
    );
    await startClosing.execute(adminActor, { workdayId: w.workday.id });

    // Cerrar jornada con conteo final de 18 unidades
    const approveClosing = new ApproveWorkdayClosingUseCase(engine);
    await approveClosing.execute(adminActor, {
      workdayId: w.workday.id,
      notes: 'Cierre con 18 unidades',
      counts: {
        [prod.id]: 18,
      },
      differenceReasons: {
        [prod.id]: 'Diferencia de cierre',
      },
    });

    // Stock tras cierre = 18
    let prodCheck = await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', (tx) =>
      tx.get<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, prod.id)
    );
    assertEqual(prodCheck!.currentStock, 18, 'Stock tras cierre debe ser 18');

    // Rectificar el cierre: se recontó y en realidad había 19 unidades (+1 de ajuste compensatorio)
    const rectifyClosing = new RectifyWorkdayClosingUseCase(engine);
    const rectRes = await rectifyClosing.execute(adminActor, {
      workdayId: w.workday.id,
      reason: 'Se encontraron piezas en vitrina no contabilizadas',
      counts: {
        [prod.id]: 19,
      },
      differenceReasons: {
        [prod.id]: 'Pieza encontrada en vitrina',
      },
      criticalToken: sessionElevationService.issueCriticalToken(adminActor, 'RECTIFY_WORKDAY'),
    });

    assertEqual(rectRes.rectification.versionNumber, 1, 'Versión de rectificación debe ser 1');

    // Stock debe quedar en 19
    prodCheck = await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', (tx) =>
      tx.get<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, prod.id)
    );
    assertEqual(prodCheck!.currentStock, 19, 'Stock tras rectificación debe ser 19');

    // Verificar rechazo si rectificación causaría stock negativo
    let negRejected = false;
    try {
      await rectifyClosing.execute(adminActor, {
        workdayId: w.workday.id,
        reason: 'Ajuste excesivo erróneo',
        counts: {
          [prod.id]: -5, // Provoca negativo
        },
        differenceReasons: {
          [prod.id]: 'Error',
        },
        criticalToken: sessionElevationService.issueCriticalToken(adminActor, 'RECTIFY_WORKDAY'),
      });
    } catch (err: any) {
      negRejected = true;
      assert(err instanceof ValidationError, 'Debe rechazar ajuste que produzca stock negativo');
    }
    assert(negRejected, 'Debe impedir rectificaciones con existencias negativas');
  });

  // =========================================================================
  // 6. PRUEBAS DE CONCURRENCIA E IDEMPOTENCIA
  // =========================================================================
  console.log('\n--- 6. PRUEBAS DE CONCURRENCIA E IDEMPOTENCIA ---');

  await runTest('CONC-01', 'Concurrencia', 'Idempotencia de despacho con mismo operationId', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);
    const cat = await new CreateCategoryUseCase(catRepo, opRepo).execute(adminActor, { name: 'Snacks' });
    const unit = await new CreateMeasurementUnitUseCase(unitRepo, opRepo).execute(adminActor, { name: 'Bolsa' });
    const prod = await createTestProduct(engine, {
      name: 'Galletas',
      sku: 'GAL-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 30,
      unitCost: 10,
      salePrice: 20,
    });

    await new OpenWorkdayUseCase(engine).execute(adminActor, { notes: 'Jornada idempotencia' });

    const dispatchSale = new DispatchSaleUseCase(engine);
    const opId = 'OP-DISP-SAME-UUID-123';

    // Primer intento
    const res1 = await dispatchSale.execute(adminActor, {
      items: [{ productId: prod.id, quantity: 5 }],
      operationId: opId,
    });
    assertEqual(res1.isDuplicate ?? false, false, 'Primer intento no es duplicado');

    // Re-intento con el mismo operationId (ej. doble clic o retry)
    const res2 = await dispatchSale.execute(adminActor, {
      items: [{ productId: prod.id, quantity: 5 }],
      operationId: opId,
    });
    assertEqual(res2.isDuplicate ?? false, true, 'Segundo intento debe marcarse como duplicado');

    // El stock sólo debe haberse descontado una vez: 30 - 5 = 25
    const prodAfter = await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', (tx) =>
      tx.get<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, prod.id)
    );
    assertEqual(prodAfter!.currentStock, 25, 'El stock sólo debe descontarse una vez');
  });

  await runTest('CONC-02', 'Concurrencia', 'Detección de modificación concurrente con expectedUpdatedAt', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);
    const cat = await new CreateCategoryUseCase(catRepo, opRepo).execute(adminActor, { name: 'Comida' });
    const unit = await new CreateMeasurementUnitUseCase(unitRepo, opRepo).execute(adminActor, { name: 'Orden' });
    const prod = await createTestProduct(engine, {
      name: 'Sopa',
      sku: 'SOP-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 20,
      unitCost: 15,
      salePrice: 35,
    });

    await new OpenWorkdayUseCase(engine).execute(adminActor, { notes: 'Jornada concurrencia cuenta' });

    const createAcc = new CreateOpenSaleAccountUseCase(engine);
    const acc = await createAcc.execute(adminActor, {
      accountName: 'Mesa 1',
      items: [{ productId: prod.id, quantity: 1, unitSalePrice: 35 }],
    });

    const updateAcc = new UpdateOpenSaleAccountUseCase(engine);

    // Usuario A actualiza la cuenta (modifica updatedAt en BD)
    await updateAcc.execute(adminActor, {
      saleId: acc.sale.id,
      accountName: 'Mesa 1 Terraza',
      items: [{ productId: prod.id, quantity: 2, unitSalePrice: 35 }],
      expectedUpdatedAt: acc.sale.updatedAt,
    });

    // Usuario B intenta actualizar con el expectedUpdatedAt viejo
    let conflictDetected = false;
    try {
      await updateAcc.execute(adminActor, {
        saleId: acc.sale.id,
        accountName: 'Mesa 1 Salón',
        items: [{ productId: prod.id, quantity: 3, unitSalePrice: 35 }],
        expectedUpdatedAt: acc.sale.updatedAt, // Desactualizado
      });
    } catch (err: any) {
      conflictDetected = true;
      assert(err instanceof ValidationError, 'Debe lanzar ValidationError');
      assert(err.message.includes('fue modificada recientemente'), 'Mensaje de conflicto de concurrencia');
    }
    assert(conflictDetected, 'Debe detectar conflicto de concurrencia optimista');
  });

  // =========================================================================
  // 7. PRUEBAS DE SEGURIDAD Y PERMISOS
  // =========================================================================
  console.log('\n--- 7. PRUEBAS DE SEGURIDAD Y PERMISOS ---');

  await runTest('SEC-01', 'Seguridad', 'Rechazo de operaciones restringidas para rol CASHIER', async () => {
    const engine = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const opRepo = new IndexedDbOperationLogRepository(engine);

    // 1. Modificar precio
    let priceBlocked = false;
    try {
      await new UpdateProductSalePriceUseCase(engine).execute(cashierActor, {
        productId: 'PRD-1',
        newSalePrice: 100,
        reason: 'Intento cajero',
      });
    } catch (err: any) {
      priceBlocked = true;
      assert(err instanceof UnauthorizedOperationError, 'Debe ser UnauthorizedOperationError');
    }
    assert(priceBlocked, 'Cajero no puede modificar precios');

    // 2. Crear categoría
    let catBlocked = false;
    try {
      await new CreateCategoryUseCase(catRepo, opRepo).execute(cashierActor, { name: 'Nueva' });
    } catch (err: any) {
      catBlocked = true;
      assert(err instanceof UnauthorizedOperationError, 'Debe ser UnauthorizedOperationError');
    }
    assert(catBlocked, 'Cajero no puede crear categorías');

    // 3. Iniciar cierre de jornada
    let closeBlocked = false;
    try {
      await new StartWorkdayClosingUseCase(
        engine,
        new PrepareFinalInventorySelectionUseCase(engine, new IndexedDbCommercialActivityAdapter(engine))
      ).execute(cashierActor, { workdayId: 'W-1' });
    } catch (err: any) {
      closeBlocked = true;
      assert(err instanceof UnauthorizedOperationError, 'Debe ser UnauthorizedOperationError');
    }
    assert(closeBlocked, 'Cajero no puede iniciar cierre de jornada');

    // 4. Exportar backup
    let backupBlocked = false;
    try {
      const backupRepo = new IndexedDbSystemBackupRepository(engine);
      await new ExportBackupUseCase(backupRepo, new MemoryBackupFileAdapter()).execute(cashierActor);
    } catch (err: any) {
      backupBlocked = true;
      assert(err instanceof UnauthorizedOperationError, 'Debe ser UnauthorizedOperationError');
    }
    assert(backupBlocked, 'Cajero no puede exportar backup');
  });

  await runTest('SEC-02', 'Seguridad', 'Restricción de costos e ingresos diarios en dashboard para CASHIER', async () => {
    const engine = await resetDatabase();
    const saleRepo = new IndexedDbSaleRepository(engine);
    const prodRepo = new IndexedDbProductRepository(engine);
    const dashUseCase = new GetSalesDashboardSummaryUseCase(saleRepo, prodRepo);

    const cashierSummary = await dashUseCase.execute(cashierActor, null);
    assertEqual(cashierSummary.canViewDailyIncome, false, 'Cajero no puede ver ingresos diarios');
    assertEqual(cashierSummary.canViewCosts, false, 'Cajero no puede ver costos');
    assertEqual(cashierSummary.completedSalesCount, null, 'Cajero no debe recibir conteo de ventas diarias');
    assertEqual(cashierSummary.dispatchedAmount, null, 'Cajero no debe recibir monto despachado acumulado');

    const adminSummary = await dashUseCase.execute(adminActor, null);
    assertEqual(adminSummary.canViewDailyIncome, true, 'Admin puede ver ingresos diarios');
    assertEqual(adminSummary.canViewCosts, true, 'Admin puede ver costos');
  });

  // =========================================================================
  // 8. PRUEBAS DE RESPALDO Y RESTAURACIÓN
  // =========================================================================
  console.log('\n--- 8. PRUEBAS DE RESPALDO Y RESTAURACIÓN ---');

  await runTest('BAK-01', 'Backup', 'Ciclo completo de exportación y restauración atómica con verificación SHA-256', async () => {
    const engineA = await resetDatabase();
    const catRepo = new IndexedDbCategoryRepository(engineA);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engineA);
    const opRepo = new IndexedDbOperationLogRepository(engineA);
    const cat = await new CreateCategoryUseCase(catRepo, opRepo).execute(adminActor, { name: 'Papelería' });
    const unit = await new CreateMeasurementUnitUseCase(unitRepo, opRepo).execute(adminActor, { name: 'Pieza' });
    await createTestProduct(engineA, {
      name: 'Pluma Azul',
      sku: 'PLU-001',
      categoryId: cat.id,
      measurementUnitId: unit.id,
      initialQuantity: 100,
      unitCost: 3,
      salePrice: 8,
    });

    const fileAdapter = new MemoryBackupFileAdapter();
    const backupRepoA = new IndexedDbSystemBackupRepository(engineA);
    const exportUseCase = new ExportBackupUseCase(backupRepoA, fileAdapter);

    // 1. Exportar backup
    const filename = await exportUseCase.execute(adminActor);
    const jsonContent = fileAdapter.savedFiles.get(filename);
    assert(Boolean(jsonContent), 'Archivo de backup generado');

    const envelope: SystemBackupEnvelope = JSON.parse(jsonContent!);
    assertEqual(envelope.schemaVersion, 10, 'Versión de esquema debe ser 10');
    assert(Boolean(envelope.checksum), 'Debe tener checksum SHA-256');

    // 2. Restaurar en una base limpia
    const engineB = await resetDatabase();
    const backupRepoB = new IndexedDbSystemBackupRepository(engineB);
    const restoreUseCase = new RestoreBackupUseCase(backupRepoB, fileAdapter);

    // Archivo simulado para File API
    const mockFile = {
      name: filename,
      text: async () => jsonContent!,
    } as unknown as File;

    await restoreUseCase.execute(
      adminActor,
      mockFile,
      sessionElevationService.issueCriticalToken(adminActor, 'RESTORE_BACKUP')
    );

    // Verificar que los datos se restauraron en engineB
    const restoredProds = await engineB.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', (tx) =>
      tx.getAll<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS)
    );
    assertEqual(restoredProds.length, 1, 'Debe haberse restaurado 1 producto');
    assertEqual(restoredProds[0].name, 'Pluma Azul', 'Nombre restaurado correctamente');
    assertEqual(restoredProds[0].currentStock, 100, 'Stock restaurado correctamente');
  });

  await runTest('BAK-02', 'Backup', 'Rechazo de archivo de respaldo alterado (Checksum SHA-256 no coincide)', async () => {
    const engine = await resetDatabase();
    const backupRepo = new IndexedDbSystemBackupRepository(engine);
    const restoreUseCase = new RestoreBackupUseCase(backupRepo, new MemoryBackupFileAdapter());

    // Crear un backup simulado alterado intencionalmente
    const tamperedEnvelope = {
      format: 'ESTABLECIMIENTO_BACKUP_V1',
      schemaVersion: 10,
      exportedAt: '2026-10-28T10:00:00.000Z',
      checksum: 'hash_falso_invalido_1234567890abcdef',
      stores: {
        warehouse_products: [{ id: 'fake', name: 'Malicioso' }],
      },
    };

    const mockFile = {
      name: 'backup_alterado.json',
      text: async () => JSON.stringify(tamperedEnvelope),
    } as unknown as File;

    let rejected = false;
    try {
      await restoreUseCase.execute(
        adminActor,
        mockFile,
        sessionElevationService.issueCriticalToken(adminActor, 'RESTORE_BACKUP')
      );
    } catch (err: any) {
      rejected = true;
      assert(err instanceof BackupValidationError, 'Debe ser BackupValidationError');
      assert(
        err.message.includes('verificación') || err.message.includes('corrupto'),
        'Mensaje debe indicar error de verificación o archivo corrupto'
      );
    }
    assert(rejected, 'Debe rechazar respaldo con checksum alterado');
  });

  // =========================================================================
  // RESUMEN FINAL
  // =========================================================================
  const total = testResults.length;
  const passed = testResults.filter((t) => t.status === 'PASS').length;
  const failed = testResults.filter((t) => t.status === 'FAIL').length;

  console.log('\n===============================================================');
  console.log('RESUMEN DE PRUEBAS AUTOMATIZADAS DE INTEGRACIÓN');
  console.log('===============================================================');
  console.log(`Total de pruebas ejecutadas: ${total}`);
  console.log(`Pruebas aprobadas:           ${passed}`);
  console.log(`Pruebas fallidas:            ${failed}`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error fatal durante la suite de pruebas:', err);
  process.exit(1);
});
