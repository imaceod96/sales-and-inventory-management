import {
  assertPermission,
  hasPermission,
} from '../../../shared/lib/permissions/rolePolicy';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { SaleBaseRecord } from '../domain/entities/SaleRecord';
import { SaleRepository } from '../domain/repositories/SaleRepository';
import {
  calculateCommercialPerformance,
  CommercialPerformanceResult,
} from '../../warehouse/domain/entities/WorkdayCommercialPerformance';

import { ProductRepository } from '../../warehouse/domain/repositories/ProductRepository';

export interface SalesDashboardSummary {
  readonly openSales: readonly SaleBaseRecord[];
  readonly recentSales: readonly SaleBaseRecord[];
  readonly canViewDailyIncome: boolean;
  readonly canViewCosts: boolean;
  readonly hasActiveWorkday: boolean;
  readonly activeWorkdayId: string | null;
  readonly completedSalesCount: number | null;
  readonly dispatchedAmount: number | null;
  readonly workdayPerformance: CommercialPerformanceResult | null;
}

export class GetSalesDashboardSummaryUseCase {
  private readonly saleRepository: SaleRepository;
  private readonly productRepository?: ProductRepository;

  constructor(saleRepository: SaleRepository, productRepository?: ProductRepository) {
    this.saleRepository = saleRepository;
    this.productRepository = productRepository;
  }

  public async execute(
    actor: SessionActor,
    activeWorkdayId?: string | null
  ): Promise<SalesDashboardSummary> {
    assertPermission(actor, Permission.VIEW_DASHBOARD, 'consultar panel de inicio');

    const [openSales, closedSales, products] = await Promise.all([
      this.saleRepository.findOpenSales(),
      this.saleRepository.findClosedSales(50),
      this.productRepository ? this.productRepository.findAll() : Promise.resolve([]),
    ]);

    const canViewDailyIncome = hasPermission(actor.role, Permission.VIEW_DAILY_INCOME);
    const canViewCosts = hasPermission(actor.role, Permission.VIEW_PRODUCT_COSTS);

    const hasActiveWorkday = Boolean(activeWorkdayId && activeWorkdayId.trim().length > 0);
    const targetWorkdayId = hasActiveWorkday && activeWorkdayId ? activeWorkdayId.trim() : null;

    let workdaySales: SaleBaseRecord[] = [];
    if (targetWorkdayId) {
      workdaySales = await this.saleRepository.findDispatchedSalesByWorkdayId(targetWorkdayId);
    }

    const completedSalesCount = hasActiveWorkday && canViewDailyIncome ? workdaySales.length : null;
    const workdayPerformance = hasActiveWorkday && canViewDailyIncome
      ? calculateCommercialPerformance(workdaySales, products)
      : null;

    const dispatchedAmount = workdayPerformance
      ? workdayPerformance.totalCommercialValue
      : null;

    return {
      openSales,
      recentSales: closedSales.slice(0, 8),
      canViewDailyIncome,
      canViewCosts,
      hasActiveWorkday,
      activeWorkdayId: targetWorkdayId,
      completedSalesCount,
      dispatchedAmount,
      workdayPerformance,
    };
  }
}
