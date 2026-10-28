import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  EyeOff,
  FileCheck2,
  FileSearch,
  History,
  Info,
  Lock,
  RefreshCw,
  Save,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { Button } from '../../../../shared/components/Button';
import { Card, CardHeader } from '../../../../shared/components/Card';
import { Modal } from '../../../../shared/components/Modal';
import { Permission } from '../../../../shared/types/permissions';
import { formatDateTime } from '../../../../shared/utils/date';
import { formatCurrency } from '../../../../shared/utils/money';
import { PartialCutDetailView } from '../../application/GetPartialCutDetailUseCase';
import {
  BlindCountProductItemView,
  isEditablePartialCut,
  PARTIAL_CUT_CAPTURE_STATUS_LABELS,
  PARTIAL_CUT_DIFFERENCE_TYPE_LABELS,
  PARTIAL_CUT_STATUS_LABELS,
  PartialCutCaptureStatus,
  PartialCutDifferenceType,
  PartialCutItemReconciliationResult,
  PartialCutStatus,
} from '../../domain/entities/InventoryCutRecord';
import { PartialCutCommercialAndBalanceSummary } from './PartialCutCommercialAndBalanceSummary';

export interface PartialCutWorkspaceProps {
  readonly cutId: string;
  readonly onClose: () => void;
}

type WorkspaceViewMode = 'BLIND_COUNT' | 'REVIEW';

