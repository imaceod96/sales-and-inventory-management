import { assertPermission, hasPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { InventoryMovementType } from '../domain/entities/InventoryMovementRecord';
import { MerchandiseEntryRecord } from '../domain/entities/MerchandiseEntryRecord';
import {
  KardexMovementEntry,
  ProductHistoryEventType,
  ProductHistoryFilters,
  ProductHistoryQueryResult,
  ProductHistorySummary,
  UnifiedHistoryEvent,
} from '../domain/entities/ProductHistoryRecords';
import { calculateProductAvailability, ProductRecord, ProductStatus } from '../domain/entities/ProductRecord';
import { CategoryRepository } from '../domain/repositories/CategoryRepository';
import { InventoryMovementRepository } from '../domain/repositories/InventoryMovementRepository';
import { MeasurementUnitRepository } from '../domain/repositories/MeasurementUnitRepository';
import { MerchandiseEntryRepository } from '../domain/repositories/MerchandiseEntryRepository';
import { PriceChangeRepository } from '../domain/repositories/PriceChangeRepository';
import { ProductRepository } from '../domain/repositories/ProductRepository';
import { ProductStatusChangeRepository } from '../domain/repositories/ProductStatusChangeRepository';

export interface GetProductHistoryInput {
  readonly productId: string;
  readonly filters?: ProductHistoryFilters;
}

export class GetProductHistoryUseCase {
  private readonly productRepository: ProductRepository;
  private readonly categoryRepository: CategoryRepository;
  private readonly measurementUnitRepository: MeasurementUnitRepository;
  private readonly merchandiseEntryRepository: MerchandiseEntryRepository;
  private readonly inventoryMovementRepository: InventoryMovementRepository;
  private readonly priceChangeRepository: PriceChangeRepository;
  private readonly productStatusChangeRepository: ProductStatusChangeRepository;

  constructor(
    productRepository: ProductRepository,
    categoryRepository: CategoryRepository,
    measurementUnitRepository: MeasurementUnitRepository,
    merchandiseEntryRepository: MerchandiseEntryRepository,
    inventoryMovementRepository: InventoryMovementRepository,
    priceChangeRepository: PriceChangeRepository,
    productStatusChangeRepository: ProductStatusChangeRepository
  ) {
    this.productRepository = productRepository;
    this.categoryRepository = categoryRepository;
    this.measurementUnitRepository = measurementUnitRepository;
    this.merchandiseEntryRepository = merchandiseEntryRepository;
    this.inventoryMovementRepository = inventoryMovementRepository;
    this.priceChangeRepository = priceChangeRepository;
    this.productStatusChangeRepository = productStatusChangeRepository;
  }

  public async execute(
    actor: SessionActor,
    input: GetProductHistoryInput
  ): Promise<ProductHistoryQueryResult> {
    // 1. Autorización: debe tener permiso VIEW_PRODUCTS
    assertPermission(actor, Permission.VIEW_PRODUCTS, 'consultar historial de producto');

    const canViewCosts = hasPermission(actor.role, Permission.VIEW_PRODUCT_COSTS);

    // 2. Validación del identificador
    const productId = (input.productId || '').trim();
    if (!productId) {
      throw new ValidationError('El identificador de producto es obligatorio.');
    }

    // 3. Validación de filtros de fecha
    const filters = input.filters ?? {};
    if (filters.startDate && filters.endDate) {
      if (filters.startDate > filters.endDate) {
        throw new ValidationError('La fecha inicial no puede ser posterior a la fecha final.');
      }
    }

    // 4. Recuperar producto
    const product = await this.productRepository.findById(productId);
    if (!product) {
      throw new EntityNotFoundError('warehouse_products', productId);
    }

    // 5. Recuperar catálogos relacionados
    const [category, unit] = await Promise.all([
      this.categoryRepository.findById(product.categoryId),
      this.measurementUnitRepository.findById(product.measurementUnitId),
    ]);

    const categoryLabel = category?.name ?? 'Sin categoría';
    const unitLabel = unit?.name ?? 'Unidad';
    const unitSymbol = unit?.name ?? 'ud';

    // 6. Construir resumen de identidad del producto (respetando confidencialidad)
    const availability = calculateProductAvailability(product.status, product.currentStock);
    const marginPercentage =
      canViewCosts && product.lastPurchasePrice > 0
        ? Math.round(
            ((product.currentSalePrice - product.lastPurchasePrice) / product.lastPurchasePrice) *
              1000
          ) / 10
        : undefined;

    const summary: ProductHistorySummary = {
      productId: product.id,
      name: product.name,
      code: `PRD-${product.id.slice(0, 8).toUpperCase()}`,
      sku: product.sku,
      categoryId: product.categoryId,
      categoryLabel,
      measurementUnitId: product.measurementUnitId,
      unitLabel,
      unitSymbol,
      status: product.status,
      availability,
      currentStock: product.currentStock,
      currentSalePrice: product.currentSalePrice,
      lastPurchasePrice: canViewCosts ? product.lastPurchasePrice : undefined,
      marginPercentage,
      createdAt: product.createdAt,
    };

    // 7. Recuperar todos los registros históricos persistidos
    const [rawEntries, rawMovements, rawPriceChanges, rawStatusChanges] = await Promise.all([
      this.merchandiseEntryRepository.findByProductId(productId),
      this.inventoryMovementRepository.findByProductId(productId),
      this.priceChangeRepository.findByProductId(productId),
      this.productStatusChangeRepository.findByProductId(productId),
    ]);

    // Ordenar entradas cronológicamente ascendente para identificar la inicial
    const entriesAscending = [...rawEntries].sort((a, b) =>
      a.registeredAt.localeCompare(b.registeredAt)
    );
    const initialEntryId = entriesAscending[0]?.id;

    // Indexar movimientos por originOperationId para asociar stock previo/resultante
    const movementByOperationId = new Map(rawMovements.map((m) => [m.originOperationId, m]));

    // 8. Construir eventos unificados
    const unifiedEvents: UnifiedHistoryEvent[] = [];

    // A & B: Entradas de mercancía (registro inicial y nuevas entradas)
    for (const entry of rawEntries) {
      const isInitial = entry.id === initialEntryId;
      const associatedMove = movementByOperationId.get(entry.id);

      unifiedEvents.push({
        id: `entry-${entry.id}`,
        eventType: isInitial
          ? ProductHistoryEventType.INITIAL_REGISTRATION
          : ProductHistoryEventType.MERCHANDISE_ENTRY,
        title: isInitial ? 'Registro inicial con primera entrada' : 'Nueva entrada de mercancía',
        description: isInitial
          ? `Alta inicial del producto con recepción de ${entry.quantity} ${unitSymbol}.`
          : `Recepción de ${entry.quantity} ${unitSymbol} en almacén.`,
        timestamp: entry.registeredAt,
        declaredDate: entry.declaredEntryDate,
        responsibleUserId: entry.responsibleUserId || 'No registrado',
        quantity: entry.quantity,
        unitPurchasePrice: canViewCosts ? entry.unitPurchasePrice : undefined,
        totalCost: canViewCosts ? entry.totalEntryCost : undefined,
        declaredSalePrice: entry.declaredSalePrice,
        previousStock: associatedMove?.previousStock,
        resultingStock: associatedMove?.resultingStock,
      });
    }

    // C: Movimientos compensatorios de corrección de existencias
    for (const move of rawMovements) {
      if (
        move.movementType === InventoryMovementType.CORRECTION_POSITIVE ||
        move.movementType === InventoryMovementType.CORRECTION_NEGATIVE
      ) {
        const isPositive = move.movementType === InventoryMovementType.CORRECTION_POSITIVE;
        const diff = move.resultingStock - move.previousStock;
        const diffFormatted = diff > 0 ? `+${diff}` : `${diff}`;

        unifiedEvents.push({
          id: `correction-${move.id}`,
          eventType: ProductHistoryEventType.STOCK_CORRECTION,
          title: isPositive
            ? 'Corrección de inventario (Sobrante físico)'
            : 'Corrección de inventario (Faltante / Merma)',
          description: `Regularización manual de existencias: ${move.previousStock} → ${move.resultingStock} (${diffFormatted} ${unitSymbol}).`,
          timestamp: move.timestamp,
          responsibleUserId: move.responsibleUserId || 'No registrado',
          previousStock: move.previousStock,
          resultingStock: move.resultingStock,
          stockDifference: diff,
          quantity: move.quantity,
          correctionType: isPositive ? 'POSITIVE' : 'NEGATIVE',
          reason: move.reason || 'Corrección manual de existencias físicas',
        });
      } else if (move.movementType === InventoryMovementType.PARTIAL_CUT_ADJUSTMENT) {
        const diff = Math.round((move.resultingStock - move.previousStock) * 100) / 100;
        const isPositive = diff >= 0;
        const diffFormatted = diff > 0 ? `+${diff}` : `${diff}`;
        const cutFolioLabel = move.partialCutFolio ? ` (${move.partialCutFolio})` : '';
        const workdayFolioLabel = move.workdayFolio ? ` · Jornada ${move.workdayFolio}` : '';

        unifiedEvents.push({
          id: `partial-cut-${move.id}`,
          eventType: ProductHistoryEventType.PARTIAL_CUT_ADJUSTMENT,
          title: isPositive
            ? `Ajuste por corte parcial${cutFolioLabel} — Sobrante físico`
            : `Ajuste por corte parcial${cutFolioLabel} — Faltante físico`,
          description: `Ajuste aprobado en corte parcial${cutFolioLabel}${workdayFolioLabel}: ${move.previousStock} → ${move.resultingStock} (${diffFormatted} ${unitSymbol}).`,
          timestamp: move.timestamp,
          responsibleUserId: move.responsibleUserId || 'No registrado',
          previousStock: move.previousStock,
          resultingStock: move.resultingStock,
          stockDifference: diff,
          quantity: Math.abs(diff),
          correctionType: isPositive ? 'POSITIVE' : 'NEGATIVE',
          reason: move.reason || 'Ajuste aprobado por corte parcial de inventario',
          workdayId: move.workdayId ?? null,
          workdayFolio: move.workdayFolio ?? null,
          partialCutId: move.partialCutId ?? null,
          partialCutFolio: move.partialCutFolio ?? null,
        });
      } else if (move.movementType === InventoryMovementType.SALE) {
        unifiedEvents.push({
          id: `sale-${move.id}`,
          eventType: ProductHistoryEventType.SALE_DISPATCH,
          title: 'Salida por despacho de mercancía',
          description: `Despacho de ${move.quantity} ${unitSymbol}: ${move.previousStock} → ${move.resultingStock}.`,
          timestamp: move.timestamp,
          responsibleUserId: move.responsibleUserId || 'No registrado',
          previousStock: move.previousStock,
          resultingStock: move.resultingStock,
          stockDifference: -move.quantity,
          quantity: move.quantity,
          reason: move.reason || 'Despacho de venta',
          workdayId: move.workdayId ?? null,
        });
      }
    }

    // D: Modificaciones de precio de venta
    for (const priceChange of rawPriceChanges) {
      const isEntryOrigin =
        priceChange.reason?.toLowerCase().includes('entrada') ||
        movementByOperationId.has(priceChange.id);

      const priceDiff = Math.round((priceChange.newSalePrice - priceChange.previousSalePrice) * 100) / 100;
      const pct =
        priceChange.previousSalePrice > 0
          ? Math.round(
              ((priceChange.newSalePrice - priceChange.previousSalePrice) /
                priceChange.previousSalePrice) *
                1000
            ) / 10
          : undefined;

      unifiedEvents.push({
        id: `price-${priceChange.id}`,
        eventType: ProductHistoryEventType.PRICE_CHANGE,
        title: isEntryOrigin
          ? 'Actualización de precio por entrada'
          : 'Modificación del precio de venta',
        description: `Precio de venta modificado de $${priceChange.previousSalePrice.toFixed(2)} a $${priceChange.newSalePrice.toFixed(2)}.`,
        timestamp: priceChange.changedAt,
        responsibleUserId: priceChange.responsibleUserId || 'No registrado',
        previousSalePrice: priceChange.previousSalePrice,
        newSalePrice: priceChange.newSalePrice,
        priceDifference: priceDiff,
        priceChangePercentage: pct,
        priceChangeOrigin: isEntryOrigin ? 'ENTRY' : 'MANUAL',
        reason: priceChange.reason || null,
      });
    }

    // E: Activaciones y desactivaciones
    for (const statusChange of rawStatusChanges) {
      const isActivation = statusChange.newStatus === ProductStatus.ACTIVE;

      unifiedEvents.push({
        id: `status-${statusChange.id}`,
        eventType: ProductHistoryEventType.STATUS_CHANGE,
        title: isActivation ? 'Activación de producto' : 'Desactivación de producto',
        description: `Estado administrativo modificado a ${
          isActivation ? 'ACTIVO' : 'INACTIVO'
        }.`,
        timestamp: statusChange.changedAt,
        responsibleUserId: statusChange.responsibleUserId || 'No registrado',
        previousStatus: statusChange.previousStatus,
        newStatus: statusChange.newStatus,
        reason: statusChange.reason,
      });
    }

    // Ordenamiento cronológico determinista: más reciente primero, id secundario
    unifiedEvents.sort((a, b) => {
      const timeCmp = b.timestamp.localeCompare(a.timestamp);
      if (timeCmp !== 0) return timeCmp;
      return b.id.localeCompare(a.id);
    });

    // 9. Construir Kardex de movimientos
    const kardexMovements: KardexMovementEntry[] = rawMovements.map((m) => {
      let movementTypeLabel = 'Movimiento de inventario';
      let entryQuantity: number | null = null;
      let exitQuantity: number | null = null;

      if (m.movementType === InventoryMovementType.ENTRY) {
        movementTypeLabel = 'Entrada de mercancía';
        entryQuantity = m.quantity;
      } else if (m.movementType === InventoryMovementType.CORRECTION_POSITIVE) {
        movementTypeLabel = 'Corrección (+) Sobrante';
        entryQuantity = m.quantity;
      } else if (m.movementType === InventoryMovementType.CORRECTION_NEGATIVE) {
        movementTypeLabel = 'Corrección (-) Faltante';
        exitQuantity = m.quantity;
      } else if (m.movementType === InventoryMovementType.PARTIAL_CUT_ADJUSTMENT) {
        const diff = Math.round((m.resultingStock - m.previousStock) * 100) / 100;
        const absDiff = Math.abs(diff);
        if (diff >= 0) {
          movementTypeLabel = m.partialCutFolio
            ? `Ajuste corte parcial (+) Sobrante [${m.partialCutFolio}]`
            : 'Ajuste corte parcial (+) Sobrante';
          entryQuantity = absDiff;
        } else {
          movementTypeLabel = m.partialCutFolio
            ? `Ajuste corte parcial (-) Faltante [${m.partialCutFolio}]`
            : 'Ajuste corte parcial (-) Faltante';
          exitQuantity = absDiff;
        }
      } else if (m.movementType === InventoryMovementType.SALE) {
        movementTypeLabel = 'Salida por despacho de venta';
        exitQuantity = m.quantity;
      }

      return {
        id: m.id,
        timestamp: m.timestamp,
        movementType: m.movementType,
        movementTypeLabel,
        entryQuantity,
        exitQuantity,
        previousStock: m.previousStock,
        resultingStock: m.resultingStock,
        referenceOrReason:
          m.reason ||
          (m.movementType === InventoryMovementType.ENTRY
            ? 'Recepción de mercancía'
            : m.movementType === InventoryMovementType.SALE
              ? 'Despacho de venta'
              : m.movementType === InventoryMovementType.PARTIAL_CUT_ADJUSTMENT
                ? `Ajuste por corte parcial ${m.partialCutFolio || ''}`.trim()
                : 'Ajuste de inventario'),
        responsibleUserId: m.responsibleUserId || 'No registrado',
        workdayId: m.workdayId ?? null,
        workdayFolio: m.workdayFolio ?? null,
        partialCutId: m.partialCutId ?? null,
        partialCutFolio: m.partialCutFolio ?? null,
      };
    });

    kardexMovements.sort((a, b) => {
      const timeCmp = b.timestamp.localeCompare(a.timestamp);
      if (timeCmp !== 0) return timeCmp;
      return b.id.localeCompare(a.id);
    });

    // 10. Sanitizar entradas si no está autorizado para ver costos
    const sanitizedEntries = rawEntries.map((e) => {
      if (canViewCosts) return e;
      return {
        ...e,
        unitPurchasePrice: 0,
        totalEntryCost: 0,
      };
    });

    // 11. Aplicación de filtros sobre eventos y listas
    const matchesDate = (isoTimestamp: string): boolean => {
      const datePart = isoTimestamp.slice(0, 10);
      if (filters.startDate && datePart < filters.startDate) return false;
      if (filters.endDate && datePart > filters.endDate) return false;
      return true;
    };

    const matchesEventDate = (ev: UnifiedHistoryEvent): boolean => {
      const realMatches = matchesDate(ev.timestamp);
      const declaredMatches = ev.declaredDate ? matchesDate(ev.declaredDate) : false;
      return realMatches || declaredMatches;
    };

    const matchesEntryDate = (e: MerchandiseEntryRecord): boolean => {
      const realMatches = matchesDate(e.registeredAt);
      const declaredMatches = e.declaredEntryDate ? matchesDate(e.declaredEntryDate) : false;
      return realMatches || declaredMatches;
    };

    let filteredUnified = unifiedEvents.filter(matchesEventDate);

    if (filters.operationType && filters.operationType !== 'ALL') {
      switch (filters.operationType) {
        case 'ENTRIES':
          filteredUnified = filteredUnified.filter(
            (ev) =>
              ev.eventType === ProductHistoryEventType.INITIAL_REGISTRATION ||
              ev.eventType === ProductHistoryEventType.MERCHANDISE_ENTRY
          );
          break;
        case 'SALES':
          filteredUnified = filteredUnified.filter(
            (ev) => ev.eventType === ProductHistoryEventType.SALE_DISPATCH
          );
          break;
        case 'CORRECTIONS':
          filteredUnified = filteredUnified.filter(
            (ev) =>
              ev.eventType === ProductHistoryEventType.STOCK_CORRECTION ||
              ev.eventType === ProductHistoryEventType.PARTIAL_CUT_ADJUSTMENT
          );
          break;
        case 'PARTIAL_CUTS':
          filteredUnified = filteredUnified.filter(
            (ev) => ev.eventType === ProductHistoryEventType.PARTIAL_CUT_ADJUSTMENT
          );
          break;
        case 'PRICES':
          filteredUnified = filteredUnified.filter(
            (ev) => ev.eventType === ProductHistoryEventType.PRICE_CHANGE
          );
          break;
        case 'STATUSES':
          filteredUnified = filteredUnified.filter(
            (ev) => ev.eventType === ProductHistoryEventType.STATUS_CHANGE
          );
          break;
      }
    }

    let filteredKardex = kardexMovements.filter((m) => matchesDate(m.timestamp));
    if (filters.operationType && filters.operationType !== 'ALL') {
      switch (filters.operationType) {
        case 'ENTRIES':
          filteredKardex = filteredKardex.filter(
            (m) => m.movementType === InventoryMovementType.ENTRY
          );
          break;
        case 'SALES':
          filteredKardex = filteredKardex.filter(
            (m) => m.movementType === InventoryMovementType.SALE
          );
          break;
        case 'CORRECTIONS':
          filteredKardex = filteredKardex.filter(
            (m) =>
              m.movementType === InventoryMovementType.CORRECTION_POSITIVE ||
              m.movementType === InventoryMovementType.CORRECTION_NEGATIVE ||
              m.movementType === InventoryMovementType.PARTIAL_CUT_ADJUSTMENT
          );
          break;
        case 'PARTIAL_CUTS':
          filteredKardex = filteredKardex.filter(
            (m) => m.movementType === InventoryMovementType.PARTIAL_CUT_ADJUSTMENT
          );
          break;
      }
    }

    const filteredEntries = sanitizedEntries.filter(matchesEntryDate);
    const filteredPrices = rawPriceChanges.filter((p) => matchesDate(p.changedAt));
    const filteredStatuses = rawStatusChanges.filter((s) => matchesDate(s.changedAt));

    return {
      summary,
      unifiedEvents: filteredUnified,
      merchandiseEntries: filteredEntries,
      kardexMovements: filteredKardex,
      priceChanges: filteredPrices,
      statusChanges: filteredStatuses,
    };
  }
}
