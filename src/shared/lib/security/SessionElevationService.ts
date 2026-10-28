import { SessionActor } from '../../types/permissions';
import { generateEntityId } from '../../utils/id';

export type CriticalActionScope = 'RESTORE_BACKUP' | 'RECTIFY_WORKDAY';

interface CriticalTokenRecord {
  readonly token: string;
  readonly actorLabel: string;
  readonly scope: CriticalActionScope;
  readonly createdAtMs: number;
}

export class SessionElevationService {
  private activeElevationToken: string | null = null;
  private activeActorLabel: string | null = null;
  private criticalTokens: Map<string, CriticalTokenRecord> = new Map();

  /**
   * Registrar una elevación de sesión activa para un Administrador tras verificar su PIN.
   */
  public registerElevatedSession(actorLabel: string): string {
    const token = `ELEV-${generateEntityId()}`;
    this.activeElevationToken = token;
    this.activeActorLabel = actorLabel;
    return token;
  }

  /**
   * Verificar si un token de elevación de sesión dado está activo actualmente.
   */
  public isSessionElevated(token?: string | null): boolean {
    if (!token || !this.activeElevationToken) {
      return false;
    }
    return token === this.activeElevationToken;
  }

  /**
   * Emitir un token efímero de autorización de un solo uso para acciones críticas.
   */
  public issueCriticalToken(actor: SessionActor, scope: CriticalActionScope): string {
    const token = `CRIT-${generateEntityId()}`;
    this.criticalTokens.set(token, {
      token,
      actorLabel: actor.label,
      scope,
      createdAtMs: Date.now(),
    });
    return token;
  }

  /**
   * Consumir un token de acción crítica. Si es válido y coincide con el scope, lo elimina de inmediato (un solo uso).
   */
  public consumeCriticalToken(
    token: string | undefined | null,
    requiredScope: CriticalActionScope
  ): void {
    if (!token || typeof token !== 'string') {
      throw new Error(
        'La operación crítica requiere una autorización explícita obtenida mediante reautenticación por PIN.'
      );
    }

    const record = this.criticalTokens.get(token);
    if (!record) {
      throw new Error(
        'La autorización de la operación crítica no es válida, ha caducado o ya fue utilizada.'
      );
    }

    if (record.scope !== requiredScope) {
      throw new Error(
        'La autorización proporcionada no corresponde a este tipo de operación crítica.'
      );
    }

    // Comprobar caducidad (máximo 5 minutos desde su emisión)
    if (Date.now() - record.createdAtMs > 5 * 60 * 1000) {
      this.criticalTokens.delete(token);
      throw new Error(
        'La autorización de la operación crítica ha caducado por límite de tiempo (5 minutos).'
      );
    }

    // CONSUMO INMEDIATO (Un solo uso)
    this.criticalTokens.delete(token);
  }

  /**
   * Revocar de inmediato todas las elevaciones de sesión y tokens de acción crítica activos.
   */
  public revokeAll(): void {
    this.activeElevationToken = null;
    this.activeActorLabel = null;
    this.criticalTokens.clear();
  }
}

export const sessionElevationService = new SessionElevationService();
