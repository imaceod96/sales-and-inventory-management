import { ShieldAlert } from 'lucide-react';
import { Button } from './Button';
import { Card, CardBody } from './Card';

export interface AccessDeniedStateProps {
  readonly sectionName: string;
  readonly activeRoleLabel: string;
  readonly onReturnHome: () => void;
}

export function AccessDeniedState({
  sectionName,
  activeRoleLabel,
  onReturnHome,
}: AccessDeniedStateProps) {
  return (
    <Card>
      <CardBody className="py-12">
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-[#F8F9FA] text-[#123F55]">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <h2 className="text-base font-semibold text-[#123F55]">
            Acceso restringido a {sectionName}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
            El rol activo ({activeRoleLabel}) no dispone de permisos administrativos para acceder a esta sección.
          </p>
          <div className="mt-5">
            <Button variant="primary" size="md" onClick={onReturnHome}>
              Ir al inicio
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
