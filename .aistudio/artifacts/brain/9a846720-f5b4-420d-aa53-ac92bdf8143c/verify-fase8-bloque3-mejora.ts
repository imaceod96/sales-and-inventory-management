import 'fake-indexeddb/auto';
import { IndexedDbEngine } from '../../../src/shared/lib/indexeddb/IndexedDbEngine';
import { StoreName } from '../../../src/shared/lib/indexeddb/schema';
import { SessionActor, UserRole } from '../../../src/shared/types/permissions';
import { IndexedDbOperationLogRepository } from '../../../src/modules/core/infrastructure/IndexedDbOperationLogRepository';
import { IndexedDbCategoryRepository } from '../../../src/modules/warehouse/infrastructure/IndexedDbCategoryRepository';
import { IndexedDbMeasurementUnitRepository } from '../../../src/modules/warehouse/infrastructure/IndexedDbMeasurementUnitRepository';
import { IndexedDbProductRepository } from '../../../src/modules/warehouse/infrastructure/IndexedDbProductRepository';
import { IndexedDbInventoryCutRepository } from '../../../src/modules/warehouse/infrastructure/IndexedDbInventoryCutRepository';
import { IndexedDbWorkdayRepository } from '../../../src/modules/warehouse/infrastructure/IndexedDbWorkdayRepository';
import { IndexedDbCommercialActivityAdapter } from '../../../src/modules/warehouse/infrastructure/IndexedDbCommercialActivityAdapter';
import { IndexedDbSaleRepository } from '../../../src/modules/sales/infrastructure/IndexedDbSaleRepository';
import { CreateCategoryUseCase } from '../../../src/modules/warehouse/application/CreateCategoryUseCase';
import { CreateMeasurementUnitUseCase } from '../../../src/modules/warehouse/application/CreateMeasurementUnitUseCase';
import { RegisterProductWithInitialEntryUseCase } from '../../../src/modules/warehouse/application/RegisterProductWithInitialEntryUseCase';
import { UpdateProductSalePriceUseCase } from '../../../src/modules/warehouse/application/UpdateProductSalePriceUseCase';
import { OpenWorkdayUseCase } from '../../../src/modules/warehouse/application/OpenWorkdayUseCase';
import { CreatePartialCutUseCase } from '../../../src/modules/warehouse/application/CreatePartialCutUseCase';
import { RecordPartialCutCountUseCase } from '../../../src/modules/warehouse/application/RecordPartialCutCountUseCase';
import { ProceedToPartialCutReviewUseCase } from '../../../src/modules/warehouse/application/ProceedToPartialCutReviewUseCase';
import { ApprovePartialCutUseCase } from '../../../src/modules/warehouse/application/ApprovePartialCutUseCase';
import { GetPartialCutDetailUseCase } from '../../../src/modules/warehouse/application/GetPartialCutDetailUseCase';
import { ListWorkdayPartialCutsUseCase } from '../../../src/modules/warehouse/application/ListWorkdayPartialCutsUseCase';
import { GetWorkdayDetailUseCase } from '../../../src/modules/warehouse/application/GetWorkdayDetailUseCase';
import { CreateOpenSaleAccountUseCase } from '../../../src/modules/sales/application/CreateOpenSaleAccountUseCase';
import { DispatchSaleUseCase } from '../../../src/modules/sales/application/DispatchSaleUseCase';
import { CancelOpenSaleAccountUseCase } from '../../../src/modules/sales/application/CancelOpenSaleAccountUseCase';
import { PartialCutStatus, PartialInventoryCutRecord } from '../../../src/modules/warehouse/domain/entities/InventoryCutRecord';
import { SaleRecord, SaleStatus } from '../../../src/modules/sales/domain/entities/SaleRecord';
import { InventoryMovementRecord } from '../../../src/modules/warehouse/domain/entities/InventoryMovementRecord';

const adminActor: SessionActor = {
  id: 'admin-1',
  role: UserRole.ADMINISTRATOR,
  label: 'Administrador General',
};

