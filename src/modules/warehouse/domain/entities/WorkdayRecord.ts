import { BaseEntity, ISODateString } from '../../../../shared/types/entity';

/**
 * Estados de ciclo de vida de una jornada de inventario.
 */
export enum WorkdayStatus {
  OPEN = 'OPEN',
  CLOSING = 'CLOSING',
  CLOSING_SUSPENDED = 'CLOSING_SUSPENDED',
  CLOSED = 'CLOSED',
}

/**
 * Etiquetas en lenguaje natural para la interfaz y trazabilidad.
 */
export const WORKDAY_STATUS_LABELS: Record<WorkdayStatus, string> = {
  [WorkdayStatus.OPEN]: 'Abierta',
  [WorkdayStatus.CLOSING]: 'En proceso de cierre',
  [WorkdayStatus.CLOSING_SUSPENDED]: 'Cierre suspendido',
  [WorkdayStatus.CLOSED]: 'Cerrada',
};

/**
 * Determina si una jornada se encuentra en estado operativo activo.
 * Solo puede existir UNA jornada operativa simultáneamente en todo el sistema.
 */
export function isOperativeWorkday(status: WorkdayStatus): boolean {
  return (
    status === WorkdayStatus.OPEN ||
    status === WorkdayStatus.CLOSING ||
    status === WorkdayStatus.CLOSING_SUSPENDED
  );
}

/**
 * Registro de jornada de inventario persistido en IndexedDB.
 * Constituye el expediente digital único de la jornada.
 */
export interface WorkdayRecord extends BaseEntity {
  readonly consecutiveNumber: number;
  readonly code: string;
  readonly openedAt: ISODateString;
  readonly openedByUserId: string;
  readonly openedByUserLabel: string;
  readonly status: WorkdayStatus;
  readonly closedAt?: ISODateString | null;
  readonly closedByUserId?: string | null;
  readonly closedByUserLabel?: string | null;
  readonly notes?: string;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
}

/**
 * Contrato base para entidades vinculables al expediente de una jornada.
 * Preparado para Ventas, Cortes parciales, Conteos físicos, Ajustes y Movimientos.
 */
export interface WorkdayAssociatedEntity {
  readonly workdayId?: string | null;
}

/**
 * Vista detallada del expediente histórico de una jornada.
 */
export interface WorkdayDossierDetail {
  readonly workday: WorkdayRecord;
  readonly salesCount: number;
  readonly partialCutsCount: number;
  readonly physicalCountsCount: number;
  readonly inventoryMovementsCount: number;
  readonly auditEntriesCount: number;
}

/**
 * Contrato de validación de jornada activa para el módulo de ventas.
 */
export interface ActiveWorkdayValidationResult {
  readonly hasActiveWorkday: boolean;
  readonly activeWorkday: WorkdayRecord | null;
  readonly canOperateSales: boolean;
  readonly message?: string;
}

/**
 * Evalúa si una jornada activa permite procesar operaciones de venta.
 * Comportamiento por estado:
 * - Sin jornada o CLOSED: NO permite ventas.
 * - OPEN: SÍ permite ventas.
 * - CLOSING: NO permite ventas (inventario final en curso).
 * - CLOSING_SUSPENDED: SÍ permite ventas (cierre suspendido temporalmente por el Administrador).
 */
export function validateActiveWorkdayForSales(
  workday: WorkdayRecord | null | undefined
): ActiveWorkdayValidationResult {
  if (!workday || workday.status === WorkdayStatus.CLOSED) {
    return {
      hasActiveWorkday: false,
      activeWorkday: null,
      canOperateSales: false,
      message:
        'No hay una jornada abierta. Solicita al Administrador que inicie la jornada para registrar ventas.',
    };
  }

  if (workday.status === WorkdayStatus.OPEN) {
    return {
      hasActiveWorkday: true,
      activeWorkday: workday,
      canOperateSales: true,
    };
  }

  if (workday.status === WorkdayStatus.CLOSING_SUSPENDED) {
    return {
      hasActiveWorkday: true,
      activeWorkday: workday,
      canOperateSales: true,
      message:
        'Jornada con cierre suspendido temporalmente. Se permite registrar ventas vinculadas a este expediente.',
    };
  }

  // Si está en CLOSING
  return {
    hasActiveWorkday: true,
    activeWorkday: workday,
    canOperateSales: false,
    message:
      'La jornada actual se encuentra en proceso de cierre. No se pueden procesar nuevas ventas mientras se realiza el inventario final.',
  };
}
