import React from 'react';
import { Menu, Plus } from 'lucide-react';
import { validateActiveWorkdayForSales } from '../../modules/warehouse/domain/entities/WorkdayRecord';
import { Button } from '../../shared/components/Button';
import { useAsyncQuery } from '../../shared/hooks/useAsyncQuery';
import { Permission } from '../../shared/types/permissions';
import { formatCurrentLocalDate } from '../../shared/utils/date';
import { useApplication } from '../providers/ApplicationProvider';
import { useSession } from '../providers/SessionProvider';
import { AppRouteKey } from '../router/routes';
import { useRouter } from '../router/RouterProvider';

export interface TopHeaderProps {
  readonly onOpenMobileMenu: () => void;
}

export function TopHeader({ onOpenMobileMenu }: TopHeaderProps) {
  const { route, navigate, openNewSaleModal } = useRouter();
  const { actor, can } = useSession();
  const { useCases, dataRevision } = useApplication();

  const { data: activeWorkday } = useAsyncQuery(
    () =>
      can(Permission.VIEW_INVENTORY_CUTS)
        ? useCases.warehouse.getActiveWorkday.execute(actor)
        : Promise.resolve(null),
    [useCases.warehouse.getActiveWorkday, actor, can, dataRevision]
  );

  const salesValidation = validateActiveWorkdayForSales(activeWorkday);

  const showNewSaleCta =
    can(Permission.CREATE_SALE) &&
    (route.key === AppRouteKey.HOME ||
      route.key === AppRouteKey.OPEN_SALES ||
      route.key === AppRouteKey.OPEN_SALE_DETAIL ||
      route.key === AppRouteKey.SALES_HISTORY);

  return (
    <header className="sticky top-0 z-20 flex h-14 sm:h-16 shrink-0 items-center justify-between gap-3 sm:gap-6 border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Abrir menú lateral"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-[#123F55] hover:bg-slate-50 lg:hidden cursor-pointer"
        >
          <Menu className="h-4 w-4" />
        </button>

        <nav
          aria-label="Ruta de navegación"
          className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2 overflow-x-auto text-xs sm:text-sm"
        >
          {route.breadcrumbs.map((crumb, index) => {
            const isLast = index === route.breadcrumbs.length - 1;
            return (
              <React.Fragment key={`${crumb.label}-${index}`}>
                {index > 0 && (
                  <span aria-hidden="true" className="shrink-0 text-slate-400">
                    /
                  </span>
                )}
                {crumb.path && !isLast ? (
                  <button
                    type="button"
                    onClick={() => navigate(crumb.path!)}
                    className="shrink-0 text-slate-500 hover:text-[#123F55] hover:underline whitespace-nowrap cursor-pointer"
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span
                    className={[
                      'truncate',
                      isLast ? 'font-semibold text-[#123F55]' : 'text-slate-500',
                    ].join(' ')}
                  >
                    {crumb.label}
                  </span>
                )}
              </React.Fragment>
            );
          })}

          <span aria-hidden="true" className="hidden md:inline shrink-0 text-slate-300">
            ·
          </span>
          <span className="hidden md:inline shrink-0 text-xs text-slate-500 whitespace-nowrap">
            {formatCurrentLocalDate()}
          </span>
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {showNewSaleCta && (
          <Button
            variant={salesValidation.canOperateSales ? 'accent' : 'secondary'}
            size="md"
            icon={<Plus className="h-4 w-4" />}
            disabled={!salesValidation.canOperateSales}
            title={!salesValidation.canOperateSales ? salesValidation.message : undefined}
            onClick={salesValidation.canOperateSales ? openNewSaleModal : undefined}
          >
            Nueva venta
          </Button>
        )}
      </div>
    </header>
  );
}