const cashierActor: SessionActor = {
  id: 'cashier-1',
  role: UserRole.CASHIER,
  label: 'Cajero Principal',
};

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runVerification() {
  console.log('=== INICIANDO SUITE DE PRUEBAS FASE 8 - MEJORA DEL BLOQUE 3 (24 CASOS) ===');
  let passed = 0;

  const engine = new IndexedDbEngine();
  await engine.initialize();

  const opLogRepo = new IndexedDbOperationLogRepository(engine);
  const categoryRepo = new IndexedDbCategoryRepository(engine);
  const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
  const productRepo = new IndexedDbProductRepository(engine);
  const cutRepo = new IndexedDbInventoryCutRepository(engine);
  const workdayRepo = new IndexedDbWorkdayRepository(engine);
  const saleRepo = new IndexedDbSaleRepository(engine);
  const commercialAdapter = new IndexedDbCommercialActivityAdapter(engine);

  const createCategory = new CreateCategoryUseCase(categoryRepo, opLogRepo);
  const createUnit = new CreateMeasurementUnitUseCase(unitRepo, opLogRepo);
  const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
  const updateSalePrice = new UpdateProductSalePriceUseCase(engine);
  const openWorkday = new OpenWorkdayUseCase(engine);
  const createCut = new CreatePartialCutUseCase(engine, commercialAdapter);
  const recordCount = new RecordPartialCutCountUseCase(engine);
  const proceedReview = new ProceedToPartialCutReviewUseCase(engine);
  const approveCut = new ApprovePartialCutUseCase(engine);
  const getCutDetail = new GetPartialCutDetailUseCase(engine);
  const listWorkdayCuts = new ListWorkdayPartialCutsUseCase(workdayRepo, cutRepo, saleRepo);
  const getWorkdayDetail = new GetWorkdayDetailUseCase(engine);
  const createOpenAccount = new CreateOpenSaleAccountUseCase(engine);
  const dispatchSale = new DispatchSaleUseCase(engine);
  const cancelOpenAccount = new CancelOpenSaleAccountUseCase(engine);

  // Preparación de catálogo base (2 unidades distintas: Pieza y Kilogramo)
  const cat = await createCategory.execute(adminActor, { name: 'Abarrotes Test' });
  const unitPiece = await createUnit.execute(adminActor, { name: 'Pieza Test', symbol: 'pz' });
  const unitKg = await createUnit.execute(adminActor, { name: 'Kilogramo Test', symbol: 'kg' });

  const prodA = (
    await registerProduct.execute(adminActor, {
      name: 'Café Molido 500g',
      sku: 'CAF-500',
      categoryId: cat.id,
      measurementUnitId: unitPiece.id,
      initialQuantity: 100,
      unitPurchasePrice: 80,
      declaredSalePrice: 120,
    })
  ).product;

  const prodB = (
    await registerProduct.execute(adminActor, {
      name: 'Galletas Surtidas Caja',
      sku: 'GAL-100',
      categoryId: cat.id,
      measurementUnitId: unitPiece.id,
      initialQuantity: 50,
      unitPurchasePrice: 40,
      declaredSalePrice: 60,
    })
  ).product;

  const prodKg = (
    await registerProduct.execute(adminActor, {
      name: 'Azúcar Estándar Granel',
      sku: 'AZU-KG',
      categoryId: cat.id,
      measurementUnitId: unitKg.id,
      initialQuantity: 200,
      unitPurchasePrice: 20,
      declaredSalePrice: 30,
    })
  ).product;

  // Abrir jornada operativa
  const workday = await openWorkday.execute(adminActor, { notes: 'Jornada de prueba Bloque 3 Mejora' });
  await sleep(15);

  // =========================================================================
  // CASO 2: Corte parcial sin despachos muestra actividad comercial en cero.
  // =========================================================================
  const emptyCut = await createCut.execute(adminActor, { notes: 'Corte vacío' });
  const emptyDetail = await getCutDetail.execute(adminActor, emptyCut.id);
  assert(
    emptyDetail.commercialActivity.totalDispatchesCount === 0 &&
      emptyDetail.commercialActivity.distinctProductsCount === 0 &&
      emptyDetail.commercialActivity.totalCommercialValue === 0 &&
      emptyDetail.commercialActivity.productBreakdown.length === 0,
    'Caso 2: Corte parcial sin despachos debe mostrar actividad comercial en cero'
  );
  console.log('✓ Caso 2 superado: Corte parcial sin despachos muestra actividad comercial en cero');
  passed++;

  // Cancelamos el borrador vacío para continuar con el primer intervalo limpio
  const { CancelPartialCutUseCase } = await import('../../../src/modules/warehouse/application/CancelPartialCutUseCase');
  const cancelCut = new CancelPartialCutUseCase(engine);
  await cancelCut.execute(adminActor, { cutId: emptyCut.id, reason: 'Limpieza de corte sin despachos' });
  await sleep(15);

  // =========================================================================
  // OPERACIONES EN INTERVALO DEL CORTE #2 (Primer corte aprobado de la jornada)
  // =========================================================================
  // 1) Despacho directo de prodA (2 pz a $120 = $240) y prodB (3 pz a $60 = $180) -> Subtotal $420
  const direct1 = await dispatchSale.execute(adminActor, {
    items: [
      { productId: prodA.id, quantity: 2 },
      { productId: prodB.id, quantity: 3 },
    ],
  });
  await sleep(15);

  // 2) Cambio de precio de prodA de $120 a $150 durante el mismo intervalo
  await updateSalePrice.execute(adminActor, {
    productId: prodA.id,
    newSalePrice: 150,
    reason: 'Ajuste de precio durante intervalo',
  });
  await sleep(15);

  // 3) Cuenta abierta creada y despachada en el intervalo con el nuevo precio de prodA (1 pz a $150 = $150)
  const openAccDispatched = await createOpenAccount.execute(adminActor, {
    accountName: 'Mesa 5 Despachada',
    items: [{ productId: prodA.id, quantity: 1 }],
  });
  await sleep(10);
  const dispatchedFromOpen = await dispatchSale.execute(adminActor, {
    saleId: openAccDispatched.sale.id,
  });
  await sleep(15);

  // 4) Cuenta abierta creada y luego CANCELADA sin despacho (NO debe sumarse)
  const openAccCancelled = await createOpenAccount.execute(adminActor, {
    accountName: 'Cliente Cancelado',
    items: [{ productId: prodB.id, quantity: 10 }],
  });
  await cancelOpenAccount.execute(adminActor, {
    saleId: openAccCancelled.sale.id,
    reason: 'Cliente se retiró sin mercancía',
  });
  await sleep(15);

  // Contar movimientos antes de crear y aprobar corte
  const movementsBeforeCut1 = await engine.runInTransaction(
    [StoreName.INVENTORY_MOVEMENTS],
    'readonly',
    (tx) => tx.getAll<InventoryMovementRecord>(StoreName.INVENTORY_MOVEMENTS)
  );

  // Crear Corte Parcial #2 (cubre desde apertura hasta ahora)
  const cut1 = await createCut.execute(adminActor, { notes: 'Primer corte con ventas reales' });
  await sleep(15);

  // 5) Después del cierre del intervalo de cut1, se crea una cuenta ABIERTA y un despacho posterior
  // Ninguno debe afectar a cut1
  const postCutDispatch = await dispatchSale.execute(adminActor, {
    items: [{ productId: prodB.id, quantity: 5 }], // 5 * 60 = $300 en el siguiente intervalo
  });
  await sleep(10);
  const openAccStillOpen = await createOpenAccount.execute(adminActor, {
    accountName: 'Cuenta Abierta Activa',
    items: [{ productId: prodA.id, quantity: 4 }],
  });

  // Capturar conteo físico exacto (sin diferencias físicas) para prodA (stock al corte: 97, menos 0 = 97) y prodB (stock al corte: 47, menos 5 post-corte = 42 conciliado, o contamos 47 antes del post-corte? Ojo: el conteo se realiza AHORA que el stock real de prodB es 42)
  // Como postCutDispatch ocurrió DESPUÉS de cut1.intervalEndAt y ANTES de countedAt, es un preCountDelta (-5), por lo que el stock teórico reconciliado es 47 - 5 = 42. Contamos 97 para prodA y 42 para prodB -> 0 diferencias físicas!
  await recordCount.execute(adminActor, { cutId: cut1.id, productId: prodA.id, countedQuantity: 97 });
  await recordCount.execute(adminActor, { cutId: cut1.id, productId: prodB.id, countedQuantity: 42 });
  await proceedReview.execute(adminActor, cut1.id);

  // Antes de aprobar cut1, posterior cambio de precio al catálogo para verificar que no altera importes históricos
  await updateSalePrice.execute(adminActor, {
    productId: prodB.id,
    newSalePrice: 95,
    reason: 'Alza posterior al corte',
  });

  const approvedCut1Res = await approveCut.execute(adminActor, {
    cutId: cut1.id,
    differenceReasons: {},
    notes: 'Corte exacto sin diferencias físicas',
  });

  const cut1Detail = await getCutDetail.execute(adminActor, cut1.id);
  const ca1 = cut1Detail.commercialActivity;

  // =========================================================================
  // VALIDACIÓN DE CASOS 1, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21, 22
  // =========================================================================

  // Caso 1: Corte parcial con ventas y sin diferencias muestra actividad comercial positiva y balance de inventario en cero
  assert(
    ca1.totalCommercialValue === 570 &&
      cut1Detail.summary.netSaleBalance === 0 &&
      cut1Detail.summary.netPurchaseBalance === 0 &&
      cut1Detail.summary.productsWithShortage === 0 &&
      cut1Detail.summary.productsWithSurplus === 0,
    `Caso 1: Actividad comercial ($${ca1.totalCommercialValue}) debe ser $570 y balance inventario $0`
  );
  console.log('✓ Caso 1 superado: Actividad comercial positiva ($570.00) y balance de inventario en $0.00');
  passed++;

  // Caso 3: Despachos directos del intervalo se incluyen correctamente
  assert(
    ca1.totalDispatchesCount === 2,
    `Caso 3: Debe incluir el despacho directo y la cuenta abierta despachada (esperado 2, obtenido ${ca1.totalDispatchesCount})`
  );
  console.log('✓ Caso 3 superado: Despachos directos incluidos correctamente');
  passed++;

  // Caso 4: Cuentas abiertas despachadas dentro del intervalo se incluyen correctamente
  const prodABreakdown = ca1.productBreakdown.find((p) => p.productId === prodA.id)!;
  assert(
    prodABreakdown && prodABreakdown.dispatchesCount === 2 && prodABreakdown.totalDispatchedQuantity === 3,
    'Caso 4: Cuenta abierta despachada en el intervalo incluida en desglose'
  );
  console.log('✓ Caso 4 superado: Cuentas abiertas despachadas dentro del intervalo incluidas correctamente');
  passed++;

  // Caso 5: Cuentas abiertas NO despachadas (openAccStillOpen) NO se incluyen
  assert(
    prodABreakdown.totalDispatchedQuantity === 3, // No incluye las 4 unidades de openAccStillOpen
    'Caso 5: Cuenta abierta no despachada no debe sumarse'
  );
  console.log('✓ Caso 5 superado: Cuentas abiertas no despachadas excluidas');
  passed++;

  // Caso 6: Cuentas canceladas NO se incluyen
  const prodBBreakdown = ca1.productBreakdown.find((p) => p.productId === prodB.id)!;
  assert(
    prodBBreakdown && prodBBreakdown.totalDispatchedQuantity === 3, // No incluye las 10 de openAccCancelled ni las 5 de postCutDispatch
    `Caso 6: Cuenta cancelada y despacho post-corte no deben incluirse (obtenido ${prodBBreakdown?.totalDispatchedQuantity})`
  );
  console.log('✓ Caso 6 superado: Cuentas canceladas excluidas');
  passed++;

  // Caso 7: Cada despacho se contabiliza una sola vez aunque tenga varios productos
  assert(
    ca1.totalDispatchesCount === 2 && ca1.distinctProductsCount === 2,
    'Caso 7: Despacho con múltiples líneas se contabiliza 1 sola vez en totalDispatchesCount'
  );
  console.log('✓ Caso 7 superado: Cada despacho se contabiliza una sola vez aunque tenga varios productos');
  passed++;

  // Caso 8: Solo se incluyen despachos dentro del intervalo del corte (postCutDispatch quedó fuera)
  assert(
    ca1.totalCommercialValue === 570,
    'Caso 8: Despachos fuera del intervalo (postCutDispatch de $300) no se incluyen en cut1'
  );
  console.log('✓ Caso 8 superado: Solo se incluyen despachos dentro del intervalo del corte');
  passed++;

  // Caso 10: Se usan los precios históricos del despacho ($60 para prodB y $120/$150 para prodA)
  assert(
    prodBBreakdown.historicalUnitPrices.length === 1 &&
      prodBBreakdown.historicalUnitPrices[0] === 60 &&
      prodBBreakdown.totalCommercialAmount === 180,
    'Caso 10: Precio histórico congelado en el despacho ($60)'
  );
  console.log('✓ Caso 10 superado: Se utilizan estrictamente los precios históricos congelados en cada despacho');
  passed++;

  // Caso 11: Un cambio posterior de precio en el catálogo ($95 para prodB) no altera el importe del corte ($180)
  assert(
    prodBBreakdown.totalCommercialAmount === 180,
    'Caso 11: El cambio posterior de precio a $95 no alteró el subtotal histórico de $180'
  );
  console.log('✓ Caso 11 superado: Cambio posterior de precio en catálogo no altera el importe del corte');
  passed++;

  // Caso 12: Productos repetidos en varios despachos se consolidan en una sola fila del desglose
  assert(
    ca1.productBreakdown.filter((p) => p.productId === prodA.id).length === 1 &&
      prodABreakdown.totalDispatchedQuantity === 3 &&
      prodABreakdown.dispatchesCount === 2,
    'Caso 12: Producto repetido en varios despachos consolidado en una sola fila'
  );
  console.log('✓ Caso 12 superado: Productos repetidos en varios despachos consolidados en una sola fila');
  passed++;

  // Caso 13: Productos con varios precios históricos dentro del mismo intervalo ($120 y $150) calculan correctamente su importe total (2*120 + 1*150 = $390)
  assert(
    prodABreakdown.historicalUnitPrices.length === 2 &&
      prodABreakdown.historicalUnitPrices.includes(120) &&
      prodABreakdown.historicalUnitPrices.includes(150) &&
      prodABreakdown.totalCommercialAmount === 390,
    `Caso 13: Múltiples precios históricos ($120 y $150) suman exactamente $390 (obtenido ${prodABreakdown.totalCommercialAmount})`
  );
  console.log('✓ Caso 13 superado: Productos con varios precios históricos en el mismo intervalo calculan importe exacto ($390.00)');
  passed++;

  // Unidades compatibles en cut1 (ambos productos usan 'pz')
  assert(
    ca1.areUnitsComparable === true &&
      ca1.comparableTotalQuantity === 6 &&
      ca1.comparableUnitSymbol === 'pz',
    'Unidades compatibles (pz) suman cantidad total 6 pz'
  );

  // =========================================================================
  // SEGUNDO CORTE PARCIAL CONSECUTIVO (CON UNIDADES INCOMPATIBLES Y FALTANTE FÍSICO)
  // =========================================================================
  // Primero cancelamos la cuenta abierta pendiente para desbloquear el segundo corte parcial
  await cancelOpenAccount.execute(adminActor, {
    saleId: openAccStillOpen.sale.id,
    reason: 'Liberar bloqueo para segundo corte parcial',
  });
  await sleep(15);

  // En este segundo intervalo ya ocurrió `postCutDispatch` (5 pz de prodB a $60 = $300, antes de subir a $95).
  // Ahora despachamos 2.5 kg de prodKg a $30 = $75.
  await dispatchSale.execute(adminActor, {
    items: [{ productId: prodKg.id, quantity: 2.5 }],
  });
  await sleep(15);

  // Creamos el segundo corte parcial consecutivo
  const cut2 = await createCut.execute(adminActor, { notes: 'Segundo corte con unidades mixtas y faltante' });

  // Capturamos conteo físico:
  // prodB tiene stock teórico 42 -> contamos 40 (faltante de 2 pz -> -$190 P.V., -$80 Costo)
  // prodKg tiene stock teórico 197.5 -> contamos 197.5 (sin diferencia)
  await recordCount.execute(adminActor, {
    cutId: cut2.id,
    productId: prodB.id,
    countedQuantity: 40,
    differenceReason: 'Merma detectada en vitrina',
  });
  await recordCount.execute(adminActor, {
    cutId: cut2.id,
    productId: prodKg.id,
    countedQuantity: 197.5,
  });
  await proceedReview.execute(adminActor, cut2.id);
  await approveCut.execute(adminActor, {
    cutId: cut2.id,
    differenceReasons: { [prodB.id]: 'Merma detectada en vitrina' },
    notes: 'Aprobación segundo corte',
  });

  const cut2Detail = await getCutDetail.execute(adminActor, cut2.id);
  const ca2 = cut2Detail.commercialActivity;

  // Caso 9: No se duplican despachos entre cortes parciales consecutivos
  // cut1 tuvo 2 despachos ($570); cut2 debe tener únicamente los 2 despachos del segundo intervalo ($300 + $75 = $375)
  assert(
    ca2.totalDispatchesCount === 2 &&
      ca2.distinctProductsCount === 2 &&
      ca2.totalCommercialValue === 375 &&
      !ca2.productBreakdown.some((p) => p.productId === prodA.id),
    `Caso 9: No se duplican despachos entre cortes consecutivos (esperado $375, obtenido $${ca2.totalCommercialValue})`
  );
  console.log('✓ Caso 9 superado: No se duplican ni pierden despachos entre cortes parciales consecutivos');
  passed++;

  // Caso 14: No se suman cantidades físicas de productos con unidades incompatibles (pz vs kg)
  assert(
    ca2.areUnitsComparable === false &&
      ca2.comparableTotalQuantity === null &&
      ca2.comparableUnitSymbol === null,
    'Caso 14: Unidades incompatibles (pz y kg) no suman cantidades físicas globales'
  );
  console.log('✓ Caso 14 superado: No se suman cantidades físicas de productos con unidades incompatibles');
  passed++;

  // Caso 15, 16 y 17: El resumen separa claramente Actividad Comercial ($375.00), Balance de Inventario (-$190.00 P.V. / -$80.00 Costo), sin mezclarlos
  assert(
    ca2.totalCommercialValue === 375 &&
      cut2Detail.summary.totalShortageSaleValue === 190 &&
      cut2Detail.summary.totalShortagePurchaseValue === 80 &&
      cut2Detail.summary.netSaleBalance === -190 &&
      cut2Detail.summary.netPurchaseBalance === -80,
    'Casos 15, 16 y 17: Actividad comercial ($375) separada del Balance económico de inventario (-$190 P.V. / -$80 Costo)'
  );
  console.log('✓ Casos 15, 16 y 17 superados: Actividad comercial y Balance económico separados e íntegros');
  passed += 3;

  // Caso 18: Un corte aprobado conserva su resumen histórico (y si un corte histórico previo no tenía commercialActivity, se proyecta en solo lectura sin mutar IndexedDB)
  await sleep(15);
  // Realizamos un despacho nuevo después de aprobar cut2; NO debe alterar cut2
  await dispatchSale.execute(adminActor, {
    items: [{ productId: prodA.id, quantity: 5 }],
  });
  const cut2Reloaded = await getCutDetail.execute(adminActor, cut2.id);
  assert(
    cut2Reloaded.commercialActivity.totalCommercialValue === 375 &&
      cut2Reloaded.cut.status === PartialCutStatus.APPROVED,
    'Caso 18: Corte aprobado conserva su resumen histórico inalterado ante ventas posteriores'
  );
  console.log('✓ Caso 18 superado: Un corte aprobado conserva su resumen histórico inmutable');
  passed++;

  // Caso 19: El expediente histórico de la jornada muestra correctamente la actividad comercial y el balance de cada corte parcial
  const dossier = await getWorkdayDetail.execute(adminActor, workday.id);
  const dossierCut1 = dossier.partialCuts.find((c) => c.id === cut1.id)!;
  const dossierCut2 = dossier.partialCuts.find((c) => c.id === cut2.id)!;
  assert(
    dossierCut1.commercialActivity?.totalDispatchesCount === 2 &&
      dossierCut1.commercialActivity?.totalCommercialValue === 570 &&
      dossierCut1.summary?.netSaleBalance === 0 &&
      dossierCut2.commercialActivity?.totalDispatchesCount === 2 &&
      dossierCut2.commercialActivity?.totalCommercialValue === 375 &&
      dossierCut2.summary?.netSaleBalance === -190,
    'Caso 19: Expediente de jornada muestra actividad comercial y balance neto de cada corte'
  );
  console.log('✓ Caso 19 superado: El expediente histórico de la jornada muestra actividad comercial y balance de cada corte');
  passed++;

  // Caso 20: No se generan movimientos de stock adicionales por el cálculo del resumen comercial
  const allMovements = await engine.runInTransaction(
    [StoreName.INVENTORY_MOVEMENTS],
    'readonly',
    (tx) => tx.getAll<InventoryMovementRecord>(StoreName.INVENTORY_MOVEMENTS)
  );
  const cut1Movements = allMovements.filter((m) => m.partialCutId === cut1.id);
  const cut2Movements = allMovements.filter((m) => m.partialCutId === cut2.id);
  assert(
    cut1Movements.length === 0 && cut2Movements.length === 1,
    'Caso 20: Solo se generó el movimiento de ajuste físico de prodB en cut2; 0 movimientos por cálculo comercial'
  );
  console.log('✓ Caso 20 superado: No se generan movimientos de stock adicionales por el cálculo comercial');
  passed++;

  // Caso 21: No se registran cobros ni pagos
  const allSales = await saleRepo.findAll();
  for (const s of allSales) {
    assert(
      !('paymentMethod' in s) && !('amountPaid' in s) && !('changeDue' in s),
      'Caso 21: Ningún registro contiene campos de cobro ni pago'
    );
  }
  console.log('✓ Caso 21 superado: No se registran cobros, pagos ni caja');
  passed++;

  // Caso 22: Se respetan los permisos del Cajero (oculta costos de compra y balances sensibles en casos de uso)
  const cashierCut2Detail = await getCutDetail.execute(cashierActor, cut2.id);
  const cashierDossier = await getWorkdayDetail.execute(cashierActor, workday.id);
  const cashierDossierCut2 = cashierDossier.partialCuts.find((c) => c.id === cut2.id)!;
  const cashierListCuts = await listWorkdayCuts.execute(cashierActor, workday.id);
  const cashierListedCut2 = cashierListCuts.cuts.find((c) => c.id === cut2.id)!;

  assert(
    cashierCut2Detail.commercialActivity.totalCommercialValue === 375 &&
      cashierCut2Detail.summary.totalShortagePurchaseValue === 0 &&
      cashierCut2Detail.summary.netPurchaseBalance === 0 &&
      cashierCut2Detail.summary.netSaleBalance === 0 &&
      cashierCut2Detail.reviewItems.every((i) => i.lastPurchasePriceSnapshot === 0 && i.shortagePurchaseValue === 0) &&
      cashierDossierCut2.summary?.netPurchaseBalance === 0 &&
      cashierDossierCut2.summary?.netSaleBalance === 0 &&
      cashierListedCut2.summary?.netPurchaseBalance === 0 &&
      cashierListedCut2.summary?.netSaleBalance === 0,
    'Caso 22: Permisos de Cajero aplicados en proyecciones de casos de uso (sin costos de compra ni balances sensibles)'
  );
  console.log('✓ Caso 22 superado: Se respetan estrictamente los permisos del Cajero en casos de uso y vistas');
  passed++;

  // Casos 23 y 24: Se validarán a continuación con tsc --noEmit y vite build
  console.log(`\n=== RESUMEN PARCIAL DE PRUEBAS FUNCIONALES: ${passed}/22 CASOS DE DOMINIO Y APLICACIÓN SUPERADOS ===`);
}

runVerification().catch((err) => {
  console.error('FALLO EN VERIFICACIÓN:', err);
  process.exit(1);
});