export function PartialCutWorkspace({ cutId, onClose }: PartialCutWorkspaceProps) {
  const { actor, can } = useSession();
  const { useCases, dataRevision, notifyDataChanged } = useApplication();

  const canManageCuts = can(Permission.MANAGE_INVENTORY_CUTS);
  const canViewCosts = can(Permission.VIEW_PRODUCT_COSTS);

  const [detail, setDetail] = useState<PartialCutDetailView | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<WorkspaceViewMode>('BLIND_COUNT');

  // Estado local de inputs de cantidades físicas por productId
  const [draftInputs, setDraftInputs] = useState<Record<string, string>>({});
  // Estado local de motivos de diferencia por productId
  const [differenceReasons, setDifferenceReasons] = useState<Record<string, string>>({});
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [savingReasonProductId, setSavingReasonProductId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Modal de cancelación
  const [isCancelModalOpen, setIsCancelModalOpen] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Modal de confirmación de aprobación definitiva
  const [isApproveModalOpen, setIsApproveModalOpen] = useState<boolean>(false);
  const [approvalNotes, setApprovalNotes] = useState<string>('');
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  // Transición a revisión
  const [isTransitioningReview, setIsTransitioningReview] = useState<boolean>(false);

  const loadCutDetail = async (preserveMode = true) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await useCases.warehouse.getPartialCutDetail.execute(actor, cutId);
      setDetail(result);

      // Inicializar campos del formulario con cantidades y motivos ya guardados
      const nextInputs: Record<string, string> = {};
      for (const item of result.blindItems) {
        nextInputs[item.productId] =
          item.countedPhysicalQuantity !== null ? String(item.countedPhysicalQuantity) : '';
      }
      setDraftInputs(nextInputs);

      const nextReasons: Record<string, string> = {};
      for (const rev of result.reviewItems) {
        nextReasons[rev.productId] = rev.differenceReason ?? '';
      }
      setDifferenceReasons((prev) => {
        const merged: Record<string, string> = { ...nextReasons };
        for (const key of Object.keys(prev)) {
          if (prev[key]?.trim() && !merged[key]) {
            merged[key] = prev[key];
          }
        }
        return merged;
      });

      if (!preserveMode) {
        if (
          result.cut.status === PartialCutStatus.READY_FOR_REVIEW ||
          result.cut.status === PartialCutStatus.APPROVED
        ) {
          setViewMode('REVIEW');
        } else {
          setViewMode('BLIND_COUNT');
        }
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'No fue posible cargar el corte parcial.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCutDetail(false);
  }, [cutId, dataRevision]);

  const handleSaveProductCount = async (productId: string, isRecountFromReview = false) => {
    const rawValue = draftInputs[productId];
    setFeedbackMessage(null);

    if (rawValue === undefined || rawValue.trim() === '') {
      setFeedbackMessage({
        type: 'error',
        text: 'Debes ingresar una cantidad física válida (se permite 0, no se permiten vacíos ni negativos).',
      });
      return;
    }

    setSavingProductId(productId);
    try {
      await useCases.warehouse.recordPartialCutCount.execute(actor, {
        cutId,
        productId,
        countedQuantity: Number(rawValue),
        differenceReason: differenceReasons[productId],
        reason: isRecountFromReview
          ? 'Reconteo verificado desde etapa de revisión'
          : undefined,
      });

      notifyDataChanged();
      setFeedbackMessage({
        type: 'success',
        text: isRecountFromReview
          ? 'Reconteo físico guardado y diferencias recalculadas.'
          : 'Conteo físico guardado en el borrador.',
      });
    } catch (err) {
      setFeedbackMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error al guardar el conteo físico.',
      });
    } finally {
      setSavingProductId(null);
    }
  };

  const handleSaveDifferenceReason = async (productId: string) => {
    const reasonText = differenceReasons[productId] ?? '';
    setFeedbackMessage(null);
    setSavingReasonProductId(productId);
    try {
      await useCases.warehouse.recordPartialCutCount.execute(actor, {
        cutId,
        productId,
        differenceReason: reasonText,
      });
      notifyDataChanged();
      setFeedbackMessage({
        type: 'success',
        text: 'Motivo de diferencia guardado en el borrador.',
      });
    } catch (err) {
      setFeedbackMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error al guardar el motivo de diferencia.',
      });
    } finally {
      setSavingReasonProductId(null);
    }
  };

  const handleProceedToReview = async () => {
    setFeedbackMessage(null);
    setIsTransitioningReview(true);
    try {
      await useCases.warehouse.proceedToPartialCutReview.execute(actor, cutId);
      notifyDataChanged();
      setViewMode('REVIEW');
      setFeedbackMessage({
        type: 'success',
        text: 'Todos los productos han sido contados. Etapa de revisión, motivos y aprobación habilitada.',
      });
    } catch (err) {
      setFeedbackMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'No se pudo avanzar a la etapa de revisión.',
      });
    } finally {
      setIsTransitioningReview(false);
    }
  };

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    setCancelError(null);
    if (!cancelReason.trim()) {
      setCancelError('El motivo de cancelación es obligatorio para la auditoría.');
      return;
    }

    setIsCancelling(true);
    try {
      await useCases.warehouse.cancelPartialCut.execute(actor, {
        cutId,
        reason: cancelReason.trim(),
      });
      setIsCancelModalOpen(false);
      notifyDataChanged();
      setFeedbackMessage({
        type: 'success',
        text: 'Corte parcial cancelado y conservado en el historial sin afectar existencias.',
      });
    } catch (err) {
      setCancelError(
        err instanceof Error ? err.message : 'No fue posible cancelar el corte parcial.'
      );
    } finally {
      setIsCancelling(false);
    }
  };

  // Verificar si todos los productos con diferencia tienen motivo escrito en el estado local o persistido
  const missingReasonsList = useMemo(() => {
    if (!detail) return [];
    return detail.reviewItems.filter((item) => {
      if (!item.requiresDifferenceReason) return false;
      const localReason = (differenceReasons[item.productId] ?? item.differenceReason ?? '').trim();
      return localReason.length === 0;
    });
  }, [detail, differenceReasons]);

  const canOpenApproveModal = useMemo(() => {
    if (!detail || !canManageCuts) return false;
    return (
      detail.cut.status === PartialCutStatus.READY_FOR_REVIEW &&
      detail.totalProductsCount > 0 &&
      detail.pendingProductsCount === 0 &&
      detail.recountRequiredCount === 0 &&
      missingReasonsList.length === 0
    );
  }, [detail, canManageCuts, missingReasonsList]);

  const handleConfirmApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    setApproveError(null);
    setIsApproving(true);
    try {
      const result = await useCases.warehouse.approvePartialCut.execute(actor, {
        cutId,
        differenceReasons,
        notes: approvalNotes.trim() || undefined,
      });
      setIsApproveModalOpen(false);
      notifyDataChanged();
      setViewMode('REVIEW');
      setFeedbackMessage({
        type: 'success',
        text: `Corte parcial ${result.cut.reference} aprobado exitosamente. Se generaron ${result.createdMovements.length} ajuste(s) compensatorios en el Kardex.`,
      });
    } catch (err) {
      setApproveError(
        err instanceof Error
          ? err.message
          : 'No fue posible aprobar el corte parcial de inventario.'
      );
    } finally {
      setIsApproving(false);
    }
  };

  if (isLoading && !detail) {
    return (
      <Card>
        <div className="p-8 text-center text-xs text-slate-500">
          Cargando mesa de trabajo del corte parcial…
        </div>
      </Card>
    );
  }

  if (loadError || !detail) {
    return (
      <Card>
        <div className="p-6 space-y-4">
          <div className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            {loadError || 'Corte parcial no encontrado.'}
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Volver a Inventarios / Corte
          </Button>
        </div>
      </Card>
    );
  }

  const {
    cut,
    blindItems,
    reviewItems,
    summary,
    commercialActivity,
    totalProductsCount,
    countedProductsCount,
    pendingProductsCount,
    recountRequiredCount,
    canTransitionToReview,
  } = detail;

  const isEditable = canManageCuts && isEditablePartialCut(cut.status);
  const isApproved = cut.status === PartialCutStatus.APPROVED;

  const renderCaptureBadge = (status: PartialCutCaptureStatus) => {
    switch (status) {
      case 'COUNTED':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="h-3 w-3" />
            {PARTIAL_CUT_CAPTURE_STATUS_LABELS[status]}
          </span>
        );
      case 'RECOUNT_REQUIRED':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 border border-red-200">
            <AlertTriangle className="h-3 w-3" />
            {PARTIAL_CUT_CAPTURE_STATUS_LABELS[status]}
          </span>
        );
      case 'PENDING':
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
            <Clock className="h-3 w-3" />
            {PARTIAL_CUT_CAPTURE_STATUS_LABELS[status]}
          </span>
        );
    }
  };

  const renderDifferenceTypeBadge = (diffType: PartialCutDifferenceType | null) => {
    if (!diffType) {
      return <span className="text-xs text-slate-400">Pendiente</span>;
    }
    switch (diffType) {
      case 'NONE':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200">
            {PARTIAL_CUT_DIFFERENCE_TYPE_LABELS.NONE}
          </span>
        );
      case 'SHORTAGE':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-red-700 border border-red-200">
            <TrendingDown className="h-3 w-3" />
            {PARTIAL_CUT_DIFFERENCE_TYPE_LABELS.SHORTAGE}
          </span>
        );
      case 'SURPLUS':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-blue-700 border border-blue-200">
            <TrendingUp className="h-3 w-3" />
            {PARTIAL_CUT_DIFFERENCE_TYPE_LABELS.SURPLUS}
          </span>
        );
    }
  };

  return (
    <div className="space-y-5">
      {/* Barra superior de navegación y estado del corte */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowLeft className="h-3.5 w-3.5" />}
              onClick={onClose}
            >
              Volver a cortes de la jornada
            </Button>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-bold text-[#123F55]">
                  Corte Parcial #{cut.consecutiveNumber}
                </h2>
                <span className="font-mono text-xs font-semibold bg-slate-100 text-slate-800 px-2 py-0.5 rounded border border-slate-200">
                  {cut.reference}
                </span>
                <span
                  className={[
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border',
                    cut.status === PartialCutStatus.CANCELLED
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : cut.status === PartialCutStatus.APPROVED
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : cut.status === PartialCutStatus.READY_FOR_REVIEW
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200',
                  ].join(' ')}
                >
                  {PARTIAL_CUT_STATUS_LABELS[cut.status]}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Jornada vinculada: <strong>{cut.workdayCode}</strong> · Intervalo auditado:{' '}
                <strong>{formatDateTime(cut.intervalStartAt)}</strong> a{' '}
                <strong>{formatDateTime(cut.intervalEndAt)}</strong>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Selector de modo entre Conteo Ciego y Revisión */}
            {!isApproved && (
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('BLIND_COUNT')}
                  className={[
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
                    viewMode === 'BLIND_COUNT'
                      ? 'bg-white text-[#123F55] shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900',
                  ].join(' ')}
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  <span>1. Conteo ciego</span>
                </button>
                <button
                  type="button"
                  disabled={!canTransitionToReview && cut.status === PartialCutStatus.DRAFT}
                  onClick={() => {
                    if (cut.status === PartialCutStatus.DRAFT && canTransitionToReview) {
                      handleProceedToReview();
                    } else {
                      setViewMode('REVIEW');
                    }
                  }}
                  className={[
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                    viewMode === 'REVIEW'
                      ? 'bg-white text-[#123F55] shadow-2xs cursor-pointer'
                      : canTransitionToReview || cut.status !== PartialCutStatus.DRAFT
                        ? 'text-slate-600 hover:text-slate-900 cursor-pointer'
                        : 'text-slate-400 cursor-not-allowed',
                  ].join(' ')}
                  title={
                    !canTransitionToReview
                      ? 'Completa el conteo físico de todos los productos para habilitar la revisión'
                      : 'Revisar existencias teóricas, movimientos posteriores, motivos y aprobar'
                  }
                >
                  <FileSearch className="h-3.5 w-3.5" />
                  <span>2. Revisión, motivos y aprobación</span>
                </button>
              </div>
            )}

            {isEditable && (
              <Button
                variant="danger"
                size="sm"
                icon={<XCircle className="h-3.5 w-3.5" />}
                onClick={() => {
                  setCancelReason('');
                  setCancelError(null);
                  setIsCancelModalOpen(true);
                }}
              >
                Cancelar corte
              </Button>
            )}
          </div>
        </div>

        {/* Resumen de avance de captura */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-100 text-xs">
          <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-200/80">
            <span className="text-slate-500 block text-[11px]">Productos auditados</span>
            <strong className="text-sm font-bold text-slate-900 tabular-nums">
              {totalProductsCount}
            </strong>
          </div>
          <div className="rounded-lg bg-emerald-50/60 p-2.5 border border-emerald-200/80">
            <span className="text-emerald-700 block text-[11px]">Productos contados</span>
            <strong className="text-sm font-bold text-emerald-800 tabular-nums">
              {countedProductsCount} / {totalProductsCount}
            </strong>
          </div>
          <div className="rounded-lg bg-amber-50/60 p-2.5 border border-amber-200/80">
            <span className="text-amber-800 block text-[11px]">Pendientes de conteo</span>
            <strong className="text-sm font-bold text-amber-900 tabular-nums">
              {pendingProductsCount}
            </strong>
          </div>
          <div
            className={[
              'rounded-lg p-2.5 border',
              recountRequiredCount > 0
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-slate-50 border-slate-200/80 text-slate-700',
            ].join(' ')}
          >
            <span className="block text-[11px]">Reconteo requerido</span>
            <strong className="text-sm font-bold tabular-nums">{recountRequiredCount}</strong>
          </div>
        </div>

        {cut.status === PartialCutStatus.APPROVED && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs text-emerald-950">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold block text-sm text-emerald-900">
                  Corte Parcial Aprobado e Inmutable ({cut.reference})
                </strong>
                <p className="mt-0.5 text-[11px] text-emerald-800">
                  Aprobado el <strong>{formatDateTime(cut.approvedAt || cut.updatedAt)}</strong> por{' '}
                  <strong>{cut.approvedByUserLabel || cut.responsibleUserLabel}</strong>. Los ajustes de
                  existencias fueron aplicados al inventario y registrados en el Kardex.
                </p>
              </div>
            </div>
            <div className="text-right font-mono text-[11px] text-emerald-800">
              <div>Movimientos Kardex: {cut.generatedMovementIds?.length ?? 0}</div>
              <div>Jornada: {cut.workdayCode}</div>
            </div>
          </div>
        )}

        {cut.status === PartialCutStatus.CANCELLED && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
            <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-semibold block">
                Corte parcial cancelado el {formatDateTime(cut.cancelledAt || cut.updatedAt)}
              </strong>
              <p className="mt-0.5 text-[11px]">
                Motivo registrado: <em>{cut.cancellationReason || 'Sin motivo'}</em>. Este corte
                se conserva para auditoría, no modificó existencias y su intervalo no se considera
                cubierto.
              </p>
            </div>
          </div>
        )}

        {feedbackMessage && (
          <div
            className={[
              'rounded-lg border p-3 text-xs font-medium flex items-center justify-between',
              feedbackMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800',
            ].join(' ')}
          >
            <span>{feedbackMessage.text}</span>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="text-xs underline ml-4 cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        )}
      </div>

      {/* MODO 1: CAPTURA DE CONTEO CIEGO (EXCLUSIVO PARA CORTES NO APROBADOS) */}
      {viewMode === 'BLIND_COUNT' && !isApproved && (
        <Card>
          <CardHeader
            title="Etapa 1 — Captura de Conteo Físico Ciego"
            description="Introduce la cantidad física real encontrada en almacén. Por disciplina de control interno, las existencias teóricas, diferencias, costos y precios permanecen estrictamente ocultos durante el conteo."
            action={
              isEditable && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<ClipboardCheck className="h-4 w-4" />}
                  disabled={!canTransitionToReview || isTransitioningReview}
                  onClick={handleProceedToReview}
                >
                  {isTransitioningReview ? 'Procesando…' : 'Pasar a revisión del corte'}
                </Button>
              )
            }
          />

          {blindItems.length === 0 ? (
            <div className="p-6 space-y-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-center text-xs text-slate-600 space-y-2">
                <p className="font-semibold text-slate-800">
                  No se detectaron productos con actividad comercial en este intervalo.
                </p>
                <p className="max-w-lg mx-auto">
                  El sistema selecciona automáticamente todos los productos que tuvieron ventas
                  confirmadas o devoluciones con movimiento de existencias durante el intervalo,
                  sin permitir añadir ni eliminar productos manualmente. Puedes cancelar este
                  borrador hasta que se registren operaciones comerciales en la jornada.
                </p>
              </div>
              <PartialCutCommercialAndBalanceSummary
                commercialActivity={commercialActivity}
                summary={summary}
                countedProductsCount={countedProductsCount}
                canViewCosts={canViewCosts}
                canViewInventoryBalances={canManageCuts}
              />
            </div>
          ) : (
            <div className="max-h-[60dvh] overflow-x-auto overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-3 px-4 bg-slate-50">Producto</th>
                    <th className="py-3 px-4 bg-slate-50">Código / SKU</th>
                    <th className="py-3 px-4 bg-slate-50">Categoría</th>
                    <th className="py-3 px-4 bg-slate-50">Unidad</th>
                    <th className="py-3 px-4 bg-slate-50">Estado de captura</th>
                    <th className="py-3 px-4 bg-slate-50">Cantidad física encontrada</th>
                    <th className="py-3 px-4 text-right bg-slate-50">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {blindItems.map((item: BlindCountProductItemView) => {
                    const currentInputValue = draftInputs[item.productId] ?? '';
                    const isSaving = savingProductId === item.productId;

                    return (
                      <tr key={item.productId} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          {item.productName}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600">
                          <div>{item.productCode}</div>
                          {item.sku && (
                            <div className="text-[11px] text-slate-400">SKU: {item.sku}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-700">{item.categoryName}</td>
                        <td className="py-3 px-4 text-slate-700">
                          {item.unitName} ({item.unitSymbol})
                        </td>
                        <td className="py-3 px-4">
                          <div className="space-y-1">
                            {renderCaptureBadge(item.captureStatus)}
                            {item.countedAt && (
                              <div className="text-[10px] text-slate-500">
                                Capturado: {formatDateTime(item.countedAt)}
                                {item.attemptCount > 1 && ` (Intento #${item.attemptCount})`}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {isEditable ? (
                            <div className="flex items-center gap-2 max-w-[180px]">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                aria-label={`Cantidad física de ${item.productName}`}
                                placeholder="Ej. 0 o 12.5"
                                value={currentInputValue}
                                onChange={(e) =>
                                  setDraftInputs((prev) => ({
                                    ...prev,
                                    [item.productId]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleSaveProductCount(item.productId, false);
                                  }
                                }}
                                className="h-8 w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs font-mono text-slate-900 focus:border-[#1A5F7A] focus:outline-none"
                              />
                              <span className="text-slate-500 font-mono text-[11px]">
                                {item.unitSymbol}
                              </span>
                            </div>
                          ) : (
                            <span className="font-mono font-semibold text-slate-800">
                              {item.countedPhysicalQuantity !== null
                                ? `${item.countedPhysicalQuantity} ${item.unitSymbol}`
                                : 'Sin contar'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {isEditable && (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={<Save className="h-3.5 w-3.5" />}
                              disabled={isSaving}
                              onClick={() => handleSaveProductCount(item.productId, false)}
                            >
                              {isSaving
                                ? 'Guardando…'
                                : item.countedPhysicalQuantity !== null
                                  ? 'Actualizar'
                                  : 'Guardar'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* MODO 2: REVISIÓN DE DIFERENCIAS, VALORACIÓN ECONÓMICA Y RESUMEN APROBADO */}
      {(viewMode === 'REVIEW' || isApproved) && (
        <div className="space-y-5">
          {/* APARTADOS INDEPENDIENTES: ACTIVIDAD COMERCIAL DEL PERÍODO Y BALANCE ECONÓMICO DEL INVENTARIO */}
          <PartialCutCommercialAndBalanceSummary
            commercialActivity={commercialActivity}
            summary={summary}
            countedProductsCount={countedProductsCount}
            canViewCosts={canViewCosts}
            canViewInventoryBalances={canManageCuts}
          />

          {/* TABLA DE REVISIÓN, CONCILIACIÓN Y MOTIVOS POR PRODUCTO */}
          <Card>
            <CardHeader
              title={
                isApproved
                  ? `Detalle Inmutable de Productos Auditados (${cut.reference})`
                  : 'Etapa 2 — Revisión de Diferencias, Conciliación y Motivos Obligatorios'
              }
              description={
                isApproved
                  ? 'Snapshot congelado al momento de aprobación del corte parcial con trazabilidad de existencias y movimientos Kardex.'
                  : 'Revisa las diferencias físicas calculadas respecto a la existencia teórica conciliada. Todo producto con faltante o sobrante requiere un motivo obligatorio antes de aprobar.'
              }
              action={
                isEditable && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<EyeOff className="h-3.5 w-3.5" />}
                    onClick={() => setViewMode('BLIND_COUNT')}
                  >
                    Volver a conteo ciego
                  </Button>
                )
              }
            />

            <div className="max-h-[60dvh] overflow-x-auto overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-3 px-3 bg-slate-50">Producto</th>
                    <th className="py-3 px-3 text-right bg-slate-50">Stock Teórico (Ref. / Conciliado)</th>
                    <th className="py-3 px-3 text-right bg-slate-50">Conteo Físico</th>
                    <th className="py-3 px-3 text-right bg-slate-50">Diferencia</th>
                    <th className="py-3 px-3 bg-slate-50">Clasificación</th>
                    <th className="py-3 px-3 text-right bg-slate-50">Valoración (Compra / Venta)</th>
                    <th className="py-3 px-3 bg-slate-50">Motivo de diferencia / Conciliación</th>
                    {isEditable && <th className="py-3 px-3 text-right bg-slate-50">Reconteo</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {reviewItems.map((item: PartialCutItemReconciliationResult) => {
                    const diff = item.differenceQuantity;
                    const currentReason =
                      differenceReasons[item.productId] ?? item.differenceReason ?? '';
                    const isReasonMissing =
                      item.requiresDifferenceReason && currentReason.trim().length === 0;

                    return (
                      <tr
                        key={item.productId}
                        className={
                          item.requiresRecount
                            ? 'bg-red-50/40'
                            : isReasonMissing && isEditable
                              ? 'bg-amber-50/30'
                              : 'hover:bg-slate-50/80'
                        }
                      >
                        <td className="py-3 px-3 align-top">
                          <div className="font-semibold text-slate-900">{item.productName}</div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {item.productCode} · {item.categoryName} ({item.unitSymbol})
                          </div>
                          {item.countedAt && (
                            <div className="text-[10px] text-slate-400">
                              Contado: {formatDateTime(item.countedAt)}
                            </div>
                          )}
                          {item.countHistory.length > 1 && (
                            <div className="mt-0.5 text-[10px] text-blue-700 flex items-center gap-1">
                              <History className="h-3 w-3" />
                              <span>
                                {item.countHistory.length} capturas (previa:{' '}
                                {
                                  item.countHistory[item.countHistory.length - 2]
                                    .countedQuantity
                                }{' '}
                                {item.unitSymbol})
                              </span>
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 text-right font-mono text-slate-700 tabular-nums align-top">
                          <div>
                            <span className="text-[10px] text-slate-400 mr-1">Ref:</span>
                            {item.theoreticalStockAtCutReference.toFixed(2)} {item.unitSymbol}
                          </div>
                          <div className="font-semibold text-slate-900">
                            <span className="text-[10px] text-slate-500 mr-1">Conciliado:</span>
                            {item.reconciledTheoreticalStock.toFixed(2)} {item.unitSymbol}
                          </div>
                          {(item.preCountDelta !== 0 || item.netPostCountDelta !== 0) && (
                            <div className="text-[10px] text-blue-700 mt-0.5">
                              {item.preCountDelta !== 0 && (
                                <span>
                                  Pre-conteo:{' '}
                                  {item.preCountDelta > 0
                                    ? `+${item.preCountDelta.toFixed(2)}`
                                    : item.preCountDelta.toFixed(2)}{' '}
                                </span>
                              )}
                              {item.netPostCountDelta !== 0 && (
                                <span>
                                  Post-conteo:{' '}
                                  {item.netPostCountDelta > 0
                                    ? `+${item.netPostCountDelta.toFixed(2)}`
                                    : item.netPostCountDelta.toFixed(2)}
                                </span>
                              )}
                            </div>
                          )}
                          {isApproved &&
                            item.stockBeforeApproval !== undefined &&
                            item.stockAfterApproval !== undefined && (
                              <div className="text-[10px] text-emerald-800 mt-1 border-t border-slate-100 pt-1">
                                Stock aplicado: {item.stockBeforeApproval?.toFixed(2)} →{' '}
                                <strong>{item.stockAfterApproval?.toFixed(2)}</strong>
                              </div>
                            )}
                        </td>

                        <td className="py-3 px-3 text-right font-mono font-bold text-slate-900 tabular-nums align-top">
                          {item.countedPhysicalQuantity !== null
                            ? `${item.countedPhysicalQuantity.toFixed(2)} ${item.unitSymbol}`
                            : '—'}
                        </td>

                        <td className="py-3 px-3 text-right font-mono font-bold tabular-nums align-top">
                          {diff === null ? (
                            <span className="text-slate-400">Pendiente</span>
                          ) : Math.abs(diff) < 0.001 ? (
                            <span className="text-emerald-700">0.00 {item.unitSymbol}</span>
                          ) : diff > 0 ? (
                            <span className="text-blue-700">
                              +{diff.toFixed(2)} {item.unitSymbol}
                            </span>
                          ) : (
                            <span className="text-red-700">
                              {diff.toFixed(2)} {item.unitSymbol}
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-3 align-top">
                          <div className="space-y-1">
                            {item.requiresRecount ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800 border border-red-300">
                                <AlertTriangle className="h-3 w-3" />
                                Reconteo requerido
                              </span>
                            ) : (
                              renderDifferenceTypeBadge(item.differenceType)
                            )}
                            {item.reconciliationStatus === 'RECONCILED_POST_MOVEMENTS' && (
                              <div className="text-[10px] text-blue-700 flex items-center gap-1">
                                <RefreshCw className="h-3 w-3 shrink-0" />
                                <span>Movimientos conciliados</span>
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums align-top">
                          <div className="text-[10px] text-slate-500">
                            {canViewCosts && (
                              <span>
                                C: {formatCurrency(item.lastPurchasePriceSnapshot)} ·{' '}
                              </span>
                            )}
                            <span>V: {formatCurrency(item.salePriceSnapshot)}</span>
                          </div>
                          {item.differenceType === 'SHORTAGE' ? (
                            <div className="text-red-700 font-semibold mt-0.5">
                              {canViewCosts && (
                                <div>Compra: -{formatCurrency(item.shortagePurchaseValue)}</div>
                              )}
                              <div>Venta: -{formatCurrency(item.shortageSaleValue)}</div>
                            </div>
                          ) : item.differenceType === 'SURPLUS' ? (
                            <div className="text-blue-700 font-semibold mt-0.5">
                              {canViewCosts && (
                                <div>Compra: +{formatCurrency(item.surplusPurchaseValue)}</div>
                              )}
                              <div>Venta: +{formatCurrency(item.surplusSaleValue)}</div>
                            </div>
                          ) : (
                            <div className="text-slate-400 mt-0.5">$0.00</div>
                          )}
                        </td>

                        <td className="py-3 px-3 align-top min-w-[230px]">
                          {item.requiresRecount && item.conflictReason ? (
                            <p className="text-[11px] text-red-700 font-medium leading-snug">
                              {item.conflictReason}
                            </p>
                          ) : item.requiresDifferenceReason ? (
                            isEditable ? (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    aria-label={`Motivo de diferencia para ${item.productName}`}
                                    placeholder="Motivo obligatorio (ej. merma, error de despacho)…"
                                    value={currentReason}
                                    onChange={(e) =>
                                      setDifferenceReasons((prev) => ({
                                        ...prev,
                                        [item.productId]: e.target.value,
                                      }))
                                    }
                                    className={[
                                      'h-7 w-full rounded border px-2 text-xs text-slate-900 focus:outline-none',
                                      isReasonMissing
                                        ? 'border-amber-400 bg-amber-50/50 focus:border-amber-600'
                                        : 'border-slate-300 bg-white focus:border-[#1A5F7A]',
                                    ].join(' ')}
                                  />
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={savingReasonProductId === item.productId}
                                    onClick={() => handleSaveDifferenceReason(item.productId)}
                                    title="Guardar motivo en borrador"
                                  >
                                    {savingReasonProductId === item.productId ? '…' : 'Guardar'}
                                  </Button>
                                </div>
                                {isReasonMissing && (
                                  <span className="text-[10px] font-semibold text-amber-800 block">
                                    * Motivo obligatorio para aprobar este ajuste
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="text-xs text-slate-800">
                                <span className="font-semibold text-slate-600">Motivo: </span>
                                <em>{item.differenceReason || 'No especificado'}</em>
                                {item.appliedAdjustmentMovementId && (
                                  <div className="text-[10px] font-mono text-emerald-700 mt-0.5">
                                    Mov. Kardex: #{item.appliedAdjustmentMovementId.slice(0, 8)}
                                  </div>
                                )}
                              </div>
                            )
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">
                              Sin diferencia (No requiere motivo ni ajuste)
                            </span>
                          )}
                        </td>

                        {isEditable && (
                          <td className="py-3 px-3 text-right align-top">
                            <div className="flex items-center justify-end gap-1.5">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                aria-label={`Reconteo físico de ${item.productName}`}
                                value={draftInputs[item.productId] ?? ''}
                                onChange={(e) =>
                                  setDraftInputs((prev) => ({
                                    ...prev,
                                    [item.productId]: e.target.value,
                                  }))
                                }
                                className="h-7 w-20 rounded border border-slate-300 bg-white px-2 text-xs font-mono text-slate-900"
                              />
                              <Button
                                variant={item.requiresRecount ? 'primary' : 'secondary'}
                                size="sm"
                                disabled={savingProductId === item.productId}
                                onClick={() => handleSaveProductCount(item.productId, true)}
                              >
                                Recontar
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* PANEL DE APROBACIÓN DEFINITIVA (PARA CORTES EN REVISIÓN / BORRADOR) */}
          {!isApproved && cut.status !== PartialCutStatus.CANCELLED && canManageCuts && (
            <div
              className={[
                'rounded-xl border p-5 flex flex-col md:flex-row md:items-center justify-between gap-4',
                canOpenApproveModal
                  ? 'border-emerald-300 bg-emerald-50/70'
                  : 'border-amber-200 bg-amber-50/70',
              ].join(' ')}
            >
              <div className="flex items-start gap-3">
                <div
                  className={[
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                    canOpenApproveModal
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      : 'bg-amber-100 text-amber-800 border-amber-300',
                  ].join(' ')}
                >
                  {canOpenApproveModal ? (
                    <FileCheck2 className="h-4 w-4" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                </div>
                <div className="space-y-1 text-xs">
                  <h4
                    className={[
                      'font-bold',
                      canOpenApproveModal ? 'text-emerald-950' : 'text-amber-950',
                    ].join(' ')}
                  >
                    {canOpenApproveModal
                      ? 'Corte parcial listo para aprobación definitiva y ajuste de stock'
                      : 'Requisitos pendientes antes de aprobar el corte parcial'}
                  </h4>
                  <p
                    className={[
                      'leading-relaxed max-w-3xl',
                      canOpenApproveModal ? 'text-emerald-900' : 'text-amber-900',
                    ].join(' ')}
                  >
                    {cut.status === PartialCutStatus.DRAFT
                      ? 'Haz clic en «Pasar a revisión del corte» para habilitar la aprobación definitiva.'
                      : recountRequiredCount > 0
                        ? `Existen ${recountRequiredCount} producto(s) con «Reconteo requerido». Debes volver a contarlos antes de aprobar.`
                        : missingReasonsList.length > 0
                          ? `Falta registrar el motivo obligatorio en ${missingReasonsList.length} producto(s) con diferencia (${missingReasonsList.map((m) => m.productName).join(', ')}).`
                          : `Al aprobar este corte parcial se aplicarán automáticamente los ajustes de faltantes (${summary.productsWithShortage}) y sobrantes (${summary.productsWithSurplus}) al stock actual y se registrarán movimientos compensatorios en el Kardex.`}
                  </p>
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-2">
                {cut.status === PartialCutStatus.DRAFT && canTransitionToReview && (
                  <Button
                    variant="primary"
                    size="md"
                    disabled={isTransitioningReview}
                    icon={<ClipboardCheck className="h-4 w-4" />}
                    onClick={handleProceedToReview}
                  >
                    Pasar a revisión del corte
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="md"
                  disabled={!canOpenApproveModal}
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  onClick={() => {
                    setApprovalNotes(cut.notes ?? '');
                    setApproveError(null);
                    setIsApproveModalOpen(true);
                  }}
                >
                  Aprobar corte parcial y aplicar ajustes
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal de confirmación explícita para aprobar corte parcial */}
      <Modal
        isOpen={isApproveModalOpen}
        onClose={() => {
          if (!isApproving) setIsApproveModalOpen(false);
        }}
        title={`Confirmar aprobación definitiva — ${cut.reference}`}
        description="Esta operación es transaccional e inmutable. Se actualizarán las existencias reales de los productos con diferencia y se registrarán movimientos compensatorios en el Kardex."
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isApproving}
              onClick={() => setIsApproveModalOpen(false)}
            >
              Revisar de nuevo
            </Button>
            <Button
              type="submit"
              form="approve-partial-cut-form"
              variant="primary"
              size="sm"
              disabled={isApproving}
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            >
              {isApproving ? 'Aplicando ajustes…' : 'Confirmar y aprobar corte parcial'}
            </Button>
          </>
        }
      >
        <form id="approve-partial-cut-form" onSubmit={handleConfirmApprove} className="space-y-4 text-xs">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500">Corte parcial / Jornada:</span>
              <strong className="font-mono text-slate-900">
                {cut.reference} · {cut.workdayCode}
              </strong>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5">
              <span className="text-slate-500">Despachos del período (Actividad comercial):</span>
              <strong className="font-mono text-[#123F55]">
                {commercialActivity.totalDispatchesCount} despacho(s) ·{' '}
                {formatCurrency(commercialActivity.totalCommercialValue)}
              </strong>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5">
              <span className="text-slate-500">Productos auditados (Inventario):</span>
              <strong className="text-slate-900">
                {summary.totalProductsAudited} ({summary.productsWithoutDifference} sin diferencia,{' '}
                {summary.productsWithShortage} faltantes, {summary.productsWithSurplus} sobrantes)
              </strong>
            </div>
            {canViewCosts && (
              <div className="flex justify-between border-t border-slate-200 pt-1.5">
                <span className="text-slate-500">Balance económico de inventario (Compra):</span>
                <strong
                  className={[
                    'font-mono',
                    summary.netPurchaseBalance < 0
                      ? 'text-red-700'
                      : summary.netPurchaseBalance > 0
                        ? 'text-blue-700'
                        : 'text-emerald-700',
                  ].join(' ')}
                >
                  {summary.netPurchaseBalance > 0 ? '+' : ''}
                  {formatCurrency(summary.netPurchaseBalance)}
                </strong>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-500">Balance económico de inventario (Venta):</span>
              <strong
                className={[
                  'font-mono',
                  summary.netSaleBalance < 0
                    ? 'text-red-700'
                    : summary.netSaleBalance > 0
                      ? 'text-blue-700'
                      : 'text-emerald-700',
                ].join(' ')}
              >
                {summary.netSaleBalance > 0 ? '+' : ''}
                {formatCurrency(summary.netSaleBalance)}
              </strong>
            </div>
          </div>

          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-blue-900 space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <Info className="h-4 w-4 text-blue-700 shrink-0" />
              <span>Aplicación segura de ajustes</span>
            </div>
            <p className="text-[11px] leading-relaxed text-blue-800">
              Se aplicará exclusivamente la diferencia neta aprobada de cada producto sobre su
              existencia actual reconciliada, preservando cualquier movimiento válido posterior.
              Los productos sin diferencia no generarán movimientos innecesarios en el Kardex.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Notas de aprobación (opcional)
            </label>
            <input
              type="text"
              value={approvalNotes}
              onChange={(e) => setApprovalNotes(e.target.value)}
              placeholder="Ej. Revisión y conciliación física verificada en piso…"
              className="w-full h-8 rounded-md border border-slate-300 px-2.5 text-xs text-slate-800 focus:border-[#1A5F7A] focus:outline-none"
            />
          </div>

          {approveError && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-700 font-medium">
              {approveError}
            </div>
          )}
        </form>
      </Modal>

      {/* Modal de confirmación para cancelar corte parcial */}
      <Modal
        isOpen={isCancelModalOpen}
        onClose={() => {
          if (!isCancelling) setIsCancelModalOpen(false);
        }}
        title={`Cancelar corte parcial ${cut.reference}`}
        description="El corte parcial pasará a estado Cancelado. Se conservará en el expediente para auditoría, no modificará existencias y su intervalo temporal no se considerará cubierto."
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isCancelling}
              onClick={() => setIsCancelModalOpen(false)}
            >
              Volver
            </Button>
            <Button
              type="submit"
              form="cancel-partial-cut-form"
              variant="danger"
              size="sm"
              disabled={isCancelling}
            >
              {isCancelling ? 'Cancelando…' : 'Confirmar cancelación'}
            </Button>
          </>
        }
      >
        <form id="cancel-partial-cut-form" onSubmit={handleConfirmCancel} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Motivo de cancelación <span className="text-red-600">*</span>
            </label>
            <textarea
              rows={3}
              required
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Ej. Selección de productos incompleta o interrupción operativa en almacén…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-[#1A5F7A] focus:outline-none"
            />
          </div>

          {cancelError && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-700">
              {cancelError}
            </div>
          )}
        </form>
      </Modal>
    </div>
  );
}
