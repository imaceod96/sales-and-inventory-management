import { EntityId, ISODateString } from '../../../../shared/types/entity';
import {
  PartialCutCommercialActivitySummary,
  PartialCutCommercialProductBreakdownItem,
} from '../entities/InventoryCutRecord';

export type {
  PartialCutCommercialActivitySummary,
  PartialCutCommercialProductBreakdownItem,
};

/**
 * Producto afectado por operaciones comerciales reales (ventas confirmadas, devoluciones o anulaciones
 * con movimiento real de existencias) dentro de un intervalo temporal de una jornada específica.
 */
export interface AffectedCommercialProduct {
  readonly productId: EntityId;
  readonly operationIds: readonly string[];
  readonly lastOperationAt: ISODateString;
  readonly operationTimestamps?: readonly ISODateString[];
}

/**
 * Resultado del contrato de lectura de actividad comercial para un intervalo de corte parcial.
 */
export interface CommercialActivityIntervalQueryResult {
  readonly workdayId: EntityId;
  readonly intervalStartAt: ISODateString;
  readonly intervalEndAt: ISODateString;
  /**
   * Indica si el módulo operativo de confirmación de ventas está activo y proporciona
   * cobertura garantizada del intervalo.
   */
  readonly isSalesConfirmationModuleOperational: boolean;
  readonly affectedProducts: readonly AffectedCommercialProduct[];
  readonly dependencyNotice: string;
  readonly commercialActivity?: PartialCutCommercialActivitySummary;
}

/**
 * Puerto de dominio para consultar los productos que tuvieron actividad comercial real
 * (ventas confirmadas, devoluciones o anulaciones con efecto en existencias) durante el intervalo
 * de un corte parcial.
 *
 * REGLA ESTRICTA DE INTEGRIDAD:
 * - Nunca deduce ventas a partir de entradas de mercancía (ENTRY) ni correcciones manuales (CORRECTION_*).
 * - Nunca fabrica ventas ficticias ni asume ventas por disminución de stock.
 * - No permite añadir ni excluir productos manualmente.
 */
export interface CommercialActivityQueryPort {
  queryAffectedProductsInInterval(params: {
    readonly workdayId: EntityId;
    readonly intervalStartAt: ISODateString;
    readonly intervalEndAt: ISODateString;
    readonly isInitialWorkdayInterval?: boolean;
  }): Promise<CommercialActivityIntervalQueryResult>;
}

